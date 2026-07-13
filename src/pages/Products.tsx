import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { StatusBadge } from '../components/ui'
import { statusOf } from '../lib/supabase'

export default function Products() {
  const { products, captures, loadingData } = useData()
  const { signOut, profile } = useAuth()
  const nav = useNavigate()
  const [query, setQuery] = useState('')
  const [supplier, setSupplier] = useState<string>('')
  const [showInstallHint, setShowInstallHint] = useState(false)

  // First-run "Add to Home Screen" hint for iOS Safari (no automatic prompt there)
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
    const dismissed = sessionStorage.getItem('installHintDismissed')
    if (isIOS && !standalone && !dismissed) setShowInstallHint(true)
  }, [])

  const suppliers = useMemo(
    () => Array.from(new Set(products.map((p) => p.supplier))).sort(),
    [products]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (supplier && p.supplier !== supplier) return false
      if (!q) return true
      return p.sku.toLowerCase().includes(q) || p.product_name.toLowerCase().includes(q)
    })
  }, [products, query, supplier])

  const doneCount = products.filter((p) => statusOf(captures.get(p.id)) === 'done').length

  return (
    <div className="min-h-dvh bg-paper pb-24">
      {/* Sticky header with search */}
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line px-4 pt-3 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="font-display text-2xl font-bold uppercase tracking-tight">Products</h1>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink/60">
              {doneCount}/{products.length} done
            </span>
            <button onClick={signOut} className="text-xs text-ink/50 underline underline-offset-2">
              Sign out{profile?.email ? '' : ''}
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search SKU or product name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-line bg-white px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ink"
        />
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1 -mx-4 px-4">
          <Chip label="All suppliers" active={!supplier} onClick={() => setSupplier('')} />
          {suppliers.map((s) => (
            <Chip key={s} label={s} active={supplier === s} onClick={() => setSupplier(s === supplier ? '' : s)} />
          ))}
        </div>
      </header>

      {showInstallHint && (
        <div className="mx-4 mt-3 rounded border border-line bg-white p-3 text-sm flex items-start gap-2">
          <span className="mt-0.5" aria-hidden>📲</span>
          <div className="flex-1">
            <strong>Install StockShot:</strong> tap the Share button in Safari, then <strong>Add to Home Screen</strong>. It opens full-screen like an app.
          </div>
          <button
            className="text-ink/40 px-1"
            aria-label="Dismiss"
            onClick={() => {
              sessionStorage.setItem('installHintDismissed', '1')
              setShowInstallHint(false)
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* List */}
      <main className="px-4 mt-2">
        {loadingData ? (
          <p className="text-center text-ink/50 py-12">Loading products…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center text-ink/50 py-12">
            <p>No products match.</p>
            {products.length === 0 && (
              <p className="mt-1 text-sm">A manager can load the product list from Admin → Import.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line rounded border border-line bg-white overflow-hidden">
            {filtered.map((p) => {
              const st = statusOf(captures.get(p.id))
              const done = st === 'done'
              return (
                <li key={p.id}>
                  <button
                    onClick={() => nav(`/capture/${p.id}`)}
                    className={`w-full text-left px-4 py-3.5 flex items-center gap-3 active:bg-paper ${done ? 'opacity-55' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[15px] leading-snug truncate">{p.product_name}</p>
                      <p className="font-mono text-xs text-ink/55 mt-0.5">
                        {p.sku} · {p.supplier}
                      </p>
                    </div>
                    <StatusBadge status={st} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap ${
        active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink/70'
      }`}
    >
      {label}
    </button>
  )
}
