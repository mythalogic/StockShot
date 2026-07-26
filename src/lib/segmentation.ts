// src/lib/segmentation.ts
// ---------------------------------------------------------------------------
// On-device background removal. No API, no key, no per-image cost, works
// offline once the app shell is installed.
//
// Model: U^2-Net (small variant, "u2netp") — Apache 2.0, 4.7 MB. It's a
// *salient object detection* network, which is exactly the right tool here: a
// pack held up to the camera is the salient object and the pallet behind it is
// not. Same model rembg uses by default, so its behaviour is well understood.
//
// Runtime: onnxruntime-web (MIT) on WebAssembly. WebGPU is deliberately not
// used — these U-Net-shaped models are not reliably compatible with it yet, and
// a silent fall-through to a broken backend mid-stocktake is not worth the
// speed.
//
// Setup (see CAPTURE_PATCH.md):
//   public/models/u2netp.onnx   <- 4.7 MB, from the rembg releases
//   public/ort/*.wasm           <- copied from node_modules/onnxruntime-web/dist
// ---------------------------------------------------------------------------

import * as ort from 'onnxruntime-web'
import { context2d, newCanvas } from './canvas'

/** U^2-Net's fixed input resolution. */
const N = 320

/** ImageNet normalisation, matching the reference rembg implementation. */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export interface SegmenterConfig {
  modelUrl: string
  /** Directory holding the onnxruntime .wasm files, with trailing slash. */
  wasmPath: string
}

let config: SegmenterConfig = {
  modelUrl: '/models/u2netp.onnx',
  wasmPath: '/ort/',
}

let sessionPromise: Promise<ort.InferenceSession> | null = null

export function configureSegmenter(next: Partial<SegmenterConfig>): void {
  config = { ...config, ...next }
  sessionPromise = null
}

/**
 * Load and compile the model. Call this once at app start (after sign-in, say)
 * so the first capture isn't the one that pays the ~1-2s compile cost.
 */
export function warmUpSegmenter(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise

  ort.env.wasm.wasmPaths = config.wasmPath

  // Multi-threading needs cross-origin isolation (COOP/COEP headers). Most
  // static hosts don't set those, and asking for threads without them makes
  // onnxruntime fail rather than fall back — so only ask when we know we can.
  ort.env.wasm.numThreads =
    typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 2)
      : 1

  // Held in a local first. Assigning straight to the module-level variable and
  // returning it doesn't typecheck: the .catch callback below also writes to
  // `sessionPromise`, and TypeScript drops the not-null narrowing for any
  // variable a closure can reassign.
  const started: Promise<ort.InferenceSession> = ort.InferenceSession.create(
    config.modelUrl,
    {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    },
  ).catch((e: unknown) => {
    // Clear the cache so the next capture retries, but only if nothing has
    // reconfigured the segmenter in the meantime.
    if (sessionPromise === started) sessionPromise = null
    throw e
  })

  sessionPromise = started
  return started
}

export interface CutOutOptions {
  /**
   * Soft threshold applied to the mask, as [low, high]. Alpha below `low`
   * becomes fully transparent, above `high` fully opaque, and in between it
   * ramps smoothly. This is what kills the faint grey haze U^2-Net leaves
   * around the subject. Default [0.30, 0.70].
   */
  knee?: [number, number]
  /**
   * Discard everything except the biggest blob. Removes the shoe in the corner
   * and the neighbouring pack on the shelf. Default true.
   */
  keepLargestOnly?: boolean
}

/**
 * Run the model and return the source image as an RGBA canvas with the
 * background made transparent.
 */
export async function cutOut(
  source: Blob,
  options: CutOutOptions = {},
): Promise<HTMLCanvasElement> {
  const { knee = [0.3, 0.7], keepLargestOnly = true } = options

  const session = await warmUpSegmenter()
  const bmp = await createImageBitmap(source)

  try {
    const mask = await runModel(session, bmp)

    minMaxNormalize(mask)
    applyKnee(mask, knee[0], knee[1])
    if (keepLargestOnly) keepLargestComponent(mask, N, N, 0.5)

    return applyMask(bmp, mask)
  } finally {
    bmp.close()
  }
}

// ---------------------------------------------------------------------------
// inference
// ---------------------------------------------------------------------------

