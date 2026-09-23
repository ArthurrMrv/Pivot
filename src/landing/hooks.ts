import { useEffect, useRef, useState } from 'react'

/** How far down the page we are, 0 at the top and 1 at the bottom. */
export const scrollProgress = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const h = () => setReduced(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return reduced
}

export function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const h = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return vp
}

/** Flips to true the first time the element scrolls into view, then stops observing. */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.2) {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/** Animates from `from` to `to` once `run` turns true. Counts down as happily as up. */
export function useCountUp(from: number, to: number, run: boolean, ms = 1200) {
  const [n, setN] = useState(from)
  useEffect(() => {
    if (!run) return
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setN(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to, run, ms])
  return n
}
