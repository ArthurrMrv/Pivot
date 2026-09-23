import { useEffect, useRef, useState } from 'react'
import { scrollProgress, useReducedMotion, useViewport } from './hooks'
import { notch } from './notch'

// ─── Graph data ───────────────────────────────────────────────────────────────
// `at` is the scroll fraction the node arrives at. Negative means it is already
// there when the page loads, so the hero never opens on an empty canvas.
type Kind = 'doc' | 'note' | 'tag'
interface N { nx: number; ny: number; r: number; kind: Kind; label: string; at: number }

const NODES: N[] = [
  { nx: .08, ny: .22, r: 7, kind: 'doc', label: 'spec.pdf', at: -.1 },
  { nx: .19, ny: .63, r: 6, kind: 'doc', label: 'receipt.png', at: -.1 },
  { nx: .28, ny: .13, r: 5, kind: 'doc', label: 'notes.md', at: -.1 },
  { nx: .12, ny: .85, r: 5, kind: 'doc', label: 'IMG_4471.heic', at: -.1 },
  { nx: .89, ny: .25, r: 7, kind: 'doc', label: 'contract.pdf', at: -.1 },
  { nx: .77, ny: .69, r: 6, kind: 'doc', label: 'slides.pptx', at: -.1 },
  { nx: .94, ny: .57, r: 5, kind: 'doc', label: 'whiteboard.jpg', at: -.1 },
  { nx: .71, ny: .11, r: 5, kind: 'doc', label: 'thread.txt', at: -.1 },

  { nx: .24, ny: .40, r: 9, kind: 'note', label: 'Pricing model', at: .10 },
  { nx: .81, ny: .43, r: 9, kind: 'note', label: 'Onboarding', at: .16 },
  { nx: .35, ny: .79, r: 8, kind: 'note', label: 'Q3 planning', at: .22 },
  { nx: .65, ny: .87, r: 8, kind: 'note', label: 'Churn causes', at: .28 },
  { nx: .50, ny: .29, r: 10, kind: 'note', label: 'Positioning', at: .34 },
  { nx: .05, ny: .46, r: 6, kind: 'note', label: 'Hiring', at: .40 },
  { nx: .96, ny: .81, r: 6, kind: 'note', label: 'Runway', at: .46 },

  { nx: .42, ny: .57, r: 5, kind: 'tag', label: '#pricing', at: .52 },
  { nx: .61, ny: .62, r: 5, kind: 'tag', label: '#growth', at: .58 },
  { nx: .33, ny: .26, r: 4.5, kind: 'tag', label: '#research', at: .64 },
  { nx: .70, ny: .34, r: 4.5, kind: 'tag', label: '#product', at: .70 },
  { nx: .50, ny: .74, r: 4.5, kind: 'tag', label: '#finance', at: .76 },
  { nx: .16, ny: .06, r: 4, kind: 'tag', label: '#team', at: .82 },
  { nx: .86, ny: .07, r: 4, kind: 'tag', label: '#legal', at: .88 },
]

const EDGES: [number, number][] = [
  [0, 8], [2, 8], [1, 14], [3, 10], [4, 14], [5, 9], [6, 11], [7, 12],
  [8, 15], [8, 12], [9, 18], [9, 16], [10, 20], [10, 19], [11, 16], [11, 9],
  [12, 17], [12, 18], [13, 20], [14, 19], [15, 12], [16, 12], [17, 8], [18, 12],
  [19, 14], [21, 4], [13, 10],
]

const FILL: Record<Kind, string> = { doc: '#e4e2dc', note: '#818cf8', tag: '#4ade80' }
const LINE: Record<Kind, string> = { doc: '#c3c0b8', note: '#4f46e5', tag: '#16a34a' }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const REPULSE = 170 // px: how close the cursor has to get before nodes shy away

