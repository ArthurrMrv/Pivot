import { useState, type ReactNode, type MouseEvent } from 'react'
import { useReducedMotion, useReveal } from './hooks'

export type Side = 'left' | 'right' | 'center'

/** Two diagonally opposite corners rounded hard, the other two near square.
 *  The diagonal flips with the side so the pair reads as a mirrored set. */
const RADIUS: Record<Side, string> = {
  left: '30px 6px 30px 6px',
  right: '6px 30px 6px 30px',
  center: '30px 6px 30px 6px',
}

interface Pointer { x: number; y: number; w: number; h: number }

export function Panel({ side = 'center', maxWidth = 460, pad = '30px 32px 34px', children }: {
  side?: Side
  maxWidth?: number
  pad?: string
  children: ReactNode
}) {
  const { ref, visible } = useReveal(.18)
  const reduced = useReducedMotion()
  const [pt, setPt] = useState<Pointer | null>(null)

  const rx = pt ? (.5 - pt.y / pt.h) * 5 : 0
  const ry = pt ? (pt.x / pt.w - .5) * 5 : 0

  const track = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPt({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height })
  }

  return (
    <div
      ref={ref}
      onMouseMove={reduced ? undefined : track}
      onMouseLeave={() => setPt(null)}
      style={{
        width: '100%',
        maxWidth,
        padding: pad,
        borderRadius: RADIUS[side],
        border: '1px solid ' + (pt ? 'rgba(79,70,229,.3)' : 'rgba(15,14,13,.07)'),
        background: pt
          ? `radial-gradient(340px circle at ${pt.x}px ${pt.y}px, rgba(79,70,229,.12), rgba(255,255,255,0) 62%), rgba(255,255,255,.84)`
          : 'rgba(255,255,255,.76)',
        backdropFilter: 'blur(16px) saturate(1.08)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
        boxShadow: pt
          ? '0 28px 70px -28px rgba(79,70,229,.45)'
          : '0 18px 56px -30px rgba(15,14,13,.45)',
        opacity: visible ? 1 : 0,
        transform: visible
          ? `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(${pt ? -4 : 0}px)`
          : 'perspective(900px) translateY(26px)',
        transition: 'opacity .6s, transform .35s cubic-bezier(.2,.7,.3,1), border-color .25s, box-shadow .35s, background .2s',
      }}
    >
      {children}
    </div>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'tag' }) {
  const isTag = tone === 'tag'
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 11px',
      fontSize: 11.5,
      borderRadius: '12px 3px 12px 3px',
      color: isTag ? '#15803d' : '#64748b',
      background: isTag ? 'rgba(74,222,128,.13)' : 'rgba(15,14,13,.04)',
      border: '1px solid ' + (isTag ? 'rgba(22,163,74,.22)' : 'rgba(15,14,13,.07)'),
    }}>{children}</span>
  )
}

export function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#4f46e5', letterSpacing: '.12em' }}>{n}</span>
      <span style={{ fontSize: 11, color: '#b0afa9', letterSpacing: '.12em', textTransform: 'uppercase' }}>{children}</span>
    </div>
  )
}
