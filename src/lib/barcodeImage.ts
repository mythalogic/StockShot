// src/lib/barcodeImage.ts
// ---------------------------------------------------------------------------
// StockShot — barcode capture and rendering.
//
// The key idea: once we've read the digits off the pack, the photo has done its
// job. We throw it away and redraw the barcode from the number with JsBarcode.
// The result is perfectly crisp, always scannable, ~6KB instead of ~300KB, and
// has no hand, pallet or shelf edge in it — because it isn't a photo.
//
// Three outcomes, in order of preference:
//   'scanned'   — decoded off the pack, redrawn clean          (the happy path)
//   'generated' — pack has no barcode, we mint Code 128 from the SKU
//   'photo'     — couldn't decode; keep the photo but run it through background
//                 removal so it's at least a clean shot on white
// ---------------------------------------------------------------------------

import { BrowserMultiFormatReader } from '@zxing/browser'
import JsBarcode from 'jsbarcode'
import { compressToJpeg, flattenOntoWhite, toBlob } from './canvas'
import { cutOut } from './segmentation'

export type BarcodeSource = 'scanned' | 'generated' | 'photo'

/** Symbologies JsBarcode can draw. 2D codes (QR, DataMatrix) are not in here. */
export type RenderableFormat =
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'CODE128'
  | 'CODE39'
  | 'ITF'
  | 'codabar'

export interface BarcodeResult {
  /** PNG (scanned/generated) or JPEG (photo fallback). Ready to upload. */
  blob: Blob
  /** The decoded or minted value. null only when source === 'photo'. */
  value: string | null
  /** Symbology of `value`. null when source === 'photo'. */
  format: RenderableFormat | null
  source: BarcodeSource
  /** Set when we fell back — worth surfacing in the UI. */
  reason?: string
}

// ---------------------------------------------------------------------------
// 1. decoding
// ---------------------------------------------------------------------------

interface Decoded {
  value: string
  format: RenderableFormat | null
}

/**
 * Native BarcodeDetector first (hardware-accelerated, handles angle and blur
 * far better), ZXing second. Neither is asked to do anything clever — if the
 * photo is unreadable we say so rather than guessing.
 */
export async function decodeBarcode(photo: Blob): Promise<Decoded | null> {
  const native = await tryNativeDetector(photo)
  if (native) return native

  const zxing = await tryZxing(photo)
  if (zxing) return zxing

  return null
}

async function tryNativeDetector(photo: Blob): Promise<Decoded | null> {
  const Detector = (globalThis as Record<string, unknown>)
    .BarcodeDetector as BarcodeDetectorCtor | undefined
  if (!Detector) return null

  try {
    const supported = await Detector.getSupportedFormats?.()
    const formats = supported?.filter((f) => f !== 'unknown')
    const detector = new Detector(formats ? { formats } : undefined)

    const bmp = await createImageBitmap(photo)
    const found = await detector.detect(bmp)
    bmp.close()

    const hit = found.find((f) => f.rawValue)
    if (!hit) return null

    return {
      value: hit.rawValue.trim(),
      format: mapNativeFormat(hit.format) ?? inferFormat(hit.rawValue.trim()),
    }
  } catch {
    return null
  }
}

async function tryZxing(photo: Blob): Promise<Decoded | null> {
  const url = URL.createObjectURL(photo)
  try {
    const reader = new BrowserMultiFormatReader()
    const result = await reader.decodeFromImageUrl(url)
    const text = result?.getText?.()?.trim()
    if (!text) return null
    return { value: text, format: inferFormat(text) }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function mapNativeFormat(f: string): RenderableFormat | null {
  switch (f) {
    case 'ean_13':
      return 'EAN13'
    case 'ean_8':
      return 'EAN8'
    case 'upc_a':
    case 'upc_e':
      return 'UPC'
    case 'code_128':
    case 'code_93': // no Code 93 in JsBarcode; Code 128 carries the same text
      return 'CODE128'
    case 'code_39':
      return 'CODE39'
    case 'itf':
      return 'ITF'
    case 'codabar':
      return 'codabar'
    default:
      return null // qr_code, data_matrix, aztec, pdf417 -> not redrawable
  }
}

/**
 * Work out the symbology from the value alone. Used for ZXing (whose format
 * enum we'd otherwise have to depend on) and as a backstop for the native
 * detector. Retail packs are overwhelmingly EAN-13, so the digit-count rules
 * carry almost all the traffic.
 */
export function inferFormat(value: string): RenderableFormat | null {
  if (!/^[\x20-\x7e]+$/.test(value)) return null // not encodable in Code 128
  if (/^\d{13}$/.test(value) && isValidGtinCheckDigit(value)) return 'EAN13'
  if (/^\d{12}$/.test(value) && isValidGtinCheckDigit(value)) return 'UPC'
  if (/^\d{8}$/.test(value) && isValidGtinCheckDigit(value)) return 'EAN8'
  return 'CODE128'
}

/** Standard GS1 mod-10 check digit, used by EAN-8/UPC-A/EAN-13. */
export function isValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  const body = digits.slice(0, -1)
  const check = Number(digits.slice(-1))
  return gtinCheckDigit(body) === check
}

export function gtinCheckDigit(body: string): number {
  let sum = 0
  // Weights alternate 3,1 reading right-to-left from the check-digit position.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(body[i]) * w
  }
  return (10 - (sum % 10)) % 10
}

