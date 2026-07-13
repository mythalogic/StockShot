import { useMemo } from 'react'
import { useData } from '../context/DataContext'
import { BarcodeProgress } from '../components/ui'
import { statusOf } from '../lib/supabase'

export default function Progress() {
  const { products, captures } = useData()

  const overall = useMemo(() => {
    let done = 0
    let partial = 0
    for (const p of products) {
      const st = statusOf(captures.get(p.id))
      if (st === 'done') done++
      else if (st === 'partial') partial++
    }
    return { done, partial, total: products.length }
  }, [products, captures])

  const bySupplier = useMemo(() => {
    const map = new Map<string, { done: number; partial: number; total: number }>()
    for (const p of products) {
      const row = map.get(p.supplier) ?? { done: 0, partial: 0, total: 0 }
      row.total++
      const st = statusOf(captures.get(p.id))
      if (st === 'done') row.done++
      else if (st === 'partial') row.partial++
      map.set(p.supplier, row)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [products, captures])

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
            {overall.done} of {overall.total} complete
          </p>
          <BarcodeProgress done={overall.done} total={overall.total} />
          <p className="text-sm text-ink/60 mt-3">
            <span className="text-done font-semibold">{overall.done} done</span>
            {' · '}
            <span className="text-partial font-semibold">{overall.partial} partial</span>
            {' · '}
            {overall.total - overall.done - overall.partial} not started
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-bold uppercase tracking-tight mb-2 px-1">By supplier</h2>
          <div className="space-y-3">
            {bySupplier.map(([supplier, s]) => (
              <div key={supplier} className="rounded border border-line bg-white p-3.5">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-medium text-[15px] truncate pr-3">{supplier}</p>
                  <p className="font-mono text-xs text-ink/60 shrink-0">
                    {s.done}/{s.total}
                  </p>
                </div>
                <BarcodeProgress done={s.done} total={s.total} height={18} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
