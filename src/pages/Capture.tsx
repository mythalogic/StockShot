import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ui'
import { supabase, Capture, photoFileBase } from '../lib/supabase'
import { processProductPhoto } from '../lib/productImage'
import { processBarcodePhoto, generateBarcodeForSku } from '../lib/barcodeImage'
import type { BarcodeResult } from '../lib/barcodeImage'

type Slot = 'product' | 'barcode'

// The columns added by migration 002. Declared here so this file compiles
// without touching the Capture type in lib/supabase.ts — move them into that
// interface when you get a chance and this alias can go away.
type CaptureRow = Capture & {
  barcode_format?: string | null
  barcode_source?: string | null
  product_photo_processed?: boolean | null
}

interface Pending {
  blob: Blob
  previewUrl: string
  confirmed: boolean
  /** Barcodes come out as PNG (line art), product shots as JPEG. */
  ext: 'jpg' | 'png'
  contentType: string
  /** Product slot: set when the cut-out failed and we kept the raw photo. */
  warning?: string
  /** Barcode slot: what we actually decoded or minted. */
  barcode?: BarcodeResult
}

export default function CaptureScreen() {
  const { productId } = useParams()
  const nav = useNavigate()
  const { products, captures, refresh } = useData()
  const { session } = useAuth()
  const { toast } = useToast()

  const product = products.find((p) => p.id === productId)
  const existing = (productId ? captures.get(productId) : undefined) as CaptureRow | undefined

  const [pending, setPending] = useState<Record<Slot, Pending | null>>({ product: null, barcode: null })
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState<Slot | null>(null)
  const [confirmNoPhotos, setConfirmNoPhotos] = useState(false)
  const inputs = { product: useRef<HTMLInputElement>(null), barcode: useRef<HTMLInputElement>(null) }

  // Every object URL we hand out, so none leak. The previous version captured
  // `pending` in an effect with an empty dependency array, which meant it only
  // ever saw the initial nulls and revoked nothing.
  const objectUrls = useRef<string[]>([])
  const trackUrl = (url: string) => {
    objectUrls.current.push(url)
    return url
  }

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u))
      objectUrls.current = []
    }
  }, [])

  if (!product) {
    return (
      <div className="min-h-dvh bg-paper flex items-center justify-center">
        <p className="text-ink/50">Product not found.</p>
      </div>
    )
  }

  const replacePending = (slot: Slot, next: Pending | null) => {
    setPending((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!.previewUrl)
      return { ...prev, [slot]: next }
    })
  }

  /**
   * The camera handed us a file. Process it straight away so the preview the
   * user approves is the image we're actually going to store — if the cut-out
   * clipped a corner they can retake now, rather than finding out in the export
   * next week.
   */
  const onPick = async (slot: Slot, file: File | undefined) => {
    if (!file || processing) return
    setProcessing(slot)
    try {
      if (slot === 'product') {
        const result = await processProductPhoto(file)
        replacePending('product', {
          blob: result.blob,
          previewUrl: trackUrl(URL.createObjectURL(result.blob)),
          confirmed: false,
          ext: 'jpg',
          contentType: 'image/jpeg',
          warning: result.processed
            ? undefined
            : "Couldn't remove the background — keeping the photo as-is, flagged for review."
        })
      } else {
        const result = await processBarcodePhoto(file, product.sku)
        const isPng = result.source !== 'photo'
        replacePending('barcode', {
          blob: result.blob,
          previewUrl: trackUrl(URL.createObjectURL(result.blob)),
          confirmed: false,
          ext: isPng ? 'png' : 'jpg',
          contentType: isPng ? 'image/png' : 'image/jpeg',
          barcode: result
        })
      }
    } catch (e: any) {
      toast(`Couldn't process that photo — ${e?.message ?? 'try again'}`, 'err')
    } finally {
      setProcessing(null)
    }
  }

  /** Pack carries no barcode: mint a Code 128 from the SKU instead. */
  const generateBarcode = async () => {
    if (processing || saving) return
    setProcessing('barcode')
    try {
      const result = await generateBarcodeForSku(product.sku)
      replacePending('barcode', {
        blob: result.blob,
        previewUrl: trackUrl(URL.createObjectURL(result.blob)),
        confirmed: true, // nothing to approve — there was no photo
        ext: 'png',
        contentType: 'image/png',
        barcode: result
      })
      toast('Barcode generated from SKU — press Save to store it')
    } catch (e: any) {
      toast(`Couldn't generate a barcode — ${e?.message ?? 'try again'}`, 'err')
    } finally {
      setProcessing(null)
    }
  }

  const retake = (slot: Slot) => {
    replacePending(slot, null)
    inputs[slot].current?.click()
  }

  const usePhoto = (slot: Slot) =>
    setPending((prev) => (prev[slot] ? { ...prev, [slot]: { ...prev[slot]!, confirmed: true } } : prev))

  const isNoImage = existing?.status === 'no_image'
  const hasProduct = Boolean(pending.product?.confirmed || existing?.product_photo_url)
  const hasBarcode = Boolean(pending.barcode?.confirmed || existing?.barcode_photo_url)
  const anythingNew = Boolean(pending.product?.confirmed || pending.barcode?.confirmed)
  const bothDone = hasProduct && hasBarcode
  const nothingCapturedYet = !hasProduct && !hasBarcode && !anythingNew

  const save = async () => {
    if (!anythingNew || saving) return
    setSaving(true)
    try {
      const now = new Date()
      let productUrl = existing?.product_photo_url ?? null
      let barcodeUrl = existing?.barcode_photo_url ?? null
      let barcodeValue = existing?.barcode_value ?? null
      let barcodeFormat = existing?.barcode_format ?? null
      let barcodeSource = existing?.barcode_source ?? null
      let productProcessed = existing?.product_photo_processed ?? true

      // Filenames carry SKU + product name + date/time, e.g.
      // captures/266/266_EGGS-FILLER-CAGED-BOX-600GM_2026-07-13_19-43_product.jpg
      const base = photoFileBase(product.sku, product.product_name, now)

      // Extension and content type come from the slot now: a scanned or
      // generated barcode is a PNG, because JPEG ringing around the bars is
      // exactly what makes scanners fail.
      const upload = async (slot: Slot, p: Pending) => {
        const path = `captures/${product.sku}/${base}_${slot}.${p.ext}`
        const { error } = await supabase.storage
          .from('captures')
          .upload(path, p.blob, { contentType: p.contentType, upsert: true })
        if (error) throw error
        const { data } = supabase.storage.from('captures').getPublicUrl(path)
        return data.publicUrl
      }

      if (pending.product?.confirmed) {
        productUrl = await upload('product', pending.product)
        productProcessed = !pending.product.warning
      }

      if (pending.barcode?.confirmed) {
        barcodeUrl = await upload('barcode', pending.barcode)
        // processBarcodePhoto already decoded it — no second decode pass needed.
        barcodeValue = pending.barcode.barcode?.value ?? null
        barcodeFormat = pending.barcode.barcode?.format ?? null
        barcodeSource = pending.barcode.barcode?.source ?? null
      }

      const status = productUrl && barcodeUrl ? 'done' : 'partial'
      const { error } = await supabase.from('captures').upsert(
        {
          product_id: product.id,
          product_photo_url: productUrl,
          barcode_photo_url: barcodeUrl,
          barcode_value: barcodeValue,
          barcode_format: barcodeFormat,
          barcode_source: barcodeSource,
          product_photo_processed: productProcessed,
          captured_by: session?.user?.id ?? null,
          captured_at: now.toISOString(),
          status
        },
        { onConflict: 'product_id' }
      )
      if (error) throw error

      await refresh()
      toast(status === 'done' ? '✓ Both photos saved — done' : 'Photo saved — 1 of 2')
      nav('/')
    } catch (e: any) {
      toast(`Upload failed — ${e?.message ?? 'check connection'}. Tap Save to retry.`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const markNoPhotos = async () => {
    if (saving) return
    setSaving(true)
    try {
      const { error } = await supabase.from('captures').upsert(
        {
          product_id: product.id,
          product_photo_url: null,
          barcode_photo_url: null,
          barcode_value: null,
          barcode_format: null,
          barcode_source: null,
          product_photo_processed: true,
          captured_by: session?.user?.id ?? null,
          captured_at: new Date().toISOString(),
          status: 'no_image'
        },
        { onConflict: 'product_id' }
      )
      if (error) throw error
      await refresh()
      toast('Marked: no photos available')
      nav('/')
    } catch (e: any) {
      toast(`Could not save — ${e?.message ?? 'try again'}`, 'err')
    } finally {
      setSaving(false)
      setConfirmNoPhotos(false)
    }
  }

  const deletePhoto = async (slot: Slot) => {
    if (saving) return

    // If it's only a local (unsaved) photo, just discard it.
    if (pending[slot]) {
      replacePending(slot, null)
      return
    }
    if (!existing) return

    setSaving(true)
    try {
      const url = slot === 'product' ? existing.product_photo_url : existing.barcode_photo_url
      // Best effort: remove the file from storage (path is everything after /captures/)
      if (url) {
        const marker = '/object/public/captures/'
        const idx = url.indexOf(marker)
        if (idx !== -1) {
          const path = decodeURIComponent(url.slice(idx + marker.length).split('?')[0])
          await supabase.storage.from('captures').remove([path]).catch(() => null)
        }
      }

      const productUrl = slot === 'product' ? null : existing.product_photo_url
      const barcodeUrl = slot === 'barcode' ? null : existing.barcode_photo_url
      const status = productUrl && barcodeUrl ? 'done' : productUrl || barcodeUrl ? 'partial' : 'not_started'

      const { error } = await supabase.from('captures').upsert(
        {
          product_id: product.id,
          product_photo_url: productUrl,
          barcode_photo_url: barcodeUrl,
          // Clearing the barcode image must clear its provenance too, or the
          // row claims a scanned code it no longer has an image for.
          barcode_value: slot === 'barcode' ? null : existing.barcode_value,
          barcode_format: slot === 'barcode' ? null : (existing.barcode_format ?? null),
          barcode_source: slot === 'barcode' ? null : (existing.barcode_source ?? null),
          product_photo_processed: slot === 'product' ? true : (existing.product_photo_processed ?? true),
          captured_by: session?.user?.id ?? null,
          captured_at: new Date().toISOString(),
          status
        },
        { onConflict: 'product_id' }
      )
      if (error) throw error

      await refresh()
      toast(slot === 'product' ? 'Product photo deleted' : 'Barcode photo deleted')
    } catch (e: any) {
      toast(`Delete failed — ${e?.message ?? 'try again'}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const barcodeResult = pending.barcode?.barcode

  return (
    <div className="min-h-dvh bg-paper pb-44">
      <header
        className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line px-4 pt-3 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <button onClick={() => nav('/')} className="text-sm text-ink/60 mb-1">← Products</button>
        <h1 className="font-display text-2xl font-bold uppercase leading-tight tracking-tight">{product.product_name}</h1>
        <p className="font-mono text-sm text-ink/60 mt-0.5">{product.sku} · {product.supplier}</p>
      </header>

      <main className="px-4 mt-4 space-y-4">
        {isNoImage && !anythingNew && (
          <div className="rounded border border-partial/40 bg-partial/5 p-3 text-sm">
            This product is marked <strong>no photos available</strong>. Taking a photo below will replace that.
          </div>
        )}

        <Tile
          title="Product photo"
          hint="Clear shot of the whole product"
          slot="product"
          pending={pending.product}
          existingUrl={existing?.product_photo_url ?? null}
          inputRef={inputs.product}
          busy={processing === 'product'}
          busyLabel="Removing background…"
          onPick={onPick}
          onRetake={retake}
          onUse={usePhoto}
          onDelete={deletePhoto}
        />

        {pending.product?.warning && (
          <p className="font-mono text-xs text-amber-700 px-1 -mt-2">{pending.product.warning}</p>
        )}

        <Tile
          title="Barcode photo"
          hint="In focus, well lit, fills the frame"
          slot="barcode"
          pending={pending.barcode}
          existingUrl={existing?.barcode_photo_url ?? null}
          inputRef={inputs.barcode}
          busy={processing === 'barcode'}
          busyLabel="Reading barcode…"
          onPick={onPick}
          onRetake={retake}
          onUse={usePhoto}
          onDelete={deletePhoto}
        />

        {barcodeResult?.source === 'scanned' && (
          <p className="font-mono text-xs text-done px-1 -mt-2">✓ Scanned {barcodeResult.value}</p>
        )}
        {barcodeResult?.source === 'generated' && (
          <p className="font-mono text-xs text-ink/60 px-1 -mt-2">
            Generated from SKU — {barcodeResult.value}
          </p>
        )}
        {barcodeResult?.source === 'photo' && (
          <p className="font-mono text-xs text-amber-700 px-1 -mt-2">
            Couldn't read the barcode — kept the photo. Try again with the pack flat and the whole code in frame.
          </p>
        )}

        {/* Packs with no barcode printed on them at all */}
        {!pending.barcode && !existing?.barcode_photo_url && (
          <button
            type="button"
            onClick={generateBarcode}
            disabled={processing !== null || saving}
            className="w-full rounded border border-line py-3 font-mono text-xs text-ink/60 disabled:opacity-40"
          >
            No barcode on this pack — generate one from the SKU
          </button>
        )}

        {!pending.barcode && existing?.barcode_value && (
          <p className="font-mono text-sm text-ink/60 px-1">Decoded barcode: {existing.barcode_value}</p>
        )}

        {/* No-photos option — only when nothing has been captured */}
        {nothingCapturedYet && !isNoImage && (
          <section className="rounded border border-line bg-white p-4">
            {confirmNoPhotos ? (
              <div>
                <p className="text-sm mb-3">
                  Mark <strong>{product.product_name}</strong> as having no photos available? It will count as
                  accounted for in progress and exports.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmNoPhotos(false)}
                    className="flex-1 rounded border border-line py-3 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={markNoPhotos}
                    disabled={saving}
                    className="flex-1 rounded bg-partial text-white py-3 text-sm font-semibold disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Yes, no photos'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmNoPhotos(true)}
                className="w-full rounded border border-line py-3 text-sm font-semibold text-ink/60"
              >
                No photos available for this product
              </button>
            )}
          </section>
        )}
      </main>

      {/* Save bar — bottom nav is hidden on this screen so this is always fully visible */}
      <div
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className={hasProduct ? 'text-done font-semibold' : 'text-ink/40'}>
            {hasProduct ? '✓ Product photo' : '○ Product photo'}
          </span>
          <span className={hasBarcode ? 'text-done font-semibold' : 'text-ink/40'}>
            {hasBarcode ? '✓ Barcode photo' : '○ Barcode photo'}
          </span>
        </div>
        <button
          onClick={save}
          disabled={!anythingNew || saving || processing !== null}
          className={`w-full rounded py-4 text-lg font-bold text-white disabled:opacity-35 ${bothDone ? 'bg-done' : 'bg-ink'}`}
        >
          {saving ? 'Uploading…' : processing ? 'Processing…' : bothDone ? '✓ Save — both photos done' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Tile(props: {
  title: string
  hint: string
  slot: Slot
  pending: Pending | null
  existingUrl: string | null
  inputRef: React.RefObject<HTMLInputElement>
  busy: boolean
  busyLabel: string
  onPick: (slot: Slot, f: File | undefined) => void
  onRetake: (slot: Slot) => void
  onUse: (slot: Slot) => void
  onDelete: (slot: Slot) => void
}) {
  const { title, hint, slot, pending, existingUrl, inputRef, busy, busyLabel, onPick, onRetake, onUse, onDelete } = props
  const showPreview = pending?.previewUrl ?? existingUrl
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <section className="rounded border border-line bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight">{title}</h2>
        {busy && <span className="text-xs text-partial font-semibold uppercase">Working…</span>}
        {!busy && pending && !pending.confirmed && (
          <span className="text-xs text-partial font-semibold uppercase">Preview</span>
        )}
        {!busy && (pending?.confirmed || (!pending && existingUrl)) && (
          <span className="text-xs text-done font-semibold uppercase">✓ Ready</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onPick(slot, e.target.files?.[0])
          // Let the same file be picked again after a retake — without this,
          // re-selecting an identical file fires no change event.
          e.target.value = ''
        }}
      />

      {busy ? (
        <div className="flex flex-col items-center justify-center gap-2 py-14 text-ink/50">
          <span className="h-6 w-6 rounded-full border-2 border-ink/20 border-t-ink animate-spin" />
          <span className="text-sm font-semibold">{busyLabel}</span>
          <span className="text-xs">A couple of seconds</span>
        </div>
      ) : showPreview ? (
        <div>
          {/* Checkerboard-free: cut-outs are already flattened onto white */}
          <img src={showPreview} alt={`${title} preview`} className="w-full max-h-72 object-contain bg-ink/5" />
          <div className="flex gap-2 p-3">
            {pending && !pending.confirmed ? (
              <>
                <button
                  onClick={() => onRetake(slot)}
                  className="flex-1 rounded border border-line py-3 text-sm font-semibold"
                >
                  Retake
                </button>
                <button
                  onClick={() => onUse(slot)}
                  className="flex-1 rounded bg-ink text-white py-3 text-sm font-semibold"
                >
                  Use photo
                </button>
              </>
            ) : confirmDelete ? (
              <>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded border border-line py-3 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setConfirmDelete(false)
                    onDelete(slot)
                  }}
                  className="flex-1 rounded bg-scan text-white py-3 text-sm font-semibold"
                >
                  Yes, delete photo
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onRetake(slot)}
                  className="flex-1 rounded border border-line py-3 text-sm font-semibold"
                >
                  Retake
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex-1 rounded border border-scan/50 py-3 text-sm font-semibold text-scan"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-10 text-ink/50 active:bg-paper"
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <span className="text-sm font-semibold">Open camera</span>
          <span className="text-xs">{hint}</span>
        </button>
      )}
    </section>
  )
}
