import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ui'
import { supabase, Capture } from '../lib/supabase'
import { compressImage } from '../lib/image'
import { tryDecodeBarcode } from '../lib/barcode'

type Slot = 'product' | 'barcode'

interface Pending {
  blob: Blob
  previewUrl: string
  confirmed: boolean
}

export default function CaptureScreen() {
  const { productId } = useParams()
  const nav = useNavigate()
  const { products, captures, refresh } = useData()
  const { session } = useAuth()
  const { toast } = useToast()

  const product = products.find((p) => p.id === productId)
  const existing: Capture | undefined = productId ? captures.get(productId) : undefined

  const [pending, setPending] = useState<Record<Slot, Pending | null>>({ product: null, barcode: null })
  const [saving, setSaving] = useState(false)
  const inputs = { product: useRef<HTMLInputElement>(null), barcode: useRef<HTMLInputElement>(null) }

  useEffect(() => {
    return () => {
      // release object URLs
      Object.values(pending).forEach((p) => p && URL.revokeObjectURL(p.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!product) {
    return (
      <div className="min-h-dvh bg-paper flex items-center justify-center">
        <p className="text-ink/50">Product not found.</p>
      </div>
    )
  }

  const onPick = async (slot: Slot, file: File | undefined) => {
    if (!file) return
    const blob = await compressImage(file)
    const previewUrl = URL.createObjectURL(blob)
    setPending((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!.previewUrl)
      return { ...prev, [slot]: { blob, previewUrl, confirmed: false } }
    })
  }

  const retake = (slot: Slot) => {
    setPending((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!.previewUrl)
      return { ...prev, [slot]: null }
    })
    inputs[slot].current?.click()
  }

  const usePhoto = (slot: Slot) =>
    setPending((prev) => (prev[slot] ? { ...prev, [slot]: { ...prev[slot]!, confirmed: true } } : prev))

  const hasProduct = Boolean(pending.product?.confirmed || existing?.product_photo_url)
  const hasBarcode = Boolean(pending.barcode?.confirmed || existing?.barcode_photo_url)
  const anythingNew = Boolean(pending.product?.confirmed || pending.barcode?.confirmed)
  const bothDone = hasProduct && hasBarcode

  const save = async () => {
    if (!anythingNew || saving) return
    setSaving(true)
    try {
      let productUrl = existing?.product_photo_url ?? null
      let barcodeUrl = existing?.barcode_photo_url ?? null
      let barcodeValue = existing?.barcode_value ?? null

      const upload = async (slot: Slot, blob: Blob) => {
        const path = `captures/${product.sku}/${slot}.jpg`
        const { error } = await supabase.storage
          .from('captures')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (error) throw error
        const { data } = supabase.storage.from('captures').getPublicUrl(path)
        // Cache-bust so retaken photos refresh in the UI/export
        return `${data.publicUrl}?v=${Date.now()}`
      }

      if (pending.product?.confirmed) productUrl = await upload('product', pending.product.blob)
      if (pending.barcode?.confirmed) {
        barcodeUrl = await upload('barcode', pending.barcode.blob)
        // Bonus: try to decode — never blocks saving
        const decoded = await tryDecodeBarcode(pending.barcode.blob).catch(() => null)
        if (decoded) barcodeValue = decoded
      }

      const status = productUrl && barcodeUrl ? 'done' : 'partial'
      const { error } = await supabase.from('captures').upsert(
        {
          product_id: product.id,
          product_photo_url: productUrl,
          barcode_photo_url: barcodeUrl,
          barcode_value: barcodeValue,
          captured_by: session?.user?.id ?? null,
          captured_at: new Date().toISOString(),
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

  return (
    <div className="min-h-dvh bg-paper pb-32">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line px-4 pt-3 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button onClick={() => nav('/')} className="text-sm text-ink/60 mb-1">← Products</button>
        <h1 className="font-display text-2xl font-bold uppercase leading-tight tracking-tight">{product.product_name}</h1>
        <p className="font-mono text-sm text-ink/60 mt-0.5">{product.sku} · {product.supplier}</p>
      </header>

      <main className="px-4 mt-4 space-y-4">
        <Tile
          title="Product photo"
          hint="Clear shot of the whole product"
          slot="product"
          pending={pending.product}
          existingUrl={existing?.product_photo_url ?? null}
          inputRef={inputs.product}
          onPick={onPick}
          onRetake={retake}
          onUse={usePhoto}
        />
        <Tile
          title="Barcode photo"
          hint="In focus, well lit, fills the frame"
          slot="barcode"
          pending={pending.barcode}
          existingUrl={existing?.barcode_photo_url ?? null}
          inputRef={inputs.barcode}
          onPick={onPick}
          onRetake={retake}
          onUse={usePhoto}
        />
        {existing?.barcode_value && (
          <p className="font-mono text-sm text-ink/60 px-1">Decoded barcode: {existing.barcode_value}</p>
        )}
      </main>

      {/* Save bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
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
          disabled={!anythingNew || saving}
          className={`w-full rounded py-4 text-base font-semibold text-white disabled:opacity-35 ${bothDone ? 'bg-done' : 'bg-ink'}`}
        >
          {saving ? 'Uploading…' : bothDone ? 'Save — both photos done' : 'Save'}
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
  onPick: (slot: Slot, f: File | undefined) => void
  onRetake: (slot: Slot) => void
  onUse: (slot: Slot) => void
}) {
  const { title, hint, slot, pending, existingUrl, inputRef, onPick, onRetake, onUse } = props
  const showPreview = pending?.previewUrl ?? existingUrl

  return (
    <section className="rounded border border-line bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight">{title}</h2>
        {pending && !pending.confirmed && <span className="text-xs text-partial font-semibold uppercase">Preview</span>}
        {(pending?.confirmed || (!pending && existingUrl)) && (
          <span className="text-xs text-done font-semibold uppercase">✓ Ready</span>
        )}
      </div>

      {/* Native camera input — most reliable inside installed PWAs on iOS */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(slot, e.target.files?.[0])}
      />

      {showPreview ? (
        <div>
          <img src={showPreview} alt={`${title} preview`} className="w-full max-h-72 object-contain bg-ink/5" />
          <div className="flex gap-2 p-3">
            <button
              onClick={() => onRetake(slot)}
              className="flex-1 rounded border border-line py-3 text-sm font-semibold"
            >
              Retake
            </button>
            {pending && !pending.confirmed ? (
              <button
                onClick={() => onUse(slot)}
                className="flex-1 rounded bg-ink text-white py-3 text-sm font-semibold"
              >
                Use photo
              </button>
            ) : (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex-1 rounded border border-line py-3 text-sm font-semibold text-ink/60"
              >
                Take again
              </button>
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
