import { useEffect, useRef, useState } from 'react'
import type { Entity } from '../../types'
import { api } from '../../api/client'
import { value } from '../world/worldUtils'
import {
  allowed,
  applyVariable,
  discover,
  endScene,
  targetIndex,
  visibleIndex,
  type Choice,
  type Line,
  type Vars,
} from './dialogue'

function targetLabel(lines: Line[], id?: string) {
  if (id === undefined) return '沿用台词跳转'
  if (!id) return '顺序下一句'
  if (id === endScene) return '结束场景'
  const index = lines.findIndex((l) => l.id === id)
  return index < 0
    ? '目标已失效'
    : index + 1 + ' · ' + lines[index].text.slice(0, 22)
}
function Target({
  lines,
  id,
  change,
  choice,
}: {
  lines: Line[]
  id?: string
  change: (id: string | undefined) => void
  choice?: boolean
}) {
  return (
    <label>
      跳转{' '}
      <select
        aria-label="跳转目标"
        value={id ?? '@inherit'}
        onChange={(e) =>
          change(e.target.value === '@inherit' ? undefined : e.target.value)
        }
      >
        {choice && <option value="@inherit">沿用台词跳转</option>}
        {['', ...lines.map((l) => l.id), endScene].map((id) => (
          <option key={id} value={id}>
            {targetLabel(lines, id)}
          </option>
        ))}
      </select>
    </label>
  )
}
export function BranchEditor({
  line,
  lines,
  change,
}: {
  line: Line
  lines: Line[]
  change: (patch: Partial<Line>) => void
}) {
  const [show, setShow] = useState(false)
  const update = (id: string, patch: Partial<Choice>) =>
    change({
      choices: line.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  return (
    <details
      className="branch-editor"
      open={
        line.choices.length || line.condition || line.nextLineId
          ? true
          : undefined
      }
    >
      <summary>
        条件与跳转
        {line.choices.length ? ' · ' + line.choices.length + ' 个选项' : ''}
      </summary>
      <div className="lab-tools">
        <button
          type="button"
          aria-pressed={show || !!line.condition}
          onClick={() => {
            if (line.condition) change({ condition: '' })
            setShow(!(show || !!line.condition))
          }}
        >
          条件
        </button>
        {(show || line.condition) && (
          <input
            aria-label="台词条件"
            placeholder="持有:便携雾灯"
            value={line.condition}
            onChange={(e) => change({ condition: e.target.value })}
          />
        )}
        <Target
          lines={lines}
          id={line.nextLineId}
          change={(id) => change({ nextLineId: id ?? '' })}
        />
        <button
          onClick={() =>
            change({
              choices: [
                ...line.choices,
                {
                  id: crypto.randomUUID(),
                  text: '',
                  condition: '',
                  setVar: '',
                },
              ],
            })
          }
        >
          ＋ 分支选项
        </button>
      </div>
      {line.choices.map((c, i) => (
        <div className="choice-edit" key={c.id}>
          <input
            aria-label={'选项 ' + (i + 1)}
            placeholder="选项文本"
            value={c.text}
            onChange={(e) => update(c.id, { text: e.target.value })}
          />
          <input
            aria-label="选项条件"
            placeholder="条件（可选）"
            value={c.condition}
            onChange={(e) => update(c.id, { condition: e.target.value })}
          />
          <input
            aria-label="更改变量"
            placeholder="好感度 += 1"
            value={c.setVar}
            onChange={(e) => update(c.id, { setVar: e.target.value })}
          />
          <Target
            lines={lines}
            id={c.nextLineId}
            choice
            change={(id) => update(c.id, { nextLineId: id })}
          />
          <button
            aria-label="删除选项"
            onClick={() =>
              change({ choices: line.choices.filter((v) => v.id !== c.id) })
            }
          >
            ×
          </button>
        </div>
      ))}
    </details>
  )
}
export function BranchPreview({ line, lines }: { line: Line; lines: Line[] }) {
  return (
    <div className="choice-pills">
      {line.choices.map((c) => (
        <span key={c.id}>
          {c.text} {c.condition && <small>条件 · {c.condition}</small>}{' '}
          {c.setVar && <small>{c.setVar}</small>} →{' '}
          {targetLabel(lines, c.nextLineId ?? line.nextLineId)}
        </span>
      ))}
      {line.nextLineId && !line.choices.length && (
        <small>→ {targetLabel(lines, line.nextLineId)}</small>
      )}
    </div>
  )
}

type Step = { lineIndex: number; varsSnapshot: Vars }
export function Playtest({
  lines,
  byId,
  location,
  exit,
}: {
  lines: Line[]
  byId: Map<string, Entity>
  location?: Entity
  exit: () => void
}) {
  const [vars, setVars] = useState(() => discover(lines))
  const [cursor, seek] = useState(0),
    [history, setHistory] = useState<Step[]>([])
  const stage = useRef<HTMLDivElement>(null)
  const index = visibleIndex(lines, cursor, vars),
    line = lines[index],
    speaker = byId.get(line?.speakerId)
  const reset = () => {
    setVars(discover(lines))
    seek(0)
    setHistory([])
  }
  function back() {
    const last = history.at(-1)
    if (last) {
      seek(last.lineIndex)
      setVars(last.varsSnapshot)
      setHistory(history.slice(0, -1))
      stage.current?.focus()
    }
  }
  function reason(c: Choice) {
    if (!allowed(c.condition, vars)) return '需要 ' + c.condition
    if (!applyVariable(c.setVar, vars)) return '变量设置无效'
    if (targetIndex(lines, index, c.nextLineId ?? line.nextLineId) < 0)
      return '跳转目标已失效'
    return ''
  }
  function advance(c?: Choice) {
    if (!line || (!c && line.choices.length) || (c && reason(c))) return
    const next = targetIndex(lines, index, c?.nextLineId ?? line.nextLineId)
    if (next < 0) return
    setHistory([...history, { lineIndex: index, varsSnapshot: { ...vars } }])
    setVars(c ? applyVariable(c.setVar, vars)! : vars)
    seek(next)
    stage.current?.focus()
  }
  useEffect(() => {
    stage.current?.focus()
  }, [])
  const cover = location && value(location, 'coverAsset'),
    avatar = speaker && value(speaker, 'avatarAsset')
  return (
    <>
      <details className="play-vars">
        <summary>试玩状态变量面板</summary>
        <div className="lab-tools">
          {Object.entries(vars).map(([key, v]) => (
            <label key={key}>
              {key}
              {typeof v === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) =>
                    setVars({ ...vars, [key]: e.target.checked })
                  }
                />
              ) : (
                <input
                  type={typeof v === 'number' ? 'number' : 'text'}
                  value={v}
                  onChange={(e) =>
                    setVars({
                      ...vars,
                      [key]:
                        typeof v === 'number'
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
          <button onClick={reset}>重置试玩</button>
        </div>
      </details>
      <div
        className="vn-stage"
        ref={stage}
        tabIndex={0}
        style={
          cover
            ? {
                backgroundImage:
                  'linear-gradient(0deg,#101727cc,transparent),url("' +
                  api.assetUrl(cover) +
                  '")',
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey)
            return
          if (e.key === 'Escape') exit()
          else if (e.key === 'ArrowLeft') back()
          else if (/^[1-9]$/.test(e.key)) {
            const c = line?.choices[Number(e.key) - 1]
            if (c) advance(c)
          } else if (
            e.key === 'ArrowRight' ||
            (e.target === stage.current && [' ', 'Enter'].includes(e.key))
          )
            advance()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {avatar && (
          <img
            className="vn-portrait"
            src={api.assetUrl(avatar)}
            alt={speaker!.title}
          />
        )}
        <section className="vn-dialog" key={line?.id ?? 'end'}>
          <small>
            {location?.title} · {Math.min(index + 1, lines.length)} /{' '}
            {lines.length}
          </small>
          <h2>{line?.speakerName ?? '场景结束'}</h2>
          <i>{line?.mood}</i>
          <p>{line?.text}</p>
          {!!line?.choices.length && (
            <div className="play-choices">
              {line.choices.map((c, i) => (
                <button
                  key={c.id}
                  disabled={!!reason(c)}
                  onClick={() => advance(c)}
                >
                  {i < 9 && <kbd>{i + 1}</kbd>} {c.text}{' '}
                  {reason(c) && <small>{reason(c)}</small>}
                </button>
              ))}
            </div>
          )}
          <progress
            value={Math.min(index + 1, lines.length)}
            max={lines.length || 1}
          />
          <div className="visual-tools">
            <button disabled={!history.length} onClick={back}>
              ← 上一步
            </button>
            {line && !line.choices.length && (
              <button
                disabled={targetIndex(lines, index, line.nextLineId) < 0}
                onClick={() => advance()}
              >
                下一句 →
              </button>
            )}
            {!line && <button onClick={reset}>重置试玩</button>}
            <button onClick={exit}>退出 (Esc)</button>
          </div>
        </section>
      </div>
    </>
  )
}
