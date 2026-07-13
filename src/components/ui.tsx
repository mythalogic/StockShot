import { NavLink } from 'react-router-dom'
import { CaptureStatus } from '../lib/supabase'
import { createContext, useCallback, useContext, useState, ReactNode } from 'react'

/* ---------- Bottom navigation ---------- */
export function BottomNav({ isManager }: { isManager: boolean }) {
  const item =
    'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold uppercase tracking-wide'
  const active = 'text-ink'
  const idle = 'text-ink/40'
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavLink to="/" end className={({ isActive }) => `${item} ${isActive ? active : idle}`}>
        <Glyph d="M4 5h16M4 12h16M4 19h10" />
        Products
      </NavLink>
      <NavLink to="/progress" className={({ isActive }) => `${item} ${isActive ? active : idle}`}>
        <Glyph d="M4 19V9m6 10V5m6 14v-7" />
        Progress
      </NavLink>
      <NavLink to="/export" className={({ isActive }) => `${item} ${isActive ? active : idle}`}>
        <Glyph d="M12 4v10m0 0l-4-4m4 4l4-4M5 20h14" />
        Export
      </NavLink>
      {isManager && (
        <NavLink to="/admin" className={({ isActive }) => `${item} ${isActive ? active : idle}`}>
          <Glyph d="M12 5v14M5 12h14" />
          Admin
        </NavLink>
      )}
    </nav>
  )
}

function Glyph({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- Status badge ---------- */
export function StatusBadge({ status }: { status: CaptureStatus }) {
  if (status === 'done')
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-done/10 text-done">
        ✓ Done
      </span>
    )
  if (status === 'partial')
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-partial/10 text-partial">
        1 of 2 photos
      </span>
    )
  if (status === 'no_image')
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-ink/10 text-ink/60">
        ⊘ No photos
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-ink/5 text-ink/50">
      Not started
    </span>
  )
}

/* ---------- Signature element: barcode-style progress bar ----------
   Progress renders as a strip of thin bars, like a barcode being
   scanned in — filled bars are ink, the leading edge is the red
   scanner line, remaining bars are faint. */
export function BarcodeProgress({ done, total, height = 34 }: { done: number; total: number; height?: number }) {
  const bars = 48
  const filled = total > 0 ? Math.round((done / total) * bars) : 0
  const widths = [2, 4, 2, 6, 3, 2, 5, 2, 3, 4, 2, 2, 6, 3, 2, 4] // barcode-ish rhythm
  return (
    <div className="w-full" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <div className="flex items-stretch gap-[3px]" style={{ height }}>
        {Array.from({ length: bars }).map((_, i) => {
          const w = widths[i % widths.length]
          const isFilled = i < filled
          const isEdge = i === filled - 1 && filled < bars
          return (
            <div
              key={i}
              style={{ width: w }}
              className={
                isEdge
                  ? 'bg-scan'
                  : isFilled
                    ? 'bg-ink'
                    : 'bg-ink/15'
              }
            />
          )
        })}
      </div>
    </div>
  )
}

/* ---------- Toasts ---------- */
interface ToastState {
  toast: (msg: string, kind?: 'ok' | 'err') => void
}
const ToastContext = createContext<ToastState>({ toast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setMsg({ text, kind })
    window.setTimeout(() => setMsg(null), 2600)
  }, [])
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {msg && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
          <div
            className={`rounded px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${
              msg.kind === 'ok' ? 'bg-ink' : 'bg-scan'
            }`}
          >
            {msg.text}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)
