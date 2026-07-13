import { useState } from 'react'

import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { statusOf, Capture, Product } from '../lib/supabase'

type ExportMode = 'zip' | 'links' | 'base64'

const STATUS_LABEL: Record<string, string> = {
  done: 'Done',
  partial: 'Partial',
  not_started: 'Not started'
}

export default function ExportPage() {
  const { products, captures, exportManagersOnly, setExportManagersOnly } = useData()
  const { isManager } = useAuth()
  const [mode, setMode] = useState<ExportMode>('zip')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const blocked = exportManagersOnly && !isManager

  const csvEscape = (v: string | null | undefined) => {
    const s = v ?? ''
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const buildRows = (
    photoCols: (p: Product, c: Capture | undefined) => [string, string]
  ) => {
    const header = 'SKU,ProductName,Supplier,Status,ProductPhotoFile,BarcodePhotoFile,BarcodeValue,CapturedBy,CapturedAt'
    const lines = products.map((p) => {
      const c = captures.get(p.id)
      const [prodCol, barCol] = photoCols(p, c)
      return [
        csvEscape(p.sku),
        csvEscape(p.product_name),
        csvEscape(p.supplier),
        STATUS_LABEL[statusOf(c)],
        csvEscape(prodCol),
        csvEscape(barCol),
        csvEscape(c?.barcode_value),
        csvEscape(c?.captured_by),
        csvEscape(c?.captured_at)
      ].join(',')
    })
    return [header, ...lines].join('\r\n')
  }

  const download = (blob: Blob, filename: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const fetchImage = async (url: string): Promise<Blob | null> => {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  }

  const runExport = async () => {
    if (busy || blocked) return
    setBusy(true)
    setProgress('Preparing…')
    try {
      const stamp = new Date().toISOString().slice(0, 10)

      if (mode === 'links') {
        const csv = buildRows((_p, c) => [c?.product_photo_url ?? '', c?.barcode_photo_url ?? ''])
        download(new Blob([csv], { type: 'text/csv' }), `stockshot_export_links_${stamp}.csv`)
      } else if (mode === 'base64') {
        // Self-contained CSV with base64 images. Warn: large, Excel handles poorly.
        const rows: string[] = []
        let i = 0
        for (const p of products) {
          i++
          setProgress(`Embedding ${i}/${products.length}…`)
          const c = captures.get(p.id)
          const toB64 = async (url: string | null | undefined) => {
            if (!url) return ''
            const blob = await fetchImage(url)
            if (!blob) return ''
            return await new Promise<string>((resolve) => {
              const r = new FileReader()
              r.onload = () => resolve(String(r.result))
              r.onerror = () => resolve('')
              r.readAsDataURL(blob)
            })
          }
          const [pb, bb] = [await toB64(c?.product_photo_url), await toB64(c?.barcode_photo_url)]
          rows.push(
            [
              csvEscape(p.sku), csvEscape(p.product_name), csvEscape(p.supplier),
              STATUS_LABEL[statusOf(c)], csvEscape(pb), csvEscape(bb),
              csvEscape(c?.barcode_value), csvEscape(c?.captured_by), csvEscape(c?.captured_at)
            ].join(',')
          )
        }
        const header = 'SKU,ProductName,Supplier,Status,ProductPhotoBase64,BarcodePhotoBase64,BarcodeValue,CapturedBy,CapturedAt'
        download(new Blob([[header, ...rows].join('\r\n')], { type: 'text/csv' }), `stockshot_export_base64_${stamp}.csv`)
      } else {
        // ZIP: CSV + images/ folder named by SKU
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        const images = zip.folder('images')!
        let i = 0
        for (const p of products) {
          i++
          const c = captures.get(p.id)
          setProgress(`Packing images ${i}/${products.length}…`)
          if (c?.product_photo_url) {
            const b = await fetchImage(c.product_photo_url)
            if (b) images.file(`${p.sku}_product.jpg`, b)
          }
          if (c?.barcode_photo_url) {
            const b = await fetchImage(c.barcode_photo_url)
            if (b) images.file(`${p.sku}_barcode.jpg`, b)
          }
        }
        const csv = buildRows((p, c) => [
          c?.product_photo_url ? `images/${p.sku}_product.jpg` : '',
          c?.barcode_photo_url ? `images/${p.sku}_barcode.jpg` : ''
        ])
        zip.file('stockshot_export.csv', csv)
        setProgress('Zipping…')
        const blob = await zip.generateAsync({ type: 'blob' })
        download(blob, `stockshot_export_${stamp}.zip`)
      }
      setProgress('Downloaded ✓')
    } catch (e: any) {
      setProgress(`Export failed — ${e?.message ?? 'try again'}`)
    } finally {
      setBusy(false)
    }
  }

  const doneCount = products.filter((p) => statusOf(captures.get(p.id)) === 'done').length

  return (
    <div className="min-h-dvh bg-paper pb-24">
      <header className="px-4 pt-4 pb-3 border-b border-line" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">Export</h1>
        <p className="text-xs text-ink/50 mt-0.5">
          Includes every product with its status — {doneCount} of {products.length} done right now. Re-run any time for the latest state.
        </p>
      </header>

      <main className="px-4 mt-4 space-y-4">
        {blocked ? (
          <div className="rounded border border-line bg-white p-4 text-sm text-ink/70">
            Export is currently restricted to managers. Ask a manager to run the export or turn the restriction off.
          </div>
        ) : (
          <>
            <section className="rounded border border-line bg-white divide-y divide-line overflow-hidden">
              <Option
                selected={mode === 'zip'}
                onSelect={() => setMode('zip')}
                title="ZIP — CSV + image files (recommended)"
                desc="stockshot_export.csv plus an images/ folder with photos named by SKU, e.g. C395A_product.jpg."
              />
              <Option
                selected={mode === 'links'}
                onSelect={() => setMode('links')}
                title="CSV with image links only"
                desc="Plain CSV where photo columns are hosted URLs. Smallest file, no ZIP."
              />
              <Option
                selected={mode === 'base64'}
                onSelect={() => setMode('base64')}
                title="CSV with images embedded as base64"
                desc="Single self-contained CSV. Warning: very large files that Excel handles poorly."
              />
            </section>

            <button
              onClick={runExport}
              disabled={busy}
              className="w-full rounded bg-ink text-white py-4 text-base font-semibold disabled:opacity-40"
            >
              {busy ? progress || 'Working…' : 'Download export'}
            </button>
            {!busy && progress && <p className="text-sm text-ink/60 text-center">{progress}</p>}
          </>
        )}

        {isManager && (
          <section className="rounded border border-line bg-white p-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-[15px]">Restrict export to managers</p>
              <p className="text-xs text-ink/50 mt-0.5">When on, only manager accounts can download exports.</p>
            </div>
            <button
              role="switch"
              aria-checked={exportManagersOnly}
              onClick={() => setExportManagersOnly(!exportManagersOnly)}
              className={`w-12 h-7 rounded-full transition-colors shrink-0 ${exportManagersOnly ? 'bg-done' : 'bg-ink/20'}`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${exportManagersOnly ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

function Option({ selected, onSelect, title, desc }: { selected: boolean; onSelect: () => void; title: string; desc: string }) {
  return (
    <button onClick={onSelect} className="w-full text-left p-4 flex gap-3 active:bg-paper">
      <span
        className={`mt-0.5 w-5 h-5 rounded-full border-2 shrink-0 ${selected ? 'border-ink bg-ink' : 'border-line'}`}
        aria-hidden
      >
        {selected && <span className="block w-2 h-2 rounded-full bg-white m-auto mt-[4px]" />}
      </span>
      <span>
        <span className="block font-medium text-[15px]">{title}</span>
        <span className="block text-xs text-ink/55 mt-0.5">{desc}</span>
      </span>
    </button>
  )
}
