import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { GraphCanvas, Thread } from './landing/Canvas'
import { Chip, Eyebrow, Panel, type Side } from './landing/Panel'
import { useCountUp, useReveal } from './landing/hooks'

const SERIF = "'DM Serif Display', Georgia, serif"
const H2: CSSProperties = { margin: '0 0 10px', fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(22px, 2.6vw, 30px)', letterSpacing: '-.02em', color: '#0f0e0d', lineHeight: 1.18 }
const BODY: CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.72, color: '#64748b' }

const REPO = 'https://github.com/ArthurrMrv/Pivot'
const REPO_LABEL = 'ArthurrMrv/Pivot'

// ─── GitHub ───────────────────────────────────────────────────────────────────
function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/** Outlined link that matches the Ghost button, for anchors rather than actions. */
function GhostLink({ href, children, pad = '9px 18px', label }: {
  href: string; children: ReactNode; pad?: string; label: string
}) {
  const [hov, setHov] = useState(false)
  return (
    <a
      href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: pad, fontSize: 13, fontFamily: 'inherit', textDecoration: 'none',
        color: hov ? '#4f46e5' : '#64748b',
        background: hov ? 'rgba(79,70,229,.05)' : 'transparent',
        border: '1px solid ' + (hov ? 'rgba(79,70,229,.32)' : 'rgba(15,14,13,.1)'),
        borderRadius: '4px 14px 4px 14px',
        transition: 'color .15s, border-color .15s, background .15s',
      }}
    >{children}</a>
  )
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function Primary({ onClick, children, big = false }: { onClick: () => void; children: string; big?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: big ? '13px 30px' : '9px 20px',
        fontSize: big ? 14 : 13,
        fontWeight: 500,
        fontFamily: 'inherit',
        letterSpacing: '-.01em',
        color: '#fff',
        cursor: 'pointer',
        border: 'none',
        borderRadius: big ? '18px 4px 18px 4px' : '14px 4px 14px 4px',
        background: hov ? '#4338ca' : '#4f46e5',
        boxShadow: hov ? '0 10px 30px -8px rgba(79,70,229,.6)' : '0 6px 22px -10px rgba(79,70,229,.7)',
        transform: hov ? 'translateY(-1px)' : 'none',
        transition: 'background .15s, box-shadow .2s, transform .2s',
      }}
    >{children}</button>
  )
}

function Ghost({ onClick, children, big = false }: { onClick: () => void; children: string; big?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: big ? '13px 26px' : '9px 18px',
        fontSize: big ? 14 : 13,
        fontFamily: 'inherit',
        color: hov ? '#4f46e5' : '#64748b',
        cursor: 'pointer',
        background: hov ? 'rgba(79,70,229,.05)' : 'transparent',
        border: '1px solid ' + (hov ? 'rgba(79,70,229,.32)' : 'rgba(15,14,13,.1)'),
        borderRadius: big ? '4px 18px 4px 18px' : '4px 14px 4px 14px',
        transition: 'color .15s, border-color .15s, background .15s',
      }}
    >{children}</button>
  )
}

// ─── Merge counter ────────────────────────────────────────────────────────────
function MergeCounter() {
  const { ref, visible } = useReveal(.5)
  const notes = useCountUp(204, 41, visible)
  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '4px 0 16px' }}>
      <span style={{ fontFamily: SERIF, fontSize: 40, color: '#b0afa9', lineHeight: 1 }}>204</span>
      <span style={{ fontSize: 12, color: '#b0afa9' }}>files</span>
      <span style={{ fontSize: 18, color: '#c8c7c2' }}>&rarr;</span>
      <span style={{ fontFamily: SERIF, fontSize: 40, color: '#4f46e5', lineHeight: 1 }}>{notes}</span>
      <span style={{ fontSize: 12, color: '#4f46e5' }}>notes</span>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────
function Row({ side, children, tall = false }: { side: Side; children: ReactNode; tall?: boolean }) {
  const justify = side === 'left' ? 'flex-start' : side === 'right' ? 'flex-end' : 'center'
  return (
    <section
      className="pv-row"
      style={{
        position: 'relative',
        zIndex: 2,
        minHeight: tall ? '100dvh' : '74vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: justify,
        padding: '0 clamp(20px, 6vw, 96px)',
      }}
    >
      {children}
    </section>
  )
}

