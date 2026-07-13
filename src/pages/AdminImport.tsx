import { useRef, useState } from 'react'


import { supabase } from '../lib/supabase'
import { useData } from '../context/DataContext'
import { useToast } from '../components/ui'

interface Row {
  Supplier?: string
  SKU?: string
  ProductName?: string
  [k: string]: unknown
}

export default function AdminImport() {
  const { refresh, products } = useData()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  const parseFile = async (file: File): Promise<Row[]> => {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const buf = await file.arrayBuffer()
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      return XLSX.utils.sheet_to_json<Row>(sheet)
    }
    const text = await file.text()
    const { default: Papa } = await import('papaparse')
    const result = Papa.parse<Row>(text, { header: true, skipEmptyLines: true })
    return result.data
  }

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    setSummary(null)
    try {
      const rows = await parseFile(file)
      const clean = rows
        .map((r) => ({
          sku: String(r.SKU ?? '').trim(),
          product_name: String(r.ProductName ?? '').trim(),
          supplier: String(r.Supplier ?? '').trim()
        }))
        .filter((r) => r.sku && r.product_name && r.supplier)

      if (clean.length === 0) {
        toast('No valid rows found. Expect columns: Supplier, SKU, ProductName.', 'err')
        return
      }

      // Upsert by SKU — re-importing updates names, never wipes captured photos.
      const batchSize = 500
      for (let i = 0; i < clean.length; i += batchSize) {
        const { error } = await supabase
          .from('products')
          .upsert(clean.slice(i, i + batchSize), { onConflict: 'sku' })
        if (error) throw error
      }

      await refresh()
      setSummary(`Imported ${clean.length} products (upserted by SKU).`)
      toast(`✓ ${clean.length} products imported`)
    } catch (e: any) {
      toast(`Import failed — ${e?.message ?? 'check the file'}`, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="min-h-dvh bg-paper pb-24">
      <header className="px-4 pt-4 pb-3 border-b border-line" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">Admin · Import</h1>
        <p className="text-xs text-ink/50 mt-0.5">{products.length} products currently loaded</p>
      </header>

      <main className="px-4 mt-4 space-y-4">
        <section className="rounded border border-line bg-white p-4">
          <p className="text-sm text-ink/70 mb-3">
            Upload a <strong>.csv</strong> or <strong>.xlsx</strong> with columns:
          </p>
          <pre className="font-mono text-xs bg-paper rounded p-3 mb-4 overflow-x-auto">Supplier,SKU,ProductName{'\n'}Campbells,C395A,NUTTELEX (BOX 12)</pre>
          <p className="text-xs text-ink/50 mb-4">
            Rows are <strong>upserted by SKU</strong> — re-importing updates names and suppliers without touching captured photos. The provided <code className="font-mono">products.csv</code> (328 rows) loads here on first run.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full rounded bg-ink text-white py-3.5 text-base font-semibold disabled:opacity-40"
          >
            {busy ? 'Importing…' : 'Choose file to import'}
          </button>
          {summary && <p className="text-sm text-done mt-3">{summary}</p>}
        </section>

        <section className="rounded border border-line bg-white p-4">
          <p className="font-medium text-[15px] mb-1">First run</p>
          <p className="text-xs text-ink/50 mb-3">
            Load the bundled <code className="font-mono">products.csv</code> (328 products) shipped with the app.
          </p>
          <button
            onClick={async () => {
              if (busy) return
              const res = await fetch('/products.csv')
              const blob = await res.blob()
              await onFile(new File([blob], 'products.csv', { type: 'text/csv' }))
            }}
            disabled={busy}
            className="w-full rounded border border-ink py-3 text-sm font-semibold disabled:opacity-40"
          >
            Load bundled products.csv
          </button>
        </section>
      </main>
    </div>
  )
}
