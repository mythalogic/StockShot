import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { BarcodeProgress } from '../components/ui'
import { statusOf } from '../lib/supabase'

export interface SupplierStats {
  done: number
  partial: number
  noImage: number
  total: number
}
export const remaining = (s: SupplierStats) => s.total - s.done - s.noImage

export default function Progress() {
  const { products, captures } = useData()
  const nav = useNavigate()

  const overall = useMemo(() => {
    const s: SupplierStats = { done: 0, partial: 0, noImage: 0, total: products.length }
    for (const p of products) {
      const st = statusOf(captures.get(p.id))
      if (st === 'done') s.done++
      else if (st === 'partial') s.partial++
      else if (st === 'no_image') s.noImage++
    }
    return s
  }, [products, captures])

  const bySupplier = useMemo(() => {
    const map = new Map<string, SupplierStats>()
    for (const p of products) {
      const row = map.get(p.supplier) ?? { done: 0, partial: 0, noImage: 0, total: 0 }
      row.total++
      const st = statusOf(captures.get(p.id))
      if (st === 'done') row.done++
      else if (st === 'partial') row.partial++
      else if (st === 'no_image') row.noImage++
      map.set(p.supplier, row)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [products, captures])

  const complete = overall.done + overall.noImage

  return (
    <div className="min-h-dvh bg-paper pb-24">
      <header className="px-4 pt-4 pb-3 border-b border-line" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">Progress</h1>
        <p className="text-xs text-ink/50 mt-0.5">Updates live as the team captures</p>
      </header>

      <main className="px-4 mt-4 space-y-6">
        <section className="rounded border border-line bg-white p-4">
          <p className="font-mono text-sm text-ink/60 mb-1">Overall</p>
          <p className="font-display text-3xl font-bold uppercase tracking-tight mb-3">
            {complete} of {overall.total} complete
          </p>
          <BarcodeProgress done={complete} total={overall.total} />
          <p className="text-sm text-ink/60 mt-3">
            <span className="text-done font-semibold">{overall.done} done</span>
            {' · '}
            <span className="text-partial font-semibold">{overall.partial} partial</span>
            {' · '}
            <span className="font-semibold">{overall.noImage} no photos</span>
            {' · '}
            {remaining(overall) - overall.partial} not started
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold uppercase tracking-tight mb-2 px-1">By supplier</h2>
          <p className="text-xs text-ink/50 mb-2 px-1">Tap a supplier to see what's left</p>
          <div className="space-y-3">
            {bySupplier.map(([supplier, s]) => {
              const left = remaining(s)
              return (
                <button
                  key={supplier}
                  onClick={() => nav(`/progress/${encodeURIComponent(supplier)}`)}
                  className="w-full text-left rounded border border-line bg-white p-3.5 active:bg-paper"
                >
                  <div className="flex items-baseline justify-between mb-2 gap-3">
                    <p className="font-medium text-[15px] truncate">{supplier}</p>
                    <p className="font-mono text-xs shrink-0">
                      {left === 0 ? (
                        <span className="text-done font-semibold">✓ complete</span>
                      ) : (
                        <span className="text-ink/70"><span className="font-semibold text-ink">{left} left</span> · {s.done + s.noImage}/{s.total}</span>
                      )}
                    </p>
                  </div>
                  <BarcodeProgress done={s.done + s.noImage} total={s.total} height={18} />
                </button>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