// ─── Landing ──────────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate()
  const go = () => navigate('/app')

  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = setTimeout(() => setMounted(true), 60); return () => clearTimeout(id) }, [])

  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 24)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  const step = (i: number): CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'none' : 'translateY(12px)',
    transition: `opacity .6s ${i * 80}ms, transform .6s ${i * 80}ms`,
  })

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', background: '#f9f9f7', color: '#0f0e0d', fontFamily: "'Inter', system-ui, sans-serif", overflowX: 'hidden' }}>
      <GraphCanvas />
      <Thread />

      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 14, left: 'clamp(14px, 4vw, 40px)', right: 'clamp(14px, 4vw, 40px)', zIndex: 60,
        height: 52, padding: '0 10px 0 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderRadius: '26px 8px 26px 8px',
        border: '1px solid ' + (scrolled ? 'rgba(15,14,13,.08)' : 'rgba(15,14,13,0)'),
        background: scrolled ? 'rgba(249,249,247,.78)' : 'rgba(249,249,247,0)',
        backdropFilter: scrolled ? 'blur(18px) saturate(1.1)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(18px) saturate(1.1)' : 'none',
        boxShadow: scrolled ? '0 14px 40px -26px rgba(15,14,13,.5)' : 'none',
        transition: 'background .3s, border-color .3s, box-shadow .3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '10px 3px 10px 3px', background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.02em' }}>Pivot</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GhostLink href={REPO} pad="9px 12px" label="Pivot on GitHub"><GitHubMark size={15} /></GhostLink>
          <Ghost onClick={go}>Sign in</Ghost>
          <Primary onClick={go}>Get started</Primary>
        </div>
      </nav>

      {/* Hero */}
      <Row side="center" tall>
        <div style={{
          width: '100%', maxWidth: 640, padding: 'clamp(34px, 5vw, 48px)',
          borderRadius: '44px 8px 44px 8px',
          border: '1px solid rgba(15,14,13,.07)',
          background: 'rgba(249,249,247,.82)',
          backdropFilter: 'blur(20px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.1)',
          boxShadow: '0 40px 90px -46px rgba(15,14,13,.6)',
          ...step(0),
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 13px', marginBottom: 24, borderRadius: '14px 4px 14px 4px', background: 'rgba(79,70,229,.07)', border: '1px solid rgba(79,70,229,.18)', ...step(1) }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4f46e5' }} />
            <span style={{ fontSize: 11.5, fontWeight: 500, color: '#4f46e5', letterSpacing: '.05em' }}>Documents in, graph out</span>
          </div>

          <h1 style={{ margin: '0 0 20px', fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(36px, 5vw, 62px)', lineHeight: 1.06, letterSpacing: '-.03em', ...step(2) }}>
            Drop everything in.<br />
            <em style={{ fontStyle: 'italic', color: '#4f46e5' }}>Watch it link itself.</em>
          </h1>

          <p style={{ margin: '0 0 30px', fontSize: 16, lineHeight: 1.72, color: '#64748b', maxWidth: 480, ...step(3) }}>
            PDFs, screenshots, markdown, exports, whatever you have saved. Pivot reads
            each file, writes it up as a note, works out which ones were the same thing
            twice, and links the rest into a graph you can search.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', ...step(4) }}>
            <Primary onClick={go} big>Start for free</Primary>
            <Ghost onClick={go} big>Sign in</Ghost>
          </div>

          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...step(5) }}>
            <span style={{ fontSize: 12, color: '#b0afa9' }}>Open source.</span>
            <GhostLink href={REPO} pad="6px 12px" label="Pivot on GitHub">
              <GitHubMark size={14} />
              <span style={{ fontSize: 12 }}>{REPO_LABEL}</span>
            </GhostLink>
          </div>
        </div>
      </Row>

      {/* 01 */}
      <Row side="left">
        <Panel side="left" maxWidth={470}>
          <Eyebrow n="01">Intake</Eyebrow>
          <h2 style={H2}>Everything goes in</h2>
          <p style={BODY}>
            Drag in a folder of PDFs, a year of screenshots, a pile of half written
            markdown. Pivot takes the file types you already have and never asks you
            to convert anything first.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18 }}>
            {['pdf', 'png', 'jpg', 'heic', 'md', 'docx', 'txt', 'csv'].map(x => <Chip key={x}>{x}</Chip>)}
          </div>
        </Panel>
      </Row>

      {/* 02 */}
      <Row side="right">
        <Panel side="right" maxWidth={470}>
          <Eyebrow n="02">Reading</Eyebrow>
          <h2 style={H2}>Every file comes back as a note</h2>
          <p style={BODY}>
            A vision model transcribes what it can see, then writes the file up in
            plain prose with a title, a summary and tags. You end up reading notes
            instead of squinting at filenames.
          </p>
          <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: '4px 16px 4px 16px', background: 'rgba(15,14,13,.03)', border: '1px solid rgba(15,14,13,.06)' }}>
            <div style={{ fontSize: 11, color: '#b0afa9', marginBottom: 6 }}>whiteboard.jpg</div>
            <div style={{ fontSize: 13, color: '#0f0e0d', fontWeight: 500, marginBottom: 4 }}>Pricing tiers, Feb offsite</div>
            <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
              Three tiers sketched on the board, with seat based pricing crossed out in
              favour of usage. Links to <span style={{ color: '#4f46e5' }}>[[Positioning]]</span>.
            </div>
          </div>
        </Panel>
      </Row>

      {/* 03 */}
      <Row side="left">
        <Panel side="left" maxWidth={470}>
          <Eyebrow n="03">Merging</Eyebrow>
          <h2 style={H2}>Duplicates collapse</h2>
          <MergeCounter />
          <p style={BODY}>
            The same slide photographed twice, the same PDF saved in two places, the
            same idea written down three times. Pivot works out which files were really
            one thing and merges them into a single note.
          </p>
        </Panel>
      </Row>

      {/* 04 */}
      <Row side="right">
        <Panel side="right" maxWidth={470}>
          <Eyebrow n="04">Vocabulary</Eyebrow>
          <h2 style={H2}>Tags stay a vocabulary, not a landfill</h2>
          <p style={BODY}>
            New tags get matched against the ones you already use instead of spawning
            near duplicates. One pricing tag, not four spellings of it.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18 }}>
            {['#pricing', '#growth', '#research', '#product', '#finance'].map(x => <Chip key={x} tone="tag">{x}</Chip>)}
          </div>
        </Panel>
      </Row>

      {/* Self-host */}
      <Row side="center">
        <Panel side="center" maxWidth={560}>
          <Eyebrow n="05">Ownership</Eyebrow>
          <h2 style={H2}>Your Supabase. Your model.</h2>
          <p style={BODY}>
            Point Pivot at any OpenAI compatible endpoint, including one running on the
            machine under your desk. The database, the storage bucket and the worker are
            all yours, so nothing leaves your infrastructure unless you send it there.
          </p>
        </Panel>
      </Row>

      {/* CTA */}
      <Row side="center">
        <Panel side="center" maxWidth={520} pad="44px 40px 46px">
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ ...H2, fontSize: 'clamp(26px, 3.4vw, 38px)', marginBottom: 12 }}>Start with one folder.</h2>
            <p style={{ ...BODY, marginBottom: 26 }}>It takes about a minute to get the first notes back.</p>
            <Primary onClick={go} big>Open Pivot</Primary>
          </div>
        </Panel>
      </Row>

      {/* Footer */}
      <footer style={{ position: 'relative', zIndex: 2, padding: '20px clamp(20px, 6vw, 96px) 28px', borderTop: '1px solid rgba(15,14,13,.06)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, background: 'rgba(249,249,247,.7)', backdropFilter: 'blur(10px)' }}>
        <span style={{ fontSize: 12, color: '#b0afa9' }}>&copy; 2026 Pivot</span>
        <span style={{ fontSize: 12, color: '#b0afa9' }}>Built for people with too many files.</span>
      </footer>

      <style>{`
        @media (max-width: 760px) {
          .pv-row { justify-content: center !important; min-height: 62vh; }
        }
      `}</style>
    </div>
  )
}
