import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ingestFiles, uploadDoc } from './lib/api'
import { useNotes } from './lib/useNotes'
import { useIngest } from './lib/useIngest'
import { batchPhase, PHASE_LABEL } from './lib/phase'
import type { IngestItem } from './lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface NoteDoc {
  id: string
  name: string
  ext: string   // 'pdf' | 'md' | 'png' | 'docx' | etc.
  size: number  // bytes
  preview?: string // signed URL, images only
  url?: string     // signed URL, any document — the card opens it
}
interface Note {
  id: string
  name: string
  content: string
  created: number
  modified: number
  docs?: NoteDoc[]
}
type NodeKind = 'note' | 'tag'
interface GNode { id: string; name: string; kind: NodeKind; x: number; y: number; vx: number; vy: number; degree: number }
interface GLink { source: string; target: string }

// ─── Utils ────────────────────────────────────────────────────────────────────
const extractTags = (c: string) => [...new Set([...c.matchAll(/#([\w-]+)/g)].map(m => m[1]))]
const extractLinks = (c: string) => [...new Set([...c.matchAll(/\[\[(.+?)\]\]/g)].map(m => m[1]))]
const timeAgo = (ts: number) => {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
const renderMd = (md: string) => {
  let h = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  h = h.replace(/```[\w]*\n([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
  h = h.replace(/\[\[(.+?)\]\]/g, (_, n) => `<span class="wl" data-link="${n}">${n}</span>`)
  h = h.replace(/#([\w-]+)/g, '<span class="tag-inline">#$1</span>')
  h = h.replace(/^---$/gm, '<hr/>')
  h = h.replace(/^- \[ \] (.+)$/gm, '<li class="task"><input type="checkbox" disabled/><span>$1</span></li>')
  h = h.replace(/^- \[x\] (.+)$/gm, '<li class="task done"><input type="checkbox" checked disabled/><span>$1</span></li>')
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>')
  h = h.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
  h = h.replace(/^(?!<[a-zA-Z/]).+$/gm, l => l.trim() ? `<p>${l}</p>` : '')
  return h
}
const cleanSnippet = (content: string) => content.replace(/#+\s|#[\w-]+|\*\*|\[\[|\]\]/g, '').trim()

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return w
}

// ─── Shared primitives ────────────────────────────────────────────────────────
const XIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
)

function CloseButton({ onClick }: { onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick}
      style={{ width: 27, height: 27, background: hov ? '#f5f4f0' : 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
    ><XIcon /></button>
  )
}

// Reused row in SearchOverlay, InlineSearch, and TagPanel
function NoteListRow({ note, isLast, snippet, onClick, onMouseEnter, onMouseLeave }: {
  note: Note; isLast: boolean; snippet: string
  onClick: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={onClick}
      style={{ padding: '12px 18px', borderBottom: isLast ? 'none' : '1px solid #fafaf8', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start', background: hov ? '#fafaf8' : 'transparent' }}
      onMouseEnter={() => { setHov(true); onMouseEnter?.() }}
      onMouseLeave={() => { setHov(false); onMouseLeave?.() }}
    >
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#c7d2fe', marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#0f0e0d', marginBottom: 3 }}>{note.name}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet}</div>
      </div>
      <div style={{ fontSize: 11, color: '#e2e1db', flexShrink: 0, marginTop: 2 }}>{timeAgo(note.modified)}</div>
    </div>
  )
}

// SlidePanel:
//   - phone (<640): full-screen overlay, slides up from bottom (position fixed)
//   - desktop (≥1024): right sidebar 420px, slides in from right
//   - tablet (640-1023): same as desktop sidebar but without the top-bar shift
function SlidePanel({ open, isMobile, children }: { open: boolean; isMobile: boolean; children: React.ReactNode }) {
  const style: React.CSSProperties = isMobile
    ? {
        // Full screen on phone — slides up like a native sheet
        position: 'fixed', inset: 0,
        background: '#fff',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .3s cubic-bezier(.32,.72,0,1)',
        zIndex: 50,
        // Content clears the island at the top and home indicator at bottom
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }
    : {
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 420,
        background: '#fff', borderLeft: '1px solid #f1f0ec',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform .28s cubic-bezier(.32,.72,0,1)',
        boxShadow: '-12px 0 40px rgba(0,0,0,.06)',
        zIndex: 10,
      }
  return <div style={style}>{children}</div>
}

// ─── Force layout ─────────────────────────────────────────────────────────────
function runForce(nodes: GNode[], links: GLink[], w: number, h: number) {
  if (!nodes.length) return new Map<string, { x: number; y: number }>()
  const sim = nodes.map((n, i) => ({
    ...n,
    x: w / 2 + Math.cos((i / nodes.length) * Math.PI * 2) * 180,
    y: h / 2 + Math.sin((i / nodes.length) * Math.PI * 2) * 180,
    vx: 0, vy: 0,
  }))
  for (let t = 0; t < 300; t++) {
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const dx = sim[j].x - sim[i].x || .01, dy = sim[j].y - sim[i].y || .01
        const d2 = dx * dx + dy * dy, d = Math.sqrt(d2), f = 3800 / d2
        sim[i].vx -= f * dx / d; sim[i].vy -= f * dy / d
        sim[j].vx += f * dx / d; sim[j].vy += f * dy / d
      }
    }
    links.forEach(l => {
      const s = sim.find(n => n.id === l.source), t2 = sim.find(n => n.id === l.target)
      if (!s || !t2) return
      const dx = t2.x - s.x, dy = t2.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - 100) * 0.045
      s.vx += f * dx / d; s.vy += f * dy / d; t2.vx -= f * dx / d; t2.vy -= f * dy / d
    })
    sim.forEach(n => { n.vx += (w / 2 - n.x) * .005; n.vy += (h / 2 - n.y) * .005 })
    sim.forEach(n => {
      n.vx *= .84; n.vy *= .84; n.x += n.vx; n.y += n.vy
      n.x = Math.max(50, Math.min(w - 50, n.x)); n.y = Math.max(50, Math.min(h - 50, n.y))
    })
  }
  const m = new Map<string, { x: number; y: number }>()
  sim.forEach(n => m.set(n.id, { x: n.x, y: n.y }))
  return m
}

// ─── Inline search (desktop) — expands in top bar, results drop below ─────────
function InlineSearch({ notes, onSelect, onHoverNote, inputRef: externalRef }: {
  notes: Note[]
  onSelect: (id: string) => void
  onHoverNote: (id: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Expose the input for ⌘K focus
  useEffect(() => {
    if (externalRef) (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = inputRef.current
  })

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return [...notes].sort((a, b) => b.modified - a.modified).slice(0, 6)
    return notes.filter(n => n.name.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
      .sort((a, b) => b.modified - a.modified).slice(0, 8)
  }, [q, notes])

  const getSnippet = (n: Note) => {
    const query = q.trim().toLowerCase()
    const raw = cleanSnippet(n.content)
    if (!query) return raw.slice(0, 70) + (raw.length > 70 ? '…' : '')
    const idx = raw.toLowerCase().indexOf(query)
    if (idx === -1) return raw.slice(0, 70) + '…'
    const start = Math.max(0, idx - 20)
    return (start > 0 ? '…' : '') + raw.slice(start, idx + query.length + 50) + '…'
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQ(''); onHoverNote('')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, onHoverNote])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setQ(''); onHoverNote(''); inputRef.current?.blur() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onHoverNote])

  const showDropdown = open && results.length > 0

  return (
    <div ref={wrapRef} style={{ position: 'relative', pointerEvents: 'auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        background: open ? 'rgba(255,255,255,.98)' : 'rgba(255,255,255,.9)',
        backdropFilter: 'blur(16px)',
        borderRadius: showDropdown ? '12px 12px 0 0' : 12,
        padding: '8px 14px',
        border: open ? '1px solid #c7d2fe' : '1px solid #f1f0ec',
        boxShadow: open ? '0 2px 16px rgba(79,70,229,.12)' : '0 2px 12px rgba(0,0,0,.07)',
        width: open ? 'min(560px, calc(100vw - 160px))' : 380,
        transition: 'width .22s cubic-bezier(.32,.72,0,1), border-radius .15s, border .15s',
        cursor: open ? 'text' : 'pointer',
        overflow: 'hidden',
      }} onClick={() => { if (!open) { setOpen(true); setTimeout(() => inputRef.current?.focus(), 10) } }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: open ? .5 : .4, flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" stroke="#0f0e0d" strokeWidth="2" />
          <path d="m21 21-4.35-4.35" stroke="#0f0e0d" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search…"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#0f0e0d', fontFamily: 'inherit', background: 'transparent', minWidth: 0 }}
          onFocus={() => setOpen(true)}
        />
        {open && q
          ? <button onClick={e => { e.stopPropagation(); setQ('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', display: 'flex', padding: 0, flexShrink: 0 }}>
              <XIcon size={12} />
            </button>
          : !open && <kbd style={{ fontSize: 10, background: '#f5f4f0', border: '1px solid #e9e8e4', borderRadius: 5, padding: '1px 5px', color: '#b0afa9', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' }}>⌘K</kbd>
        }
      </div>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: 'rgba(255,255,255,.98)', backdropFilter: 'blur(16px)',
          border: '1px solid #c7d2fe', borderTop: '1px solid #eef0fb',
          borderRadius: '0 0 12px 12px',
          boxShadow: '0 16px 40px rgba(0,0,0,.1)',
          overflow: 'hidden',
          zIndex: 30,
        }}>
          {!q && <div style={{ padding: '7px 14px 4px', fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.08em' }}>Recent</div>}
          {results.map((n, i) => (
            <NoteListRow key={n.id} note={n} isLast={i === results.length - 1}
              snippet={getSnippet(n)}
              onClick={() => { onSelect(n.id); setOpen(false); setQ(''); onHoverNote('') }}
              onMouseEnter={() => onHoverNote(n.id)}
              onMouseLeave={() => onHoverNote('')}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Note dots are fixed; a tag grows with its links but flattens out — sqrt, so
// the 20th link adds a hair and nothing can dwarf the canvas.
const NOTE_R = 5
const TAG_R_MIN = 7
const TAG_R_MAX = 14
const tagRadius = (degree: number) =>
  Math.min(TAG_R_MAX, TAG_R_MIN + Math.sqrt(Math.max(0, degree)) * 2)

// ─── Graph ────────────────────────────────────────────────────────────────────
function GraphCanvas({ notes, focusId, searchHoverId, onNodeClick }: {
  notes: Note[]
  focusId: string
  searchHoverId: string
  onNodeClick: (id: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 900, h: 700 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState('')
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(new Map())
  const dragStart = useRef<{ ox: number; oy: number } | null>(null)
  const dragged = useRef(false)
  const [sel, setSel] = useState<string[]>([])   // shift-click multi-select

  const { nodes, links } = useMemo(() => {
    const ns: GNode[] = notes.map(n => ({ id: n.id, name: n.name, kind: 'note', x: 0, y: 0, vx: 0, vy: 0, degree: 0 }))
    const byTag = new Map<string, string[]>()
    notes.forEach(n => extractTags(n.content).forEach(t => {
      const tid = `t:${t}`
      if (!byTag.has(tid)) byTag.set(tid, [])
      byTag.get(tid)!.push(n.id)
    }))
    // A tag on a single note connects nothing — it is clutter, not structure.
    const tagMap = new Map([...byTag].filter(([, ids]) => ids.length > 1))
    const tn: GNode[] = []
    tagMap.forEach((_, tid) => tn.push({ id: tid, name: tid.slice(2), kind: 'tag', x: 0, y: 0, vx: 0, vy: 0, degree: 0 }))
    const all = [...ns, ...tn]
    const ls: GLink[] = []
    notes.forEach(n => extractLinks(n.content).forEach(ln => {
      const t = notes.find(x => x.name.toLowerCase() === ln.toLowerCase())
      if (t && t.id !== n.id && !ls.find(l => l.source === n.id && l.target === t.id))
        ls.push({ source: n.id, target: t.id })
    }))
    tagMap.forEach((ids, tid) => ids.forEach(nid => ls.push({ source: nid, target: tid })))
    all.forEach(n => { n.degree = ls.filter(l => l.source === n.id || l.target === n.id).length })
    return { nodes: all, links: ls }
  }, [notes])

  useEffect(() => {
    const el = wrapRef.current; if (!el) return
    const obs = new ResizeObserver(e => {
      const r = e[0].contentRect
      setDims({ w: r.width, h: r.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => { setPos(runForce(nodes, links, dims.w, dims.h)) }, [nodes.length, links.length, dims.w, dims.h])

  // Shift-click anchors win over the single focused node; with several, only
  // what every one of them touches stays lit.
  const anchors = useMemo(
    () => new Set(sel.length ? sel.filter(id => nodes.some(n => n.id === id)) : focusId ? [focusId] : []),
    [sel, focusId, nodes],
  )

  const connected = useMemo(() => {
    if (!anchors.size) return new Set<string>()
    const sets = [...anchors].map(id => new Set(
      links.filter(l => l.source === id || l.target === id).map(l => (l.source === id ? l.target : l.source)),
    ))
    return new Set([...sets[0]].filter(id => sets.every(s => s.has(id))))
  }, [anchors, links])

  return (
    <div ref={wrapRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor: dragStart.current ? 'grabbing' : 'grab' }}
      onMouseDown={e => { dragStart.current = { ox: e.clientX - pan.x, oy: e.clientY - pan.y }; dragged.current = false }}
      onMouseMove={e => { if (dragStart.current) { dragged.current = true; setPan({ x: e.clientX - dragStart.current.ox, y: e.clientY - dragStart.current.oy }) } }}
      onClick={() => { if (!dragged.current) setSel([]) }}
      onMouseUp={() => { dragStart.current = null }}
      onMouseLeave={() => { dragStart.current = null }}
      onWheel={e => { e.preventDefault(); setZoom(z => Math.max(.25, Math.min(3.5, z * (e.deltaY > 0 ? .92 : 1.08)))) }}
    >
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <defs>
          <pattern id="dot" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".8" fill="#dddbd5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot)" />
      </svg>

      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {links.map((l, i) => {
            const s = pos.get(l.source), t = pos.get(l.target)
            if (!s || !t) return null
            const sn = nodes.find(n => n.id === l.source)
            const tn = nodes.find(n => n.id === l.target)
            const isTag = sn?.kind === 'tag' || tn?.kind === 'tag'
            const active = (anchors.has(l.source) && (connected.has(l.target) || anchors.has(l.target)))
              || (anchors.has(l.target) && (connected.has(l.source) || anchors.has(l.source)))
            const hov = hovered && (l.source === hovered || l.target === hovered)
            return (
              <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={active ? (isTag ? '#22c55e' : '#818cf8') : hov ? '#94a3b8' : '#e2e1db'}
                strokeWidth={active ? 1.5 : .8}
                strokeDasharray={isTag ? '4 4' : undefined}
                strokeOpacity={active ? .7 : 1}
              />
            )
          })}
          {nodes.map(node => {
            const p = pos.get(node.id); if (!p) return null
            const isNote = node.kind === 'note'
            // Tags are the topics; notes are subsections of one. Size says so.
            const r = isNote ? NOTE_R : tagRadius(node.degree)
            const isFocus = anchors.has(node.id)
            const isHov = node.id === hovered
            const isSearchHov = node.id === searchHoverId
            const isConn = connected.has(node.id)
            const base = isNote ? '#818cf8' : '#4ade80'
            const fill = isFocus ? base
              : isSearchHov ? (isNote ? '#818cf8' : '#4ade80')
              : isConn ? (isNote ? '#a5b4fc' : '#86efac')
              : isHov ? (isNote ? '#a5b4fc' : '#86efac')
              : (isNote ? '#ddd8fd' : '#bbf7d0')
            return (
              <g key={node.id}
                onClick={e => {
                  e.stopPropagation()   // the background clears the selection
                  if (e.shiftKey) setSel(s => s.includes(node.id) ? s.filter(x => x !== node.id) : [...s, node.id])
                  else onNodeClick(node.id)   // opening a note leaves the selection alone
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered('')}
                style={{ cursor: 'pointer' }}
              >
                {isFocus && <circle cx={p.x} cy={p.y} r={r + 8} fill={base} opacity={.1} />}
                {isSearchHov && !isFocus && <circle cx={p.x} cy={p.y} r={r + 10} fill={base} opacity={.12} />}
                <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={isFocus || isHov || isSearchHov ? base : `${base}66`} strokeWidth={isSearchHov ? 2 : 1.5} />
                {(isFocus || isHov || isSearchHov) && <circle cx={p.x} cy={p.y} r={r * .35} fill="#fff" opacity={.9} />}
                <text x={p.x} y={p.y + r + 14} textAnchor="middle"
                  fill={isFocus ? '#312e81' : isSearchHov ? '#312e81' : isConn ? '#475569' : isHov ? '#334155' : '#94a3b8'}
                  fontSize={isNote ? 10 : 12} fontFamily="Inter,sans-serif" fontWeight={isFocus || isSearchHov ? 600 : 400}
                  style={{ pointerEvents: 'none' }}
                >{node.name}</text>
              </g>
            )
          })}
        </g>
      </svg>

      <div style={{ position: 'absolute', bottom: 18, right: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {([['＋', 1.15], ['－', .87], ['⊙', null]] as [string, number | null][]).map(([l, f]) => (
          <button key={l} onClick={() => f ? setZoom(z => Math.max(.25, Math.min(3.5, z * f))) : (setZoom(1), setPan({ x: 0, y: 0 }))}
            style={{ width: 28, height: 28, background: 'rgba(255,255,255,.9)', border: '1px solid #e5e4df', color: '#94a3b8', borderRadius: 7, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}
          >{l}</button>
        ))}
      </div>
    </div>
  )
}

// ─── Doc carousel ────────────────────────────────────────────────────────────
const DOC_ICONS: Record<string, { bg: string; color: string; label: string }> = {
  pdf:  { bg: '#fef2f2', color: '#ef4444', label: 'PDF' },
  md:   { bg: '#f0fdf4', color: '#16a34a', label: 'MD'  },
  docx: { bg: '#eff6ff', color: '#3b82f6', label: 'DOC' },
  png:  { bg: '#fdf4ff', color: '#a855f7', label: 'IMG' },
  jpg:  { bg: '#fdf4ff', color: '#a855f7', label: 'IMG' },
  txt:  { bg: '#f8f8f6', color: '#64748b', label: 'TXT' },
}
const docIcon = (ext: string) => DOC_ICONS[ext.toLowerCase()] ?? { bg: '#f5f4f0', color: '#94a3b8', label: ext.toUpperCase().slice(0, 3) }
const fmtSize = (b: number) => b > 1e6 ? `${(b/1e6).toFixed(1)} MB` : `${Math.round(b/1024)} KB`
const shortName = (name: string, max = 22) => name.length > max ? name.slice(0, max - 1) + '…' : name

function DocCarousel({ docs, noteId, onAddDoc, px }: {
  docs: NoteDoc[]
  noteId: string
  onAddDoc: (doc: NoteDoc) => void
  px: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current; if (!el) return
    el.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' })
  }

  const handleFiles = (fl: FileList | null) => {
    if (!fl) return
    setErr(null)
    Array.from(fl).forEach(f => {
      uploadDoc(noteId, f).then(onAddDoc).catch(e => {
        console.error('could not attach document:', e)
        setErr(e instanceof Error ? e.message : String(e))
      })
    })
  }

  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const update = () => {
      setCanLeft(el.scrollLeft > 4)
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [docs.length])

  return (
    <div style={{ padding: `12px ${px}`, borderTop: '1px solid #f5f4f0', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: err ? '#ef4444' : '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {err ?? `Documents${docs.length > 0 ? ` · ${docs.length}` : ''}`}
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[['←', 'left'], ['→', 'right']].map(([label, dir]) => (
            <button key={dir} onClick={() => scroll(dir as 'left' | 'right')}
              disabled={dir === 'left' ? !canLeft : !canRight}
              style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid #e9e8e4', background: 'none', cursor: (dir === 'left' ? canLeft : canRight) ? 'pointer' : 'default', color: (dir === 'left' ? canLeft : canRight) ? '#64748b' : '#e2e1db', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .15s' }}
            >{label}</button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none', paddingBottom: 2 }}>
        {/* Doc cards */}
        {docs.map(doc => {
          const ic = docIcon(doc.ext)
          return (
            <div key={doc.id} onClick={() => doc.url && window.open(doc.url, '_blank', 'noopener')}
              title={doc.url ? `Open ${doc.name}` : doc.name}
              style={{ flexShrink: 0, width: 130, scrollSnapAlign: 'start', background: '#fafaf9', border: '1px solid #f1f0ec', borderRadius: 10, padding: '10px 10px 9px', display: 'flex', flexDirection: 'column', gap: 7, cursor: doc.url ? 'pointer' : 'default' }}>
              <div style={{ width: '100%', height: 60, borderRadius: 6, background: ic.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {doc.preview
                  ? <img src={doc.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 12, fontWeight: 700, color: ic.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '.04em' }}>{ic.label}</span>
                }
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#334155', lineHeight: 1.3, marginBottom: 2, wordBreak: 'break-word' }}>{shortName(doc.name)}</div>
                <div style={{ fontSize: 10, color: '#cbd5e1' }}>{fmtSize(doc.size)}</div>
              </div>
            </div>
          )
        })}

        {/* + Add card */}
        <div onClick={() => fileRef.current?.click()}
          style={{ flexShrink: 0, width: 130, scrollSnapAlign: 'start', background: 'transparent', border: '1.5px dashed #e9e8e4', borderRadius: 10, padding: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', minHeight: 100, transition: 'border-color .15s, background .15s' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#c7d2fe'; el.style.background = '#fafaf9' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#e9e8e4'; el.style.background = 'transparent' }}
        >
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.md,.txt,.docx" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <div style={{ width: 26, height: 26, borderRadius: 7, background: '#eef2ff', border: '1px solid #c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f46e5' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>Add doc</span>
        </div>
      </div>
    </div>
  )
}

const confirmDelete = (name: string) =>
  window.confirm(`Delete “${name}”? Its attached documents go with it. This cannot be undone.`)

function DeleteButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button onClick={onClick} title="Delete note"
      style={{ padding: small ? '4px 10px' : '5px 12px', fontSize: small ? 11 : 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: small ? 6 : 7, color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
      Delete
    </button>
  )
}

// ─── Note card (slide-in panel) ───────────────────────────────────────────────
function NoteCard({ note, notes, isMobile, onClose, onNavigate, onUpdate, onDelete, onAddDoc }: {
  note: Note | null; notes: Note[]; isMobile: boolean
  onClose: () => void; onNavigate: (id: string) => void
  onUpdate: (id: string, c: string) => void
  onDelete: (id: string) => void
  onAddDoc: (noteId: string, doc: NoteDoc) => void
}) {
  const [editing, setEditing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setEditing(false) }, [note?.id])
  useEffect(() => {
    const el = bodyRef.current; if (!el) return
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.dataset.link) {
        const found = notes.find(n => n.name.toLowerCase() === t.dataset.link!.toLowerCase())
        if (found) onNavigate(found.id)
      }
    }
    el.addEventListener('click', h)
    return () => el.removeEventListener('click', h)
  }, [notes, onNavigate])

  const tags = note ? extractTags(note.content) : []
  const links = note ? extractLinks(note.content) : []

  return (
    <SlidePanel open={!!note} isMobile={isMobile}>
      {note && (
        <>
          <div style={{ padding: isMobile ? '16px 18px 14px' : '20px 22px 14px', borderBottom: '1px solid #f5f4f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              {isMobile && (
                // Back chevron for phone — classic native feel
                <button onClick={onClose}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#4f46e5', fontSize: 15, fontFamily: 'inherit', fontWeight: 500, padding: '2px 0', flexShrink: 0 }}>
                  <svg width="9" height="15" viewBox="0 0 9 16" fill="none">
                    <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </button>
              )}
              <h2 style={{ margin: 0, fontSize: isMobile ? 17 : 18, fontWeight: 650, color: '#0f0e0d', letterSpacing: '-.025em', lineHeight: 1.25, flex: 1 }}>
                {!isMobile && note.name}
              </h2>
              {!isMobile && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginTop: 2 }}>
                  {editing && <DeleteButton small onClick={() => confirmDelete(note.name) && onDelete(note.id)} />}
                  <button onClick={() => setEditing(e => !e)}
                    style={{ padding: '4px 10px', fontSize: 11, background: editing ? '#eef2ff' : '#f5f4f0', border: '1px solid ' + (editing ? '#c7d2fe' : '#e9e8e4'), borderRadius: 6, color: editing ? '#4f46e5' : '#94a3b8', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                    {editing ? 'Preview' : 'Edit'}
                  </button>
                  <CloseButton onClick={onClose} />
                </div>
              )}
            </div>

            {isMobile && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, color: '#0f0e0d', letterSpacing: '-.025em', lineHeight: 1.3, flex: 1 }}>{note.name}</h2>
                  {editing && <DeleteButton onClick={() => confirmDelete(note.name) && onDelete(note.id)} />}
                  <button onClick={() => setEditing(e => !e)}
                    style={{ padding: '5px 12px', fontSize: 12, background: editing ? '#eef2ff' : '#f5f4f0', border: '1px solid ' + (editing ? '#c7d2fe' : '#e9e8e4'), borderRadius: 7, color: editing ? '#4f46e5' : '#94a3b8', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
                    {editing ? 'Preview' : 'Edit'}
                  </button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 5 }}>{timeAgo(note.modified)}</div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                {tags.map(t => (
                  <span key={t} style={{ fontSize: 11, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 20, padding: '2px 8px', color: '#16a34a', fontWeight: 500 }}>#{t}</span>
                ))}
              </div>
            )}
          </div>

          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto' }}>
            {editing ? (
              <textarea value={note.content} onChange={e => onUpdate(note.id, e.target.value)}
                spellCheck={false}
                style={{ width: '100%', height: '100%', padding: isMobile ? '16px 18px' : '18px 22px', fontFamily: "'JetBrains Mono',monospace", fontSize: 13, lineHeight: 1.8, background: '#fefefe', border: 'none', outline: 'none', resize: 'none', color: '#334155', boxSizing: 'border-box' }}
              />
            ) : (
              <div className="note-body" style={{ padding: isMobile ? '16px 18px' : '18px 22px' }} dangerouslySetInnerHTML={{ __html: renderMd(note.content) }} />
            )}
          </div>

          <DocCarousel
            docs={note.docs ?? []}
            noteId={note.id}
            onAddDoc={doc => onAddDoc(note.id, doc)}
            px={isMobile ? '18px' : '22px'}
          />

          {links.length > 0 && (
            <div style={{ padding: isMobile ? '12px 18px' : '12px 22px', borderTop: '1px solid #f5f4f0', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Linked notes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {links.map(ln => {
                  const found = notes.find(n => n.name.toLowerCase() === ln.toLowerCase())
                  return (
                    <button key={ln} onClick={() => found && onNavigate(found.id)}
                      style={{ fontSize: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 20, padding: '3px 11px', color: '#4f46e5', cursor: found ? 'pointer' : 'default', opacity: found ? 1 : .45, fontFamily: 'inherit', fontWeight: 500 }}>
                      {ln}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </SlidePanel>
  )
}

// ─── Search overlay ───────────────────────────────────────────────────────────
function SearchOverlay({ notes, onSelect, onClose }: {
  notes: Note[]; onSelect: (id: string) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return [...notes].sort((a, b) => b.modified - a.modified).slice(0, 6)
    return notes.filter(n => n.name.toLowerCase().includes(query) || n.content.toLowerCase().includes(query))
      .sort((a, b) => b.modified - a.modified).slice(0, 8)
  }, [q, notes])

  const getSnippet = (n: Note) => {
    const query = q.trim().toLowerCase()
    const raw = cleanSnippet(n.content)
    if (!query) return raw.slice(0, 80) + (raw.length > 80 ? '…' : '')
    const idx = raw.toLowerCase().indexOf(query)
    if (idx === -1) return raw.slice(0, 80) + '…'
    const start = Math.max(0, idx - 25)
    return (start > 0 ? '…' : '') + raw.slice(start, idx + query.length + 55) + '…'
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 'calc(80px + env(safe-area-inset-top))' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(248,248,246,.7)', backdropFilter: 'blur(12px)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: '92%', maxWidth: 560, zIndex: 1 }}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.06)', overflow: 'hidden', border: '1px solid #f1f0ec' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #f5f4f0' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: .4 }}>
              <circle cx="11" cy="11" r="8" stroke="#1a1a18" strokeWidth="2" />
              <path d="m21 21-4.35-4.35" stroke="#1a1a18" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search your brain…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: '#0f0e0d', fontFamily: 'inherit', background: 'transparent' }}
            />
            {q && (
              <button onClick={() => setQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', display: 'flex', padding: 0 }}>
                <XIcon size={14} />
              </button>
            )}
            <kbd style={{ fontSize: 11, background: '#f5f4f0', border: '1px solid #e9e8e4', borderRadius: 5, padding: '2px 6px', color: '#94a3b8', fontFamily: 'inherit' }}>esc</kbd>
          </div>

          {!q && <div style={{ padding: '8px 18px 4px', fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.08em' }}>Recent</div>}

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>Nothing found</div>
            ) : results.map((n, i) => (
              <NoteListRow key={n.id} note={n} isLast={i === results.length - 1}
                snippet={getSnippet(n)}
                onClick={() => { onSelect(n.id); onClose() }}
              />
            ))}
          </div>

          {results.length > 0 && (
            <div style={{ padding: '8px 18px', borderTop: '1px solid #f5f4f0', display: 'flex', gap: 14 }}>
              {[['↵', 'open'], ['esc', 'close']].map(([k, l]) => (
                <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <kbd style={{ fontSize: 10, background: '#f5f4f0', border: '1px solid #e9e8e4', borderRadius: 4, padding: '1px 5px', color: '#94a3b8', fontFamily: 'inherit' }}>{k}</kbd>
                  <span style={{ fontSize: 11, color: '#cbd5e1' }}>{l}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Capture sheet ────────────────────────────────────────────────────────────
interface UFile { id: string; file: File; preview?: string }

function CaptureSheet({ onClose, onSave }: {
  onClose: () => void; onSave: (name: string, content: string) => Promise<void>
}) {
  const [tab, setTab] = useState<'upload' | 'write'>('upload')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<UFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // Hashing, page rendering and uploading all happen before a batch row exists,
  // so the progress tray cannot show them — this is that stretch.
  const [phase, setPhase] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const addFiles = (fl: FileList | null) => {
    if (!fl) return
    setFiles(p => [...p, ...Array.from(fl).filter(f => !p.find(x => x.id === f.name + f.size)).map(f => ({
      id: f.name + f.size, file: f, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
    }))])
    setStatus(null)
  }

  const save = async () => {
    const fail = (e: unknown) => setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    setBusy(true)
    setPhase('')
    try {
      if (tab === 'write' && body.trim()) {
        const name = title.trim() || 'Untitled note'
        await onSave(name, `# ${name}\n\n${body.trim()}`)
        onClose()
      } else if (tab === 'upload' && files.length) {
        const { queued, duplicates } = await ingestFiles(files.map(f => f.file), setPhase)
        setFiles([])
        setStatus({
          ok: true,
          text: queued
            ? `Queued for processing${duplicates ? ` · ${duplicates} already known` : ''}`
            : 'Already in your notes — nothing to do',
        })
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const canSave = !busy && (tab === 'write' ? body.trim().length > 0 : files.length > 0)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,14,13,.3)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 560,
        background: '#fff', borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,.18), 0 8px 24px rgba(0,0,0,.08)',
        overflow: 'hidden',
        animation: 'popIn .2s cubic-bezier(.32,.72,0,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 0' }}>
          <div style={{ display: 'flex', gap: 2, background: '#f5f4f0', borderRadius: 10, padding: 3 }}>
            {(['upload', 'write'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#0f0e0d' : '#94a3b8', fontSize: 13, fontWeight: tab === t ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,.1)' : 'none' }}>
                {t === 'upload' ? '↑  Upload' : '✎  Write'}
              </button>
            ))}
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div style={{ padding: '14px 20px 20px' }}>
          {tab === 'upload' ? (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
                onClick={() => fileInput.current?.click()}
                style={{ border: `2px dashed ${dragging ? '#818cf8' : '#e9e8e4'}`, borderRadius: 12, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', background: dragging ? '#eef2ff' : '#fafaf9', transition: 'all .15s', marginBottom: 12 }}
              >
                <input ref={fileInput} type="file" multiple accept="image/*,.pdf,.md,.txt,.docx" style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 10px', display: 'block', opacity: .35 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={dragging ? '#4f46e5' : '#475569'} strokeWidth="1.8" strokeLinecap="round" />
                  <polyline points="17 8 12 3 7 8" stroke={dragging ? '#4f46e5' : '#475569'} strokeWidth="1.8" strokeLinecap="round" />
                  <line x1="12" y1="3" x2="12" y2="15" stroke={dragging ? '#4f46e5' : '#475569'} strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: dragging ? '#4f46e5' : '#475569' }}>{dragging ? 'Drop here' : 'Drop screenshots & files'}</p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#cbd5e1' }}>Images, PDFs, Markdown, documents</p>
              </div>
              {files.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {files.map(uf => (
                    <div key={uf.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#fafaf9', borderRadius: 8, border: '1px solid #f1f0ec' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', background: '#f1f0ec', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {uf.preview ? <img src={uf.preview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : <span style={{ fontSize: 16 }}>📄</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uf.file.name}</div>
                        <div style={{ fontSize: 10, color: '#cbd5e1' }}>{(uf.file.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <button onClick={() => setFiles(p => p.filter(f => f.id !== uf.id))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e2e1db', display: 'flex', padding: 2 }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#ef4444'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#e2e1db'}
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
                style={{ padding: '10px 0', border: 'none', borderBottom: '1px solid #f1f0ec', fontSize: 16, fontWeight: 600, color: '#0f0e0d', outline: 'none', fontFamily: 'inherit', letterSpacing: '-.01em', background: 'transparent' }}
              />
              <textarea value={body} onChange={e => setBody(e.target.value)} autoFocus
                placeholder="What's on your mind? Use [[links]] to connect ideas, #tags to group them…"
                rows={6}
                style={{ padding: '10px 0', border: 'none', fontSize: 14, color: '#334155', lineHeight: 1.75, outline: 'none', resize: 'none', fontFamily: "'JetBrains Mono',monospace", background: 'transparent', borderBottom: '1px solid #f1f0ec' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            {busy && phase ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>{phase}</div>
            ) : status ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: status.ok ? '#16a34a' : '#ef4444' }}>
                {status.ok
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="12" y1="16.5" x2="12" y2="16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
                {status.text}
              </div>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose}
                style={{ padding: '9px 18px', background: 'transparent', border: '1px solid #e9e8e4', borderRadius: 9, color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={save} disabled={!canSave}
                style={{ padding: '9px 22px', background: canSave ? '#4f46e5' : '#f1f0ec', border: 'none', borderRadius: 9, color: canSave ? '#fff' : '#cbd5e1', fontSize: 13, fontWeight: 500, cursor: canSave ? 'pointer' : 'default', fontFamily: 'inherit', transition: 'background .15s' }}>
                {busy ? 'Working…' : tab === 'upload' ? `Upload ${files.length > 0 ? files.length + ' ' : ''}file${files.length !== 1 ? 's' : ''}` : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tag panel ────────────────────────────────────────────────────────────────
function TagPanel({ tagId, notes, isMobile, onClose, onOpenNote }: {
  tagId: string | null; notes: Note[]; isMobile: boolean
  onClose: () => void; onOpenNote: (id: string) => void
}) {
  const tagName = tagId ? tagId.replace('t:', '') : ''
  const taggedNotes = useMemo(() =>
    tagId ? notes.filter(n => extractTags(n.content).includes(tagName)) : [],
    [tagId, notes, tagName]
  )

  return (
    <SlidePanel open={!!tagId} isMobile={isMobile}>
      {tagId && (
        <>
          <div style={{ padding: isMobile ? '16px 18px' : '20px 22px 16px', borderBottom: '1px solid #f5f4f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {isMobile && (
                  <button onClick={onClose}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#4f46e5', fontSize: 15, fontFamily: 'inherit', fontWeight: 500, padding: '2px 0', marginRight: 6 }}>
                    <svg width="9" height="15" viewBox="0 0 9 16" fill="none">
                      <path d="M8 1L1 8l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                  </button>
                )}
                <div style={{ width: 32, height: 32, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 14, color: '#16a34a', fontWeight: 600 }}>#</span>
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 650, color: '#0f0e0d', letterSpacing: '-.02em' }}>{tagName}</div>
                  <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 1 }}>{taggedNotes.length} note{taggedNotes.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
              {!isMobile && <CloseButton onClick={onClose} />}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {taggedNotes.length === 0 ? (
              <div style={{ padding: '40px 22px', textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>No notes with this tag</div>
            ) : taggedNotes.map((n, i) => (
              <NoteListRow key={n.id} note={n} isLast={i === taggedNotes.length - 1}
                snippet={cleanSnippet(n.content).slice(0, 90) + '…'}
                onClick={() => onOpenNote(n.id)}
              />
            ))}
          </div>
        </>
      )}
    </SlidePanel>
  )
}

// ─── Ingestion progress ───────────────────────────────────────────────────────
const ITEM_STATE: Record<string, { label: string; color: string }> = {
  pending:    { label: 'waiting',   color: '#cbd5e1' },
  processing: { label: 'reading…',  color: '#4f46e5' },
  ocr_done:   { label: 'read',      color: '#4f46e5' },
  merged:     { label: 'in graph',  color: '#16a34a' },
  duplicate:  { label: 'duplicate', color: '#cbd5e1' },
  failed:     { label: 'failed',    color: '#ef4444' },
}
const MAX_ROWS = 40

function IngestRow({ item, isLast }: { item: IngestItem; isLast: boolean }) {
  const state = ITEM_STATE[item.status] ?? { label: item.status, color: '#94a3b8' }
  return (
    <div style={{ padding: '8px 14px', borderBottom: isLast ? 'none' : '1px solid #fafaf8' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
        <div style={{ fontSize: 11, color: state.color, flexShrink: 0 }}>{state.label}</div>
      </div>
      {item.error && (
        <div style={{ fontSize: 11, color: '#ef4444', lineHeight: 1.4, marginTop: 2 }}>{item.error}</div>
      )}
    </div>
  )
}

function IngestBadge({ isMobile, panelOpen, onBatchDone }: {
  isMobile: boolean; panelOpen: boolean; onBatchDone: () => void
}) {
  const { shown, items, remaining, unseenFailures, settledKey, open, setOpen } = useIngest()
  const wrapRef = useRef<HTMLDivElement>(null)

  // A batch only writes its notes at the very end, so that is the moment the
  // graph is stale. Refetch then rather than leaving it to a manual reload.
  useEffect(() => { if (settledKey) onBatchDone() }, [settledKey, onBatchDone])

  // Same dismissal rules as the search dropdown
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', click); window.removeEventListener('keydown', key) }
  }, [open, setOpen])

  useEffect(() => { if (!remaining && !unseenFailures) setOpen(false) }, [remaining, unseenFailures, setOpen])
  if (!remaining && !unseenFailures) return null

  return (
    <div ref={wrapRef} style={{
      position: 'absolute',
      top: isMobile ? `calc(54px + env(safe-area-inset-top))` : `calc(16px + env(safe-area-inset-top))`,
      right: 16,
      transform: `translateX(-${!isMobile && panelOpen ? 420 : 0}px)`,
      transition: 'transform .28s cubic-bezier(.32,.72,0,1)',
      zIndex: 30, pointerEvents: 'none',
    }}>
      <button onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#4f46e5', borderRadius: 20, padding: '7px 18px', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 14px rgba(79,70,229,.4)', pointerEvents: 'auto', whiteSpace: 'nowrap', animation: 'popIn .2s cubic-bezier(.32,.72,0,1)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#4338ca'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#4f46e5'}
      >
        {remaining > 0 ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="14 42" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="16.5" x2="12" y2="16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        {remaining > 0 ? remaining : unseenFailures}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 300,
          background: 'rgba(255,255,255,.98)', backdropFilter: 'blur(16px)',
          border: '1px solid #c7d2fe', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,.1)',
          overflow: 'hidden', zIndex: 30, pointerEvents: 'auto',
          animation: 'popIn .2s cubic-bezier(.32,.72,0,1)',
          maxHeight: 'min(60vh, 420px)', overflowY: 'auto',
        }}>
          {shown.slice(0, 3).map(b => {
            const settled = b.done + b.failed
            const phase = batchPhase(b)
            const rows = items.filter(i => i.batchId === b.id)
            return (
              <div key={b.id}>
                <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #fafaf8' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      {PHASE_LABEL[phase]}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {phase === 'organising' ? 'grouping into notes…' : `${settled} of ${b.total}`}
                      {b.failed > 0 ? ` · ${b.failed} failed` : ''}
                    </span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: '#f1f0ec', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', background: '#4f46e5', transition: 'width .3s ease',
                      width: `${Math.round((settled / Math.max(1, b.total)) * 100)}%`,
                      // A full bar with work left would read as finished; pulse instead.
                      animation: phase === 'organising' ? 'pulse 1.4s ease-in-out infinite' : undefined,
                    }} />
                  </div>
                </div>
                {rows.slice(0, MAX_ROWS).map((i, n) => (
                  <IngestRow key={i.id} item={i} isLast={n === Math.min(rows.length, MAX_ROWS) - 1} />
                ))}
                {rows.length > MAX_ROWS && (
                  <div style={{ padding: '8px 14px', fontSize: 11, color: '#cbd5e1' }}>+{rows.length - MAX_ROWS} more</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { notes, refresh, update, remove, attachDoc, create } = useNotes()
  const [openNote, setOpenNote] = useState<Note | null>(null)
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [focusId, setFocusId] = useState('')
  const [searching, setSearching] = useState(false)   // mobile overlay only
  const [capturing, setCapturing] = useState(false)
  const [searchHoverId, setSearchHoverId] = useState('')
  const desktopSearchRef = useRef<HTMLInputElement | null>(null)
  const windowWidth = useWindowWidth()
  const isMobile = windowWidth < 640
  const isWideDesktop = windowWidth >= 1024
  const panelOpen = !!(openNote || openTag)

  const openById = useCallback((id: string) => {
    const n = notes.find(x => x.id === id)
    if (n) { setOpenNote(n); setFocusId(id) }
  }, [notes])

  const handleUpdate = useCallback((id: string, content: string) => {
    update(id, content)
    setOpenNote(p => p?.id === id ? { ...p, content, modified: Date.now() } : p)
  }, [update])

  const handleDelete = useCallback((id: string) => {
    setOpenNote(p => p?.id === id ? null : p)
    setFocusId(f => f === id ? '' : f)
    remove(id).catch(() => { /* the hook restores the note and reports it */ })
  }, [remove])

  const handleAddDoc = useCallback((noteId: string, doc: NoteDoc) => {
    attachDoc(noteId, doc)
    setOpenNote(p => p?.id === noteId ? { ...p, docs: [...(p.docs ?? []), doc] } : p)
  }, [attachDoc])

  const handleSave = useCallback(async (name: string, content: string) => {
    const n = await create(name, content)
    setOpenNote(n); setFocusId(n.id)
  }, [create])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'k') return
      e.preventDefault()
      if (isMobile) { setSearching(true) } else { desktopSearchRef.current?.focus() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isMobile])

  const topBarShift = isWideDesktop && panelOpen ? 210 : 0

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'relative', background: '#f8f8f6', fontFamily: "'Inter',system-ui,sans-serif" }}>
      <GraphCanvas notes={notes} focusId={focusId} searchHoverId={searchHoverId}
        onNodeClick={id => {
          if (id.startsWith('t:')) {
            if (id === focusId) { setFocusId(''); setOpenTag(null) } else { setFocusId(id); setOpenNote(null); setOpenTag(id) }
          } else {
            if (id === focusId) { setFocusId(''); setOpenNote(null) } else { setOpenTag(null); openById(id) }
          }
        }}
      />

      {/* Floating top bar */}
      <div style={{
        position: 'absolute',
        top: isMobile ? `calc(54px + env(safe-area-inset-top))` : `calc(16px + env(safe-area-inset-top))`,
        left: '50%',
        transform: `translateX(calc(-50% - ${topBarShift}px))`,
        transition: 'transform .28s cubic-bezier(.32,.72,0,1)',
        display: 'flex', alignItems: 'flex-start', gap: isMobile ? 7 : 10,
        zIndex: (!isMobile && !isWideDesktop && panelOpen) ? 5 : 20,
        pointerEvents: 'none',
        // overflow visible so the dropdown can extend below
        overflow: 'visible',
      }}>
        {isMobile ? (
          // Phone: wider search pill with placeholder text
          <button onClick={() => setSearching(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(16px)', borderRadius: 12, padding: '9px 16px', border: '1px solid #f1f0ec', boxShadow: '0 2px 12px rgba(0,0,0,.07)', cursor: 'pointer', pointerEvents: 'auto', width: 200 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: .4, flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" stroke="#0f0e0d" strokeWidth="2" />
              <path d="m21 21-4.35-4.35" stroke="#0f0e0d" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 13, color: '#b0afa9', fontFamily: 'inherit', flex: 1, textAlign: 'left' }}>Search…</span>
          </button>
        ) : (
          // Desktop / tablet: inline expanding search with dropdown
          <InlineSearch
            notes={notes}
            onSelect={id => { openById(id); setSearchHoverId('') }}
            onHoverNote={setSearchHoverId}
            inputRef={desktopSearchRef}
          />
        )}
      </div>

      {/* Footer — blue "+ Add" button */}
      <div style={{
        position: 'absolute',
        bottom: `calc(20px + env(safe-area-inset-bottom))`,
        left: '50%', transform: `translateX(calc(-50% - ${topBarShift}px))`,
        transition: 'transform .28s cubic-bezier(.32,.72,0,1)',
        zIndex: 20, pointerEvents: 'none',
      }}>
        <button onClick={() => setCapturing(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#4f46e5', borderRadius: 20, padding: '7px 18px', border: 'none', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 14px rgba(79,70,229,.4)', pointerEvents: 'auto', whiteSpace: 'nowrap' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#4338ca'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#4f46e5'}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Add
        </button>
      </div>

      <IngestBadge isMobile={isMobile} panelOpen={panelOpen} onBatchDone={refresh} />

      <NoteCard note={openNote} notes={notes} isMobile={isMobile}
        onClose={() => { setOpenNote(null); setFocusId('') }}
        onNavigate={id => { setOpenTag(null); openById(id) }}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onAddDoc={handleAddDoc}
      />
      <TagPanel tagId={openTag} notes={notes} isMobile={isMobile}
        onClose={() => { setOpenTag(null); setFocusId('') }}
        onOpenNote={id => { setOpenTag(null); openById(id) }}
      />

      {searching && <SearchOverlay notes={notes} onSelect={openById} onClose={() => setSearching(false)} />}
      {capturing && <CaptureSheet onClose={() => setCapturing(false)} onSave={handleSave} />}
    </div>
  )
}
