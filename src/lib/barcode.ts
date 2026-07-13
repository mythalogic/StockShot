

/**
 * Best-effort barcode decode from a captured photo.
 * Tries the native BarcodeDetector API first, then ZXing.
 * Returns the decoded value or null — NEVER throws, never blocks saving.
 */
export async function tryDecodeBarcode(blob: Blob): Promise<string | null> {
  // 1) Native BarcodeDetector (Chrome/Android, some Safari versions)
  try {
    const AnyWindow = window as any
    if ('BarcodeDetector' in AnyWindow) {
      const detector = new AnyWindow.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
      })
      const bitmap = await createImageBitmap(blob)
      const codes = await detector.detect(bitmap)
      bitmap.close()
      if (codes?.length) return String(codes[0].rawValue)
    }
  } catch {
    /* fall through to ZXing */
  }

  // 2) ZXing fallback
  try {
    const url = URL.createObjectURL(blob)
    try {
      const img = await loadImage(url)
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const reader = new BrowserMultiFormatReader()
      const result = await reader.decodeFromImageElement(img)
      return result.getText() || null
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
