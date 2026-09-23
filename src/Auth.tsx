import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AUTH_ENABLED, forgetUser, supabase } from './lib/supabase'

// The one screen the design did not already contain. Built from Landing.tsx's
// existing tokens — same serif display face, same indigo, same card treatment —
// so it reads as part of the product rather than a bolted-on gate.

const INPUT: React.CSSProperties = {
  width: '100%', padding: '11px 13px', boxSizing: 'border-box',
  background: '#fff', border: '1px solid #e9e8e4', borderRadius: 10,
  fontSize: 14, color: '#0f0e0d', fontFamily: 'inherit', outline: 'none',
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!AUTH_ENABLED)

  useEffect(() => {
    if (!AUTH_ENABLED) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { forgetUser(); setSession(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!AUTH_ENABLED) return <>{children}</>
  if (!ready) return <Shell><div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div></Shell>
  if (!session) return <SignIn />
  return <>{children}</>
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#f9f9f7', color: '#0f0e0d', fontFamily: "'Inter', system-ui, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>{children}</div>
    </div>
  )
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    const fn = mode === 'in' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { data, error } = await fn.call(supabase.auth, { email: email.trim(), password })
    setBusy(false)
    if (error) return setNote({ ok: false, text: error.message })
    if (mode === 'up' && !data.session) {
      setNote({ ok: true, text: 'Check your inbox to confirm your address, then sign in.' })
    }
  }

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 26 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" fill="#fff" />
            <circle cx="5" cy="6" r="2" fill="#fff" fillOpacity=".7" />
            <circle cx="19" cy="7" r="2" fill="#fff" fillOpacity=".7" />
            <circle cx="6" cy="18" r="2" fill="#fff" fillOpacity=".7" />
            <path d="M12 12 5 6M12 12l7-5M12 12l-6 6" stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" />
          </svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.02em' }}>Pivot</span>
      </div>

      <h1 style={{ margin: '0 0 6px', fontSize: 30, fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, letterSpacing: '-.025em', lineHeight: 1.15 }}>
        {mode === 'in' ? 'Welcome back' : 'Make your brain'}
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
        {mode === 'in' ? 'Sign in to open your graph.' : 'Everything you capture stays yours.'}
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input type="email" required autoComplete="email" placeholder="you@example.com"
          value={email} onChange={e => setEmail(e.target.value)} style={INPUT} />
        <input type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={INPUT} />

        <button type="submit" disabled={busy}
          style={{ marginTop: 4, padding: '12px 26px', background: busy ? '#a5b4fc' : '#4f46e5', border: 'none', borderRadius: 11, color: '#fff', fontSize: 14, fontWeight: 500, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(79,70,229,.3)', letterSpacing: '-.01em', transition: 'background .15s' }}>
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {note && (
        <p style={{ margin: '14px 0 0', fontSize: 12.5, lineHeight: 1.55, color: note.ok ? '#16a34a' : '#ef4444' }}>
          {note.text}
        </p>
      )}

      <button onClick={() => { setMode(m => (m === 'in' ? 'up' : 'in')); setNote(null) }}
        style={{ marginTop: 20, background: 'none', border: 'none', padding: 0, color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
        {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
      </button>
    </Shell>
  )
}
