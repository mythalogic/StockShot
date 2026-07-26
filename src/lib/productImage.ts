// src/lib/productImage.ts
// ---------------------------------------------------------------------------
// StockShot — turns a messy shop-floor snap (hand in frame, pallet behind,
// carton tilted) into a clean pack shot: subject cut out, straightened,
// centred on a white square.
//
// Pipeline
//   1. downscale + JPEG-compress the camera file
//   2. cut the subject out on-device with U^2-Net          (see segmentation.ts)
//   3. find the subject's alpha bounding box
//   4. estimate tilt from the minimum-area rectangle of the subject outline
//      and rotate it back to upright (only for small, plausible tilts)
//   5. re-crop, pad, centre on a white square, export JPEG
//
// If step 2 fails — model file missing, WebAssembly unavailable, device out of
// memory — the function still returns a usable image: the original photo,
// white-padded to a square, with `processed: false`. A broken model never
// blocks a stocktake.
// ---------------------------------------------------------------------------

import { compressToJpeg, context2d, newCanvas, toBlob } from './canvas'
import { cutOut } from './segmentation'

export interface ProcessedImage {
  /** Final JPEG, square, white background. Ready to upload. */
  blob: Blob
  /** false = the cut-out failed; this is the raw photo padded to square */
  processed: boolean
  /** degrees of rotation applied to straighten the subject */
  straightenedBy: number
  /** present when processed === false */
  reason?: string
}

export interface ProductImageOptions {
  /** Output edge length in px. Square. Default 1600. */
  size?: number
  /** Whitespace around the subject, as a fraction of the canvas. Default 0.06. */
  padding?: number
  /** Don't rotate more than this many degrees. Default 20. */
  maxStraightenDeg?: number
  /** JPEG quality. Default 0.85. */
  quality?: number
}

const DEFAULTS: Required<ProductImageOptions> = {
  size: 1600,
  padding: 0.06,
  maxStraightenDeg: 20,
  quality: 0.85,
}

/** Longest edge we keep before segmenting. Caps memory on older iPads. */
const WORKING_MAX_EDGE = 1600
/** Alpha below this counts as background. */
const ALPHA_THRESHOLD = 24

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

