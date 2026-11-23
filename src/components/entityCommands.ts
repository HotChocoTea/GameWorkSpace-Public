import { useRef } from 'react'
import { useWorkspace } from '../state/workspace'
import type { Entity } from '../types'
import { useCommands } from './CanvasKit'

// Track only fields touched by an editor command. Later inspector edits survive undo.
export function useEntityCommands() {
  const ws = useWorkspace(),
    latest = useRef(ws)
  latest.current = ws
  const commands = useCommands(ws.notify)
  function change(after: Entity[], removed: Entity[] = []) {
    const original = new Map(latest.current.entities.map((e) => [e.id, e]))
    const edits = after.map((next) => {
      const before = original.get(next.id)
      const keys = (
        ['title', 'summary', 'body', 'status', 'tags'] as const
      ).filter((k) => before?.[k] !== next[k])
      const fields = Object.keys({ ...before?.data, ...next.data }).filter(
        (k) => before?.data?.[k] !== next.data?.[k],
      )
      return { before, next, keys, fields }
    })
    let previouslyApplied = false
    async function apply(forward: boolean) {
      const w = latest.current,
        live = new Map(w.entities.map((e) => [e.id, e]))
      const writes: Entity[] = forward ? [] : [...removed],
        deletes: string[] = forward ? removed.map((e) => e.id) : []
      for (const { before, next, keys, fields } of edits) {
        const source = forward ? next : before
        if (!source) {
          deletes.push(next.id)
          continue
        }
        const current = live.get(next.id)
        if (!current || !before) {
          writes.push({ ...source, deletedAt: null })
          continue
        }
        const merged = { ...current, data: { ...current.data } }
        for (const k of keys) Object.assign(merged, { [k]: source[k] })
        for (const k of fields) {
          if (source.data && k in source.data) merged.data[k] = source.data[k]
          else delete merged.data[k]
        }
        writes.push(merged)
      }
      const restore = forward
        ? previouslyApplied
          ? edits.filter((edit) => !edit.before).map((edit) => edit.next.id)
          : []
        : removed.map((e) => e.id)
      await w.saveMany(writes, restore, deletes)
      previouslyApplied = true
    }
    return commands.commit(
      () => apply(true),
      () => apply(false),
    )
  }
  return { ...commands, change }
}
