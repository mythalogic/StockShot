// src/lib/canvas.ts
// Shared canvas plumbing for the image pipeline.

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  // willReadFrequently keeps getImageData off the GPU round-trip, which is the
  // difference between snappy and unusable on an older iPad.
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  return ctx
}

export function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      type,
      quality,
    )
  })
}

/** Downscale to `maxEdge` on the long side and re-encode as JPEG. */
export async function compressToJpeg(
  file: Blob,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)

  const canvas = newCanvas(w, h)
  const ctx = context2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()

  return toBlob(canvas, 'image/jpeg', quality)
}

/** Composite an RGBA canvas onto opaque white. */
export function flattenOntoWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height)
  const ctx = context2d(out)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return out
}
