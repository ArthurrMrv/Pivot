import { useNavigate } from 'react-router'
import { useEffect, useRef, useState } from 'react'

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

// ─── Animated graph ───────────────────────────────────────────────────────────
const NODES = [
  { x: 50, y: 50, r: 8,   label: 'Zettelkasten',  tag: false },
  { x: 76, y: 28, r: 5,   label: 'Reading list',  tag: false },
  { x: 24, y: 33, r: 6,   label: 'Product ideas', tag: false },
  { x: 70, y: 70, r: 4,   label: '#pkm',          tag: true  },
  { x: 30, y: 72, r: 4,   label: '#ideas',        tag: true  },
  { x: 55, y: 84, r: 3.5, label: '#learning',     tag: true  },
  { x: 84, y: 54, r: 4,   label: 'Notes',         tag: false },
  { x: 16, y: 57, r: 3.5, label: '#meta',         tag: true  },
  { x: 50, y: 22, r: 4,   label: 'Deep Work',     tag: false },
]
const EDGES = [[0,1],[0,2],[0,3],[0,4],[1,6],[1,8],[2,7],[2,4],[3,5],[4,5],[1,3],[8,3],[6,3]]

function DecorativeGraph({ visible }: { visible: boolean }) {
  const [t, setT] = useState(0)
  const raf = useRef<number>(0)
  useEffect(() => {
    if (!visible) return
    let last = 0
    const step = (now: number) => {
      if (now - last > 28) { setT(p => p + 1); last = now }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [visible])

  const float = (i: number) => ({
    dx: Math.sin(i * 1.4 + t * 0.011) * 1.5,
    dy: Math.cos(i * 1.1 + t * 0.009) * 1.8,
  })

  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <defs>
        <radialGradient id="lglow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="52" rx="42" ry="36" fill="url(#lglow)" />
      {EDGES.map(([a, b], i) => {
        const na = NODES[a], nb = NODES[b]
        const fa = float(a), fb = float(b)
        const op = 0.18 + Math.sin(t * 0.016 + i * 0.8) * 0.07
        return (
          <line key={i}
            x1={na.x + fa.dx} y1={na.y + fa.dy}
            x2={nb.x + fb.dx} y2={nb.y + fb.dy}
            stroke="#4f46e5" strokeWidth="0.4" strokeOpacity={op}
          />
        )
      })}
      {NODES.map((n, i) => {
        const { dx, dy } = float(i)
        const x = n.x + dx, y = n.y + dy
        const pulse = 0.7 + Math.sin(t * 0.02 + i * 1.2) * 0.15
        const fill = n.tag ? '#4ade80' : '#818cf8'
        const stroke = n.tag ? '#16a34a' : '#4f46e5'
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={n.r + 4} fill={fill} opacity={0.06} />
            <circle cx={x} cy={y} r={n.r} fill={fill} opacity={pulse * 0.7} stroke={stroke} strokeWidth="0.4" strokeOpacity="0.4" />
            <circle cx={x} cy={y} r={n.r * 0.28} fill="#fff" opacity={0.8} />
            <text x={x} y={y + n.r + 4} textAnchor="middle"
              fill="#64748b" fontSize="3" fontFamily="Inter,sans-serif"
              style={{ pointerEvents: 'none' }}
            >{n.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, body, delay, visible }: {
  icon: React.ReactNode; title: string; body: string; delay: number; visible: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '28px 26px 32px',
        background: hov ? '#fff' : 'rgba(255,255,255,.6)',
        border: '1px solid ' + (hov ? '#c7d2fe' : '#eeecea'),
        borderRadius: 16,
        opacity: visible ? 1 : 0,
        transform: visible ? (hov ? 'translateY(-4px)' : 'translateY(0)') : 'translateY(22px)',
        transition: `opacity .5s ${delay}ms, transform .5s ${delay}ms, box-shadow .25s, background .2s, border-color .2s`,
        boxShadow: hov ? '0 12px 40px rgba(79,70,229,.1)' : '0 1px 3px rgba(0,0,0,.04)',
      }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 11, background: hov ? '#eef2ff' : '#f5f4f0', border: '1px solid ' + (hov ? '#c7d2fe' : '#e9e8e4'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: hov ? '#4f46e5' : '#818cf8', marginBottom: 18, transition: 'all .2s' }}>
        {icon}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#0f0e0d', letterSpacing: '-.02em' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13.5, color: '#64748b', lineHeight: 1.65 }}>{body}</p>
    </div>
  )
}

const FEATURES = [
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="19" cy="5" r="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="19" r="2" stroke="currentColor" strokeWidth="1.8"/><line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="5.7" y1="7" x2="11.3" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="18.3" y1="7" x2="12.7" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
    title: 'Think in connections',
    body: "Every note links to others. Ideas surface patterns you'd never find in a flat list.",
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    title: 'Capture anything',
    body: 'Write notes, drop files, add tags. The graph assembles itself as you work.',
  },
  {
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
    title: 'Find it instantly',
    body: 'Full-text search across everything. Hover a result to light up its node in the graph.',
  },
]

// ─── Landing ──────────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate()
  const go = () => navigate('/app')

  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = setTimeout(() => setMounted(true), 60); return () => clearTimeout(id) }, [])

  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  const features = useReveal(0.1)
  const cta = useReveal(0.2)

  return (
    <div style={{ minHeight: '100dvh', background: '#f9f9f7', color: '#0f0e0d', fontFamily: "'Inter', system-ui, sans-serif", overflowX: 'hidden' }}>

      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '0 clamp(20px, 5vw, 64px)', height: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: scrolled ? '1px solid #eeecea' : '1px solid transparent',
        background: scrolled ? 'rgba(249,249,247,.9)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        transition: 'background .3s, border-color .3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.02em' }}>Brainmap</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={go}
            style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #e2e1db', borderRadius: 8, color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color .15s, color .15s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#c7d2fe'; el.style.color = '#4f46e5' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#e2e1db'; el.style.color = '#64748b' }}
          >Sign in</button>
          <button onClick={go}
            style={{ padding: '6px 16px', background: '#4f46e5', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'background .15s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#4338ca'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#4f46e5'}
          >Get started</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 'clamp(32px, 5vw, 72px)', padding: 'clamp(90px, 12vh, 130px) clamp(20px, 7vw, 88px) clamp(60px, 8vh, 80px)' }}>

        <div style={{ maxWidth: 520 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 20, padding: '4px 12px', marginBottom: 26, opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)', transition: 'opacity .5s, transform .5s' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4f46e5' }} />
            <span style={{ fontSize: 11.5, color: '#4f46e5', fontWeight: 500, letterSpacing: '.04em' }}>Personal knowledge graph</span>
          </div>

          <h1 style={{ margin: '0 0 18px', fontSize: 'clamp(36px, 4.5vw, 58px)', fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, lineHeight: 1.1, letterSpacing: '-.025em', color: '#0f0e0d', opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(14px)', transition: 'opacity .55s .07s, transform .55s .07s' }}>
            Your ideas,<br />
            <em style={{ fontStyle: 'italic', color: '#4f46e5' }}>finally connected.</em>
          </h1>

          <p style={{ margin: '0 0 34px', fontSize: 16, color: '#64748b', lineHeight: 1.72, maxWidth: 430, opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(12px)', transition: 'opacity .55s .14s, transform .55s .14s' }}>
            A living map of everything you know. Write notes, link concepts, follow threads — and watch understanding emerge from the connections.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(10px)', transition: 'opacity .5s .22s, transform .5s .22s' }}>
            <button onClick={go}
              style={{ padding: '12px 26px', background: '#4f46e5', border: 'none', borderRadius: 11, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(79,70,229,.3)', letterSpacing: '-.01em', transition: 'background .15s, transform .15s, box-shadow .15s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#4338ca'; el.style.transform = 'translateY(-1px)'; el.style.boxShadow = '0 6px 24px rgba(79,70,229,.4)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#4f46e5'; el.style.transform = 'none'; el.style.boxShadow = '0 4px 20px rgba(79,70,229,.3)' }}
            >Start for free</button>
            <button onClick={go}
              style={{ padding: '12px 22px', background: 'transparent', border: '1px solid #e2e1db', borderRadius: 11, color: '#64748b', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color .15s, color .15s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#c7d2fe'; el.style.color = '#4f46e5' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#e2e1db'; el.style.color = '#64748b' }}
            >Sign in</button>
          </div>

          <p style={{ marginTop: 16, fontSize: 12, color: '#b0afa9', opacity: mounted ? 1 : 0, transition: 'opacity .5s .35s' }}>
            No account needed to try · Free forever
          </p>
        </div>

        {/* Animated graph */}
        <div style={{ aspectRatio: '1', maxWidth: 460, width: '100%', margin: '0 auto', position: 'relative', opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'scale(.96) translateY(10px)', transition: 'opacity .7s .1s, transform .7s .1s' }}>
          <div style={{ position: 'absolute', inset: '8%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(79,70,229,.07) 0%, transparent 70%)' }} />
          <DecorativeGraph visible={mounted} />
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: 'clamp(64px, 8vw, 96px) clamp(20px, 7vw, 88px)', borderTop: '1px solid #eeecea', background: '#fff' }}>
        <div ref={features.ref} style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ margin: '0 0 44px', fontSize: 'clamp(24px, 3vw, 34px)', fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, color: '#0f0e0d', letterSpacing: '-.02em', opacity: features.visible ? 1 : 0, transform: features.visible ? 'none' : 'translateY(16px)', transition: 'opacity .5s, transform .5s' }}>
            How it works
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20 }}>
            {FEATURES.map((f, i) => (
              <FeatureCard key={i} {...f} delay={i * 90} visible={features.visible} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: 'clamp(72px, 9vw, 112px) clamp(20px, 7vw, 88px)', borderTop: '1px solid #eeecea', textAlign: 'center' }}>
        <div ref={cta.ref}>
          <h2 style={{ margin: '0 0 12px', fontSize: 'clamp(26px, 3.5vw, 40px)', fontFamily: "'DM Serif Display', Georgia, serif", fontWeight: 400, color: '#0f0e0d', letterSpacing: '-.02em', opacity: cta.visible ? 1 : 0, transform: cta.visible ? 'none' : 'translateY(16px)', transition: 'opacity .5s, transform .5s' }}>
            Ready to build your second brain?
          </h2>
          <p style={{ margin: '0 0 30px', fontSize: 14, color: '#94a3b8', opacity: cta.visible ? 1 : 0, transition: 'opacity .5s .1s' }}>
            It takes 30 seconds to get started.
          </p>
          <button onClick={go}
            style={{ padding: '13px 34px', background: '#4f46e5', border: 'none', borderRadius: 11, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 20px rgba(79,70,229,.3)', letterSpacing: '-.01em', opacity: cta.visible ? 1 : 0, transform: cta.visible ? 'none' : 'translateY(10px)', transition: `opacity .5s .18s, transform .5s .18s, background .15s, box-shadow .15s` }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#4338ca'; el.style.boxShadow = '0 6px 28px rgba(79,70,229,.45)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#4f46e5'; el.style.boxShadow = '0 4px 20px rgba(79,70,229,.3)' }}
          >Open the app →</button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '18px clamp(20px, 7vw, 88px)', borderTop: '1px solid #eeecea', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: 12, color: '#c8c7c2' }}>© 2026 Brainmap</span>
        <span style={{ fontSize: 12, color: '#c8c7c2' }}>Built for curious minds.</span>
      </footer>

      <style>{`
        @media (max-width: 720px) {
          section:nth-of-type(1) { grid-template-columns: 1fr !important; }
          section:nth-of-type(1) > div:last-child { display: none !important; }
        }
      `}</style>
    </div>
  )
}
