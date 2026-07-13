import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabaseConfigured } from '../lib/supabase'

export default function SignIn() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(null)
    setNotice(null)
    setBusy(true)
    const err = mode === 'in' ? await signIn(email, password) : await signUp(email, password)
    setBusy(false)
    if (err) setError(err)
    else if (mode === 'up')
      setNotice('Account created. If email confirmation is on, check your inbox, then sign in.')
  }

  return (
    <div className="min-h-dvh bg-paper flex flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="flex items-end gap-[3px] h-8 mb-3" aria-hidden>
            {[2, 5, 2, 3, 6, 2, 4, 2, 6, 3, 2, 5].map((w, i) => (
              <div key={i} style={{ width: w }} className={i === 8 ? 'h-full bg-scan' : 'h-full bg-ink'} />
            ))}
          </div>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-ink">StockShot</h1>
          <p className="text-sm text-ink/60 mt-1">Product + barcode photo capture for stocktake teams.</p>
        </div>

        {!supabaseConfigured && (
          <div className="mb-4 rounded border border-scan/40 bg-scan/5 p-3 text-sm text-ink">
            Backend not configured yet. Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> to your <code className="font-mono">.env</code>{' '}
            file (see README).
          </div>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded border border-line bg-white px-3 py-3 text-base mb-4 focus:outline-none focus:ring-2 focus:ring-ink"
        />
        <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          className="w-full rounded border border-line bg-white px-3 py-3 text-base mb-5 focus:outline-none focus:ring-2 focus:ring-ink"
        />

        {error && <p className="text-sm text-scan mb-3">{error}</p>}
        {notice && <p className="text-sm text-done mb-3">{notice}</p>}

        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="w-full rounded bg-ink text-white py-3.5 text-base font-semibold disabled:opacity-40"
        >
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>

        <button
          onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
          className="w-full mt-3 py-2 text-sm text-ink/60 underline underline-offset-2"
        >
          {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
