import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { BarcodeProgress, StatusBadge } from '../components/ui'
import { statusOf, CaptureStatus } from '../lib/supabase'

type Filter = 'left' | 'all'

export default function SupplierDetail() {
  const { supplier: raw } = useParams()
  const supplier = decodeURIComponent(raw ?? '')
  const nav = useNavigate()
  const { products, captures } = useData()
  const [filter, setFilter] = useState<Filter>('left')

  const rows = useMemo(
    () =>
      products
        .filter((p) => p.supplier === supplier)
        .map((p) => ({ product: p, status: statusOf(captures.get(p.id)) as CaptureStatus })),
    [products, captures, supplier]
  )

  const stats = useMemo(() => {
    const s = { done: 0, partial: 0, noImage: 0, total: rows.length }
    for (const r of rows) {
      if (r.status === 'done') s.done++
      else if (r.status === 'partial') s.partial++
      else if (r.status === 'no_image') s.noImage++
    }
    return s
  }, [rows])

  const complete = stats.done + stats.noImage
  const left = stats.total - complete
  const shown = filter === 'left' ? rows.filter((r) => r.status !== 'done' && r.status !== 'no_image') : rows

  return (
    <div className="min-h-dvh bg-paper pb-24">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line px-4 pt-3 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button onClick={() => nav('/progress')} className="text-sm text-ink/60 mb-1">← Progress</button>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight leading-tight">{supplier}</h1>
        <p className="font-mono text-xs text-ink/60 mt-1 mb-2">
          {left === 0 ? '✓ All complete' : `${left} left`} · {stats.done} done · {stats.partial} partial · {stats.noImage} no photos · {stats.total} total
        </p>
        <BarcodeProgress done={complete} total={stats.total} height={20} />
        <div className="flex gap-2 mt-3">
          <FilterChip label={`Still to do (${left})`} active={filter === 'left'} onClick={() => setFilter('left')} />
          <FilterChip label={`All (${stats.total})`} active={filter === 'all'} onClick={() => setFilter('all')} />
        </div>
      </header>

      <main className="px-4 mt-3">
        {shown.length === 0 ? (
          <p className="text-center text-done font-semibold py-12">✓ Nothing left for this supplier</p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line bg-white overflow-hidden">
            {shown.map(({ product: p, status }) => (
              <li key={p.id}>
                <button
                  onClick={() => nav(`/capture/${p.id}`)}
                  className={`w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-paper ${status === 'done' || status === 'no_image' ? 'opacity-55' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[15px] leading-snug truncate">{p.product_name}</p>
                    <p className="font-mono text-xs text-ink/55 mt-0.5">{p.sku}</p>
                  </div>
                  <StatusBadge status={status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm ${active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/70'}`}
    >
      {label}
    </button>
  )
}
