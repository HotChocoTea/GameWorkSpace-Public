import type { Json } from '../../types'
import { list, record, scalar } from '../world/worldUtils'

export type Choice = {
  id: string
  text: string
  condition: string
  setVar: string
  nextLineId?: string
}
export type Line = {
  id: string
  text: string
  speakerId: string
  speakerName: string
  mood: string
  condition: string
  nextLineId: string
  choices: Choice[]
}
export type Vars = Record<string, boolean | number | string>
export const endScene = '__END__'

export function readChoices(raw: Json | undefined): Choice[] {
  return list(raw).map((v, i) => {
    const c = record(v)
    return {
      ...c,
      id: scalar(c.id, 'choice-' + i),
      text: scalar(c.text ?? c.label ?? v),
      condition: scalar(c.condition),
      setVar: scalar(c.setVar),
      ...(typeof c.nextLineId === 'string' ? { nextLineId: c.nextLineId } : {}),
    }
  })
}

function parse(raw: string, assignment: boolean) {
  const match = assignment
    ? /^\$?(?<name>[\p{L}\p{N}_:：-]+?)\s*(?<op>\+=|-=|=)\s*(?<literal>.+)$/u.exec(
        raw.trim(),
      )
    : /^(?<neg>!?)\s*\$?(?<name>[\p{L}\p{N}_:：-]+)(?:\s*(?<op>==|!=|>=|<=|>|<)\s*(?<literal>.+))?$/u.exec(
        raw.trim(),
      )
  if (!match?.groups) return
  const { neg, name, op, literal } = match.groups
  if (neg && op) return
  const v = literal?.trim()
  let value: Vars[string] = true
  if (v !== undefined) {
    if (v.startsWith('"')) {
      try {
        value = JSON.parse(v)
      } catch {
        return
      }
      if (typeof value !== 'string') return
    } else if (v === 'true' || v === 'false') value = v === 'true'
    else if (
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) &&
      Number.isFinite(Number(v))
    )
      value = Number(v)
    else value = v
  }
  if (
    ['+=', '-=', '>=', '<=', '>', '<'].includes(op) &&
    typeof value !== 'number'
  )
    return
  return { name, op: op || (neg ? '!' : 'flag'), value }
}
export function discover(lines: Line[]): Vars {
  const vars: Vars = Object.create(null)
  const inspect = (raw: string, assignment = false) => {
    const p = parse(raw, assignment)
    if (!p) return
    if (!Object.hasOwn(vars, p.name) || (p.op !== 'flag' && p.op !== '!'))
      vars[p.name] =
        typeof p.value === 'number'
          ? 0
          : typeof p.value === 'string'
            ? ''
            : false
  }
  for (const line of lines) {
    inspect(line.condition)
    for (const c of line.choices) {
      inspect(c.condition)
      inspect(c.setVar, true)
    }
  }
  return vars
}
export function allowed(raw: string, vars: Vars) {
  if (!raw.trim()) return true
  const p = parse(raw, false)
  if (!p) return false
  const current = Object.hasOwn(vars, p.name) ? vars[p.name] : false
  switch (p.op) {
    case 'flag':
      return current === true
    case '!':
      return current === false
    case '==':
      return current === p.value
    case '!=':
      return current !== p.value
  }
  if (typeof current !== 'number' || typeof p.value !== 'number') return false
  switch (p.op) {
    case '>=':
      return current >= p.value
    case '<=':
      return current <= p.value
    case '>':
      return current > p.value
    case '<':
      return current < p.value
    default:
      return false
  }
}
export function applyVariable(raw: string, vars: Vars): Vars | undefined {
  if (!raw.trim()) return vars
  const p = parse(raw, true)
  if (!p) return
  if (p.op === '=') return { ...vars, [p.name]: p.value }
  const current = vars[p.name]
  if (typeof current !== 'number' || typeof p.value !== 'number') return
  const value = current + (p.op === '+=' ? p.value : -p.value)
  if (Number.isFinite(value)) return { ...vars, [p.name]: value }
}
export function visibleIndex(lines: Line[], from: number, vars: Vars) {
  let i = from
  while (i < lines.length && !allowed(lines[i].condition, vars)) i++
  return i
}
export function targetIndex(lines: Line[], from: number, id: string) {
  if (!id) return from + 1
  if (id === endScene) return lines.length
  return lines.findIndex((l) => l.id === id)
}
