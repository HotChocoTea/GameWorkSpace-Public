import { useEffect, useMemo, useState } from 'react'
import { native, downloadFile } from '../../api/ai'
import { downloadCsv } from '../../api/table'
import { Add, Heading, SaveStatus, SearchField, TrashEntry } from './WorldUI'
import {
  list,
  matches,
  numeric,
  record,
  scalar,
  useEditor,
  useWorld,
  type Editor,
} from './worldUtils'
import type { Entity } from '../../types'
import { DropLab } from './DropLab'

const tabs = ['成长曲线与公式表', '掉落与经济模拟器']
const palette = ['#b66939', '#397d89', '#8770a4', '#6f884c', '#ad5164']
type Formula = { id: string; name: string; color: string; expression: string }
type Point = { level: number; value: number }
type Curve = Formula & { points: Point[]; error?: string }
function formula(i: number, expression = 'level'): Formula {
  return {
    id: crypto.randomUUID(),
    name: '公式 ' + (i + 1),
    color: palette[i % palette.length],
    expression,
  }
}
function CurveChart({ curves }: { curves: Curve[] }) {
  const [hover, setHover] = useState<number>()
  const series = curves.filter((c) => c.points.length)
  if (!series.length) return <p className="empty">输入有效公式后显示曲线。</p>
  const points = series[0].points
  let low = Infinity,
    high = -Infinity
  for (const c of series)
    for (const p of c.points) {
      low = Math.min(low, p.value)
      high = Math.max(high, p.value)
    }
  const x = (i: number) =>
    68 + 606 * (points.length === 1 ? 0.5 : i / (points.length - 1))
  const norm = Math.max(Math.abs(low), Math.abs(high)) || 1
  const y = (v: number) =>
    high === low
      ? 110
      : 202 - 178 * ((v / norm - low / norm) / (high / norm - low / norm))
  const selected =
    hover === undefined ? undefined : Math.min(hover, points.length - 1)
  return (
    <figure className="curve-chart">
      <svg
        viewBox="0 0 700 240"
        role="img"
        aria-label="各公式随等级变化的曲线"
        onPointerLeave={() => setHover(undefined)}
        onPointerMove={(e) => {
          const svg = e.currentTarget,
            matrix = svg.getScreenCTM()
          if (matrix) {
            const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              matrix.inverse(),
            )
            setHover(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(((p.x - 68) / 606) * (points.length - 1)),
                ),
              ),
            )
          }
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="68" x2="674" y1={24 + i * 44.5} y2={24 + i * 44.5} />
            <text x="62" y={28 + i * 44.5} textAnchor="end">
              {Number((high * (1 - i / 4) + (low * i) / 4).toPrecision(4))}
            </text>
          </g>
        ))}
        <path className="curve-axis" d="M68 24 V202 H674" />
        <text x={x(0)} y="225" textAnchor="middle">
          {points[0].level}
        </text>
        {points.length > 1 && (
          <text x={x(points.length - 1)} y="225" textAnchor="middle">
            {points.at(-1)!.level}
          </text>
        )}
        {series.map((c) => (
          <g key={c.id} stroke={c.color}>
            {points.length === 1 ? (
              <circle
                cx={x(0)}
                cy={y(c.points[0].value)}
                r="3"
                fill={c.color}
              />
            ) : (
              <polyline
                fill="none"
                strokeWidth="2.5"
                strokeLinejoin="round"
                points={c.points
                  .map((p, i) => x(i) + ',' + y(p.value))
                  .join(' ')}
              />
            )}
          </g>
        ))}
        {selected !== undefined && (
          <g>
            <path className="crosshair" d={'M' + x(selected) + ' 24V202'} />
            {series.map((c) => (
              <circle
                key={c.id}
                r="4"
                fill={c.color}
                cx={x(selected)}
                cy={y(c.points[selected].value)}
              />
            ))}
          </g>
        )}
      </svg>
      <figcaption>
        {selected !== undefined && <b>等级 {points[selected].level}</b>}
        {series.map((c) => (
          <span key={c.id}>
            <i style={{ background: c.color }} />
            {c.name}
            {selected !== undefined && ' · ' + c.points[selected].value}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

function Growth({ ed }: { ed: Editor }) {
  const data = ed.e.data ?? {},
    min = numeric(data.minLevel) ?? 1,
    max = numeric(data.maxLevel) ?? 50
  const formulas: Formula[] = Array.isArray(data.formulas)
    ? list(data.formulas).map((v, i) => {
        const f = record(v)
        return {
          id: scalar(f.id, 'formula-' + i),
          name: scalar(f.name, '公式 ' + (i + 1)),
          color: scalar(f.color, palette[i % palette.length]),
          expression: scalar(f.expression),
        }
      })
    : [
        {
          id: 'formula-0',
          name: '公式 1',
          color: palette[0],
          expression: scalar(data.expression, 'level'),
        },
      ]
  const vars = record(data.vars),
    overrides = record(data.overrides)
  const [evaluations, setEvaluations] = useState<{
    key: string
    result: { points: Point[]; error?: string }[]
  }>()
  const key = JSON.stringify({
    expressions: formulas.map((f) => f.expression),
    min,
    max,
    vars,
  })
  useEffect(() => {
    let live = true
    const args = JSON.parse(key) as {
      expressions: string[]
      min: number
      max: number
      vars: Record<string, number>
    }
    const timer = setTimeout(() => {
      void Promise.all(
        args.expressions.map(async (expression) => {
          try {
            return {
              points: await native<Point[]>('evaluate_balance_curve', {
                expression,
                minLevel: args.min,
                maxLevel: args.max,
                vars: args.vars,
              }),
            }
          } catch (error) {
            return { points: [], error: String(error) }
          }
        }),
      ).then((result) => {
        if (live) setEvaluations({ key, result })
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key])
  const curves: Curve[] = formulas.map((f, i) => {
    const result = evaluations?.key === key ? evaluations.result[i] : undefined
    const cells = record(overrides[f.id])
    return {
      ...f,
      error: result?.error,
      points: (result?.points ?? []).map((p) => ({
        ...p,
        value: numeric(cells[p.level]) ?? p.value,
      })),
    }
  })
  const levels = useMemo(
    () =>
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      max >= min &&
      max - min < 10000
        ? Array.from({ length: max - min + 1 }, (_, i) => i + min)
        : [],
    [min, max],
  )
  const [page, setPage] = useState(0),
    activePage = Math.min(page, Math.max(0, Math.ceil(levels.length / 100) - 1))
  const [varError, setVarError] = useState('')
  function update(id: string, patch: Partial<Formula>) {
    ed.data(
      'formulas',
      formulas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    )
  }
  function exportTable(json: boolean) {
    const rows = levels.map((level, i) => [
      level,
      ...curves.map((c) => c.points[i]?.value ?? null),
    ])
    if (json)
      downloadFile(
        JSON.stringify(
          {
            formulas,
            vars,
            minLevel: min,
            maxLevel: max,
            overrides,
            levels: rows.map(([level, ...values]) => ({
              level,
              values: Object.fromEntries(
                formulas.map((f, i) => [f.id, values[i]]),
              ),
            })),
          },
          null,
          2,
        ),
        ed.e.title + '.json',
        'application/json',
      )
    else downloadCsv(ed.e.title, ['等级', ...formulas.map((f) => f.name)], rows)
  }
  function override(id: string, level: number, text: string) {
    const cells = { ...record(overrides[id]) }
    if (!text.trim()) delete cells[level]
    else if (Number.isFinite(Number(text))) cells[level] = Number(text)
    else return
    ed.data('overrides', { ...overrides, [id]: cells })
  }
  return (
    <div className="stack">
      <div className="lab-tools">
        {[
          ['起始等级', 'minLevel', min],
          ['最高等级', 'maxLevel', max],
        ].map(([label, field, n]) => (
          <label key={field}>
            {label}
            <input
              type="number"
              value={n}
              onChange={(e) => ed.data(String(field), Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <div className="lab-tools">
        {Object.entries(vars).map(([name, v]) => (
          <div className="param-chip" key={name}>
            <input
              aria-label="变量名"
              defaultValue={name}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next === name) return
                if (
                  !/^[A-Za-z_]\w*$/.test(next) ||
                  ['level', 'x', 'pi', 'e'].includes(next) ||
                  Object.hasOwn(vars, next)
                ) {
                  e.target.value = name
                  setVarError('变量名需唯一，且以字母或下划线开头。')
                  return
                }
                const updated = { ...vars }
                delete updated[name]
                ed.data('vars', { ...updated, [next]: v })
                setVarError('')
              }}
            />
            =
            <input
              aria-label={name + ' 的值'}
              type="number"
              step="any"
              value={numeric(v) ?? 0}
              onChange={(e) =>
                ed.data('vars', { ...vars, [name]: Number(e.target.value) })
              }
            />
            <button
              aria-label={'删除变量 ' + name}
              onClick={() => {
                const updated = { ...vars }
                delete updated[name]
                ed.data('vars', updated)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            let n = 1
            while (Object.hasOwn(vars, 'var' + n)) n++
            ed.data('vars', { ...vars, ['var' + n]: 1 })
          }}
        >
          ＋ 添加变量
        </button>
        {varError && <small role="alert">{varError}</small>}
      </div>
      <div className="formula-list">
        {curves.map((f) => (
          <div key={f.id} className="formula-row">
            <input
              aria-label="曲线颜色"
              type="color"
              value={f.color}
              onChange={(e) => update(f.id, { color: e.target.value })}
            />
            <input
              aria-label="公式名称"
              value={f.name}
              onChange={(e) => update(f.id, { name: e.target.value })}
            />
            <input
              aria-label={f.name + ' 表达式'}
              value={f.expression}
              placeholder="100 * level ^ 1.6"
              onChange={(e) => update(f.id, { expression: e.target.value })}
            />
            <button
              aria-label={'删除公式 ' + f.name}
              onClick={() =>
                ed.data(
                  'formulas',
                  formulas.filter((v) => v.id !== f.id),
                )
              }
            >
              ×
            </button>
            {f.error && (
              <small role="alert" className="formula-error">
                {f.error}
              </small>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            ed.data('formulas', [...formulas, formula(formulas.length)])
          }
        >
          ＋ 添加公式
        </button>
      </div>
      <CurveChart curves={curves} />
      <div className="split">
        <h3>等级表</h3>
        <div className="lab-tools">
          {['CSV', 'JSON'].map((t) => (
            <button
              key={t}
              disabled={!curves.length || curves.some((c) => !c.points.length)}
              onClick={() => exportTable(t === 'JSON')}
            >
              导出 {t}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-table-scroll">
        <table className="lab-table">
          <thead>
            <tr>
              <th>等级</th>
              {curves.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels
              .slice(activePage * 100, activePage * 100 + 100)
              .map((level) => (
                <tr key={level}>
                  <th>{level}</th>
                  {curves.map((c) => {
                    const saved = numeric(record(overrides[c.id])[level]),
                      point = c.points[level - min]
                    return (
                      <td
                        key={c.id}
                        className={saved !== undefined ? 'cell-override' : ''}
                      >
                        <input
                          key={String(saved)}
                          aria-label={c.name + ' 等级 ' + level}
                          type="number"
                          step="any"
                          defaultValue={saved ?? ''}
                          placeholder={
                            point
                              ? String(Number(point.value.toPrecision(7)))
                              : '—'
                          }
                          onBlur={(e) => {
                            if (e.target.value !== String(saved ?? ''))
                              override(c.id, level, e.target.value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                        />
                        {saved !== undefined && (
                          <button
                            aria-label="清除覆盖"
                            onClick={() => override(c.id, level, '')}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {levels.length > 100 && (
        <div className="lab-tools">
          <button
            disabled={!activePage}
            onClick={() => setPage(activePage - 1)}
          >
            上一页
          </button>
          {activePage + 1} / {Math.ceil(levels.length / 100)}
          <button
            disabled={(activePage + 1) * 100 >= levels.length}
            onClick={() => setPage(activePage + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}
function Sheet({ sheet, items }: { sheet: Entity; items: Entity[] }) {
  const ed = useEditor(sheet),
    [tab, setTab] = useState(tabs[0])
  return (
    <section className="lab-sheet stack">
      <div className="split">
        <input
          className="scene-title"
          aria-label="数值表名称"
          value={ed.e.title}
          onChange={(e) => ed.edit({ title: e.target.value })}
        />
        <SaveStatus editor={ed} />
        <TrashEntry editor={ed} />
      </div>
      <div className="segments">
        {tabs.map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === tabs[0] ? <Growth ed={ed} /> : <DropLab ed={ed} items={items} />}
    </section>
  )
}
export default function BalanceView() {
  const w = useWorld('balance_sheet', tabs[0]),
    [query, setQuery] = useState('')
  const selected = w.selected ?? w.rows[0]
  return (
    <section className="world stack">
      <Heading title="数值平衡" />
      <div className="balance-layout">
        <aside className="lab-list stack">
          <SearchField label="搜索数值表" query={query} set={setQuery} />
          {w.rows
            .filter((e) => matches(e, query))
            .map((e) => (
              <button
                className={
                  'world-entry ' + (e.id === selected?.id ? 'active' : '')
                }
                key={e.id}
                onClick={() => w.inspect(e.id)}
              >
                {e.title}
              </button>
            ))}
          <Add
            label="新建数值表"
            click={() =>
              void w.create('新数值表', {
                minLevel: 1,
                maxLevel: 50,
                vars: { base: 100, rate: 1.6 },
                formulas: [formula(0, 'base * level ^ rate')],
                entries: [],
              })
            }
          />
        </aside>
        {selected ? (
          <Sheet
            key={selected.id}
            sheet={selected}
            items={w.entities.filter((e) => e.entityType === 'item')}
          />
        ) : (
          <p className="empty">新建数值表以添加公式和掉落项。</p>
        )}
      </div>
    </section>
  )
}