async function runModel(
  session: ort.InferenceSession,
  bmp: ImageBitmap,
): Promise<Float32Array> {
  const small = newCanvas(N, N)
  const sctx = context2d(small)
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(bmp, 0, 0, N, N)
  const { data } = sctx.getImageData(0, 0, N, N)

  const input = new Float32Array(3 * N * N)
  const plane = N * N

  // rembg divides by the image's own maximum rather than by 255. Matching that
  // exactly matters: it's effectively a brightness normalisation, and photos
  // taken in a dim warehouse aisle segment noticeably better with it.
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > max) max = data[i]
    if (data[i + 1] > max) max = data[i + 1]
    if (data[i + 2] > max) max = data[i + 2]
  }
  if (max === 0) max = 255 // fully black frame; avoid dividing by zero

  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    input[p] = (data[i] / max - MEAN[0]) / STD[0]
    input[plane + p] = (data[i + 1] / max - MEAN[1]) / STD[1]
    input[2 * plane + p] = (data[i + 2] / max - MEAN[2]) / STD[2]
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, N, N])
  const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: tensor }
  const results = await session.run(feeds)

  // U^2-Net emits seven side outputs; d0 (the first) is the fused prediction.
  const out = results[session.outputNames[0]]
  const raw = out.data as Float32Array
  if (raw.length < plane) {
    throw new Error(`unexpected model output length ${raw.length}`)
  }
  return raw.slice(0, plane)
}

/** Paint the mask into the source image's alpha channel. */
function applyMask(bmp: ImageBitmap, mask: Float32Array): HTMLCanvasElement {
  // Mask at model resolution, as white pixels with per-pixel alpha.
  const maskCanvas = newCanvas(N, N)
  const mctx = context2d(maskCanvas)
  const img = mctx.createImageData(N, N)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    img.data[i] = 255
    img.data[i + 1] = 255
    img.data[i + 2] = 255
    img.data[i + 3] = Math.round(mask[p] * 255)
  }
  mctx.putImageData(img, 0, 0)

  const out = newCanvas(bmp.width, bmp.height)
  const ctx = context2d(out)
  ctx.drawImage(bmp, 0, 0)

  // destination-in keeps the source pixels only where the mask is opaque, and
  // the upscale is done by the compositor rather than a JS pixel loop.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(maskCanvas, 0, 0, bmp.width, bmp.height)
  ctx.globalCompositeOperation = 'source-over'

  return out
}

// ---------------------------------------------------------------------------
// mask post-processing — pure functions, unit-tested
// ---------------------------------------------------------------------------

/** Stretch the mask to span the full 0..1 range, as rembg's normPRED does. */
export function minMaxNormalize(mask: Float32Array): void {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < lo) lo = mask[i]
    if (mask[i] > hi) hi = mask[i]
  }
  const span = hi - lo
  if (span <= 1e-6) {
    mask.fill(0) // flat prediction carries no information; treat as empty
    return
  }
  for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] - lo) / span
}

/** Smoothstep between `low` and `high`, clamped outside. */
export function applyKnee(
  mask: Float32Array,
  low: number,
  high: number,
): void {
  const span = high - low
  if (span <= 0) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] >= high ? 1 : 0
    return
  }
  for (let i = 0; i < mask.length; i++) {
    const t = Math.min(1, Math.max(0, (mask[i] - low) / span))
    mask[i] = t * t * (3 - 2 * t)
  }
}

/**
 * Zero every blob except the largest. Iterative flood fill over a 320x320 grid
 * — about 100k pixels, so this costs well under a millisecond.
 */
export function keepLargestComponent(
  mask: Float32Array,
  width: number,
  height: number,
  threshold = 0.5,
): void {
  const n = width * height
  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  const sizes: number[] = []

  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] < threshold || label[seed] !== -1) continue

    const id = sizes.length
    let size = 0
    let top = 0
    stack[top++] = seed
    label[seed] = id

    while (top > 0) {
      const p = stack[--top]
      size++
      const x = p % width
      const y = (p / width) | 0

      // 4-connectivity is enough, and avoids bridging blobs that only touch
      // diagonally — a thumb tip beside the pack shouldn't join the pack.
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ]
      for (const q of neighbours) {
        if (q >= 0 && label[q] === -1 && mask[q] >= threshold) {
          label[q] = id
          stack[top++] = q
        }
      }
    }

    sizes.push(size)
  }

  if (sizes.length <= 1) return // nothing found, or already a single blob

  let best = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i

  for (let i = 0; i < n; i++) {
    if (label[i] !== best) mask[i] = 0
  }
}
