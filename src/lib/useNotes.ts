import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { createNote, deleteNote, listNotes, updateNote } from './api'
import type { Note, NoteDoc } from './types'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The app's notes, backed by Postgres and kept live.
 *
 * Returns the same operations App.tsx already performed on local state, so the
 * UI above it is unchanged; each one writes through and updates optimistically
 * so typing stays instant while the worker fills the graph behind it.
 */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      setNotes(await listNotes())
      setError(null)
    } catch (e) {
      setError(message(e))
      console.error('could not load notes:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()

    // A finishing batch writes many rows in a burst; coalesce them into one refetch.
    const nudge = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(refresh, 400)
    }
    const channel = supabase.channel('pivot')
    for (const table of ['notes', 'docs']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, nudge)
    }
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.error('realtime unavailable — notes will not live-update')
    })

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [refresh])

  const update = useCallback((id: string, content: string) => {
    const now = Date.now()
    setNotes((p) => p.map((n) => (n.id === id ? { ...n, content, modified: now } : n)))
    updateNote(id, content).catch((e) => {
      setError(message(e))
      console.error('could not save note:', e)
      refresh() // put the server's version back on screen rather than lie
    })
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const before = notes
    setNotes((p) => p.filter((n) => n.id !== id))
    try {
      await deleteNote(id)
    } catch (e) {
      setNotes(before) // it is still there; say so and put it back
      setError(message(e))
      console.error('could not delete note:', e)
      throw e
    }
  }, [notes])

  const attachDoc = useCallback((noteId: string, doc: NoteDoc) => {
    setNotes((p) => p.map((n) => (n.id === noteId ? { ...n, docs: [...(n.docs ?? []), doc] } : n)))
  }, [])

  const create = useCallback(async (name: string, content: string): Promise<Note> => {
    const note = await createNote(name, content)
    setNotes((p) => [...p, note])
    return note
  }, [])

  return { notes, loading, error, refresh, update, remove, attachDoc, create }
}