export async function processProductPhoto(
  file: Blob,
  options: ProductImageOptions = {},
): Promise<ProcessedImage> {
  const opts = { ...DEFAULTS, ...options }
  const compressed = await compressToJpeg(file, WORKING_MAX_EDGE, 0.85)

  try {
    const cut = await cutOut(compressed)
    return await composeOnWhite(cut, opts)
  } catch (e) {
    return {
      blob: await whiteSquare(compressed, opts),
      processed: false,
      straightenedBy: 0,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

async function composeOnWhite(
  cut: HTMLCanvasElement,
  opts: Required<ProductImageOptions>,
): Promise<ProcessedImage> {
  const ctx = context2d(cut)
  const { data, width, height } = ctx.getImageData(0, 0, cut.width, cut.height)

  const outline = subjectOutline(data, width, height)
  if (outline.length < 3) throw new Error('cut-out is empty')

  const angle = tiltAngle(outline, opts.maxStraightenDeg)

  // Rotate the cut-out upright on a transparent canvas large enough to hold it.
  const straightened = angle === 0 ? cut : rotateCanvas(cut, -angle)

  // Re-measure after rotating: the bounding box changes.
  const sctx = context2d(straightened)
  const simg = sctx.getImageData(0, 0, straightened.width, straightened.height)
  const box = alphaBounds(simg.data, straightened.width, straightened.height)
  if (!box) throw new Error('cut-out is empty after straightening')

  const out = newCanvas(opts.size, opts.size)
  const octx = context2d(out)
  octx.fillStyle = '#FFFFFF'
  octx.fillRect(0, 0, opts.size, opts.size)

  const inner = opts.size * (1 - opts.padding * 2)
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  const scale = Math.min(inner / bw, inner / bh)
  const dw = bw * scale
  const dh = bh * scale

  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(
    straightened,
    box.x0,
    box.y0,
    bw,
    bh,
    (opts.size - dw) / 2,
    (opts.size - dh) / 2,
    dw,
    dh,
  )

  return {
    blob: await toBlob(out, 'image/jpeg', opts.quality),
    processed: true,
    straightenedBy: angle,
  }
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

function alphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Box | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1

  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

interface Pt {
  x: number
  y: number
}

/**
 * Sample points on the edge of the subject. We only need enough to build a
 * convex hull, so we walk rows and columns and take the first/last opaque
 * pixel — one O(w*h) pass, a few thousand points out.
 */
function subjectOutline(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Pt[] {
  const pts: Pt[] = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 300))

  for (let y = 0; y < height; y += step) {
    const row = y * width * 4
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first >= 0) {
      pts.push({ x: first, y })
      pts.push({ x: last, y })
    }
  }

  for (let x = 0; x < width; x += step) {
    let first = -1
    let last = -1
    for (let y = 0; y < height; y++) {
      if (data[y * width * 4 + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (first < 0) first = y
        last = y
      }
    }
    if (first >= 0) {
      pts.push({ x, y: first })
      pts.push({ x, y: last })
    }
  }

  return convexHull(pts)
}

/** Andrew's monotone chain. Exported so the geometry can be unit-tested. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Pt[] = []
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Rotating calipers: the minimum-area enclosing rectangle of a convex polygon
 * always has one side flush with a hull edge. Its orientation is the tilt of a
 * boxy product like a carton or a tin.
 *
 * Returns degrees in (-maxDeg, maxDeg); 0 means "leave it alone". Anything
 * bigger than maxDeg is almost certainly a genuinely non-rectangular product
 * rather than a tilted box, and rotating it would make things worse.
 */
export function tiltAngle(hull: Pt[], maxDeg: number): number {
  if (hull.length < 3) return 0

  let bestArea = Infinity
  let bestAngle = 0

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x)
    const cos = Math.cos(-edgeAngle)
    const sin = Math.sin(-edgeAngle)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of hull) {
      const rx = p.x * cos - p.y * sin
      const ry = p.x * sin + p.y * cos
      if (rx < minX) minX = rx
      if (rx > maxX) maxX = rx
      if (ry < minY) minY = ry
      if (ry > maxY) maxY = ry
    }

    const area = (maxX - minX) * (maxY - minY)
    if (area < bestArea) {
      bestArea = area
      bestAngle = edgeAngle
    }
  }

  // Normalise into (-45, 45]: a rectangle looks the same every 90 degrees, and
  // we never want to tip a portrait pack onto its side.
  let deg = (bestAngle * 180) / Math.PI
  deg = ((deg % 90) + 135) % 90 - 45

  if (Math.abs(deg) < 0.75) return 0 // already straight; don't resample for nothing
  if (Math.abs(deg) > maxDeg) return 0
  return deg
}

function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.ceil(src.width * cos + src.height * sin)
  const h = Math.ceil(src.width * sin + src.height * cos)

  const out = newCanvas(w, h)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

/** Whole photo, letterboxed onto a white square. Used when the cut-out fails. */
async function whiteSquare(
  jpeg: Blob,
  opts: Required<ProductImageOptions>,
): Promise<Blob> {
  const bmp = await createImageBitmap(jpeg)
  const out = newCanvas(opts.size, opts.size)
  const ctx = context2d(out)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, opts.size, opts.size)

  const scale = Math.min(opts.size / bmp.width, opts.size / bmp.height)
  const dw = bmp.width * scale
  const dh = bmp.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (opts.size - dw) / 2, (opts.size - dh) / 2, dw, dh)
  bmp.close()

  return toBlob(out, 'image/jpeg', opts.quality)
}