// ─── Canvas ───────────────────────────────────────────────────────────────────
export function GraphCanvas() {
  const vp = useViewport()
  const reduced = useReducedMotion()
  const ptr = useRef({ x: -9e9, y: -9e9 })
  const [mounted, setMounted] = useState(false)
  const [frame, setFrame] = useState(() => ({ t: 0, p: scrollProgress() }))

  useEffect(() => { const id = setTimeout(() => setMounted(true), 40); return () => clearTimeout(id) }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => { ptr.current = { x: e.clientX, y: e.clientY } }
    const out = () => { ptr.current = { x: -9e9, y: -9e9 } }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerleave', out)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerleave', out) }
  }, [])

  useEffect(() => {
    if (reduced) { setFrame({ t: 0, p: 1 }); return }
    // Narrow screens redraw half as often: same picture, a lot less work per second.
    const budget = vp.w < 760 ? 56 : 28
    let raf = 0
    let last = 0
    const step = (now: number) => {
      if (now - last > budget) { last = now; setFrame(f => ({ t: f.t + 1, p: scrollProgress() })) }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [reduced, vp.w])

  const { t, p } = frame
  const labelled = vp.w > 900

  const pts = NODES.map((n, i) => {
    const a = clamp01((p - n.at) / .07)
    const drift = reduced ? { dx: 0, dy: 0 } : {
      dx: Math.sin(i * 1.4 + t * .012) * 9,
      dy: Math.cos(i * 1.1 + t * .010) * 11,
    }
    // Nodes fly in from a deterministic direction, so the graph assembles rather
    // than just fading up.
    const fly = 110 * (1 - a)
    let x = n.nx * vp.w + drift.dx + Math.cos(i * 2.399) * fly
    let y = n.ny * vp.h + drift.dy + Math.sin(i * 2.399) * fly

    const dx = x - ptr.current.x
    const dy = y - ptr.current.y
    const d = Math.hypot(dx, dy)
    let near = 0
    if (d < REPULSE) {
      near = 1 - d / REPULSE
      x += (dx / (d || 1)) * near * 26
      y += (dy / (d || 1)) * near * 26
    }
    return { n, x, y, a, near, i }
  })

  return (
    <svg
      aria-hidden
      width={vp.w}
      height={vp.h}
      style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        opacity: mounted ? (vp.w < 760 ? .55 : 1) : 0,
        transition: 'opacity 1.1s ease',
      }}
    >
      <defs>
        <radialGradient id="pv-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4f46e5" stopOpacity=".06" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={vp.w / 2} cy={vp.h / 2} rx={vp.w * .45} ry={vp.h * .45} fill="url(#pv-glow)" />

      {EDGES.map(([ai, bi], k) => {
        const a = pts[ai]
        const b = pts[bi]
        const on = Math.min(a.a, b.a)
        if (on <= 0) return null
        const shimmer = reduced ? 0 : Math.sin(t * .016 + k * .8) * .05
        const glow = Math.max(a.near, b.near) * .45
        return (
          <line
            key={k}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#4f46e5" strokeWidth={.9 + glow}
            strokeOpacity={(.13 + shimmer + glow) * on}
          />
        )
      })}

      {pts.map(({ n, x, y, a, near, i }) => {
        if (a <= 0) return null
        const pulse = reduced ? .8 : .72 + Math.sin(t * .02 + i * 1.2) * .12
        const op = a * (pulse + near * .3)
        return (
          <g key={i} opacity={a}>
            <circle cx={x} cy={y} r={n.r + 8 + near * 6} fill={FILL[n.kind]} opacity={.05 + near * .12} />
            {n.kind === 'doc' ? (
              <path
                d={notch(x, y, n.r, Math.min(n.r * .7, 5))}
                fill={FILL.doc} fillOpacity={op} stroke={LINE.doc} strokeWidth=".9" strokeOpacity={.7 * a}
              />
            ) : (
              <circle
                cx={x} cy={y} r={n.r}
                fill={FILL[n.kind]} fillOpacity={op} stroke={LINE[n.kind]} strokeWidth=".9" strokeOpacity={.45 * a}
              />
            )}
            {n.kind !== 'doc' && <circle cx={x} cy={y} r={n.r * .28} fill="#fff" opacity={.85 * a} />}
            {labelled && (
              <text
                x={x} y={y + n.r + 14} textAnchor="middle"
                fill={n.kind === 'tag' ? '#16a34a' : '#8b8a84'}
                fontSize="10.5" fontFamily="Inter, system-ui, sans-serif"
                opacity={a * (.5 + near * .5)}
              >{n.label}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Thread ───────────────────────────────────────────────────────────────────
// Draws itself downward as you scroll, behind the panels. Built in pixels rather
// than a stretched viewBox: a non-uniform viewBox distorts the curve differently
// at every window size, and a non-scaling stroke resolves dashes in screen space
// while getTotalLength reports user units, which desyncs the draw entirely.

/** A lazy S down the page. The swing is capped so it stays a spine on a wide
 *  monitor instead of flinging itself into the margins. */
function threadPath(w: number, h: number) {
  const cx = w / 2
  const a = Math.min(w * .26, 180)
  const y = (f: number) => (h * f).toFixed(1)
  return [
    `M${cx} ${y(.04)}`,
    `C${cx} ${y(.15)} ${cx - a} ${y(.17)} ${cx - a} ${y(.27)}`,
    `C${cx - a} ${y(.36)} ${cx + a} ${y(.37)} ${cx + a} ${y(.45)}`,
    `C${cx + a} ${y(.54)} ${cx - a} ${y(.55)} ${cx - a} ${y(.63)}`,
    `C${cx - a} ${y(.72)} ${cx + a} ${y(.73)} ${cx + a} ${y(.80)}`,
    `C${cx + a} ${y(.88)} ${cx} ${y(.89)} ${cx} ${y(.97)}`,
  ].join('')
}

export function Thread() {
  const ref = useRef<SVGPathElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // The page keeps growing after first paint as fonts land and panels reveal,
  // so measure it continuously instead of trusting the first frame.
  useEffect(() => {
    const root = document.documentElement
    const measure = () => setSize(prev => {
      const w = root.clientWidth
      const h = root.scrollHeight
      return prev.w === w && prev.h === h ? prev : { w, h }
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const d = size.h > 0 ? threadPath(size.w, size.h) : ''

  // Re-measure the path whenever its geometry changes. A stale length leaves the
  // line either permanently drawn or permanently invisible.
  useEffect(() => {
    const el = ref.current
    if (!el || !d) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len)
    const draw = () => { el.style.strokeDashoffset = String(len * (1 - scrollProgress())) }
    draw()
    window.addEventListener('scroll', draw, { passive: true })
    return () => window.removeEventListener('scroll', draw)
  }, [d])

  if (!d) return null

  return (
    <svg
      aria-hidden width={size.w} height={size.h}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
    >
      <path
        ref={ref} d={d} fill="none" stroke="#4f46e5" strokeOpacity=".28"
        strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  )
}