// ---------------------------------------------------------------------------
// 2. rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Bar height in px. Default 220. */
  height?: number
  /** Width of the narrowest bar in px. Default 3 — thick enough to survive JPEG. */
  barWidth?: number
  /** Quiet zone + text margin. Default 24. */
  margin?: number
  /** Print the digits underneath. Default true. */
  showText?: boolean
  /** Small caption above the bars, e.g. the SKU. */
  caption?: string
}

/**
 * Draws `value` as a real barcode: pure black on pure white, generous quiet
 * zone, digits underneath. PNG, because a barcode is line art and JPEG ringing
 * around the bars is exactly what makes scanners fail.
 */
export async function renderBarcode(
  value: string,
  format: RenderableFormat,
  options: RenderOptions = {},
): Promise<Blob> {
  const {
    height = 220,
    barWidth = 3,
    margin = 24,
    showText = true,
    caption,
  } = options

  const barsCanvas = document.createElement('canvas')

  JsBarcode(barsCanvas, value, {
    format,
    width: barWidth,
    height,
    margin,
    displayValue: showText,
    fontSize: 34,
    textMargin: 6,
    font: 'monospace',
    background: '#FFFFFF',
    lineColor: '#000000',
  })

  if (!caption) return toBlob(barsCanvas, 'image/png', 1)

  // Compose the caption above the bars on the same white field.
  const capHeight = 46
  const out = document.createElement('canvas')
  out.width = barsCanvas.width
  out.height = barsCanvas.height + capHeight
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.fillStyle = '#000000'
  ctx.font = '26px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(caption, out.width / 2, capHeight / 2 + 4)
  ctx.drawImage(barsCanvas, 0, capHeight)

  return toBlob(out, 'image/png', 1)
}

// ---------------------------------------------------------------------------
// 3. generating a code for packs that don't carry one
// ---------------------------------------------------------------------------

/**
 * Mint a Code 128 barcode that encodes the product's own SKU.
 *
 * Code 128 (rather than a made-up EAN-13) because the SKU is already your
 * unique identifier — nothing new to allocate, nothing to keep in sync, and no
 * risk of colliding with a real product's GTIN. It scans on any laser or
 * imaging scanner; it just isn't a retail GTIN, which is correct, because these
 * products don't have one.
 */
export function skuBarcodeValue(sku: string): string {
  // Code 128 covers ASCII 0-127; keep it to printable characters so the
  // human-readable line underneath matches what's encoded.
  const clean = sku
    .trim()
    .toUpperCase()
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, '-')
  if (!clean) throw new Error('SKU is empty — cannot generate a barcode')
  return clean
}

export async function generateBarcodeForSku(
  sku: string,
  options: RenderOptions = {},
): Promise<BarcodeResult> {
  const value = skuBarcodeValue(sku)
  const blob = await renderBarcode(value, 'CODE128', {
    caption: 'NO BARCODE ON PACK — GENERATED FROM SKU',
    ...options,
  })
  return { blob, value, format: 'CODE128', source: 'generated' }
}

// ---------------------------------------------------------------------------
// 4. the whole barcode-photo flow
// ---------------------------------------------------------------------------

/**
 * Take the photo the user just shot of the barcode and return what should
 * actually be stored.
 *
 * @param sku used only for the caption on the redrawn barcode
 */
export async function processBarcodePhoto(
  photo: Blob,
  sku: string,
): Promise<BarcodeResult> {
  const compressed = await compressToJpeg(photo, 1600, 0.9)

  const decoded = await decodeBarcode(compressed)

  if (decoded && decoded.format) {
    try {
      const blob = await renderBarcode(decoded.value, decoded.format, {
        caption: sku,
      })
      return {
        blob,
        value: decoded.value,
        format: decoded.format,
        source: 'scanned',
      }
    } catch (e) {
      // JsBarcode rejects values that don't fit the symbology (bad check digit,
      // wrong length). Re-encode the same text as Code 128, which accepts it.
      try {
        const blob = await renderBarcode(decoded.value, 'CODE128', {
          caption: sku,
        })
        return {
          blob,
          value: decoded.value,
          format: 'CODE128',
          source: 'scanned',
          reason: `re-encoded as Code 128: ${
            e instanceof Error ? e.message : String(e)
          }`,
        }
      } catch {
        /* fall through to the photo path */
      }
    }
  }

  // Couldn't read it. Keep the photo, but clean it up the same way we clean up
  // product shots so the export isn't full of thumbs and pallet slats.
  const reason = decoded
    ? 'barcode is a 2D code and cannot be redrawn'
    : 'barcode could not be read from the photo'

  try {
    const cut = await cutOut(compressed)
    const flattened = await toBlob(flattenOntoWhite(cut), 'image/jpeg', 0.9)
    return {
      blob: flattened,
      value: decoded?.value ?? null,
      format: null,
      source: 'photo',
      reason,
    }
  } catch {
    return {
      blob: compressed,
      value: decoded?.value ?? null,
      format: null,
      source: 'photo',
      reason,
    }
  }
}

// ---------------------------------------------------------------------------
// minimal typings for the native BarcodeDetector (not in lib.dom yet)
// ---------------------------------------------------------------------------

interface DetectedBarcode {
  rawValue: string
  format: string
}

interface BarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?(): Promise<string[]>
}
