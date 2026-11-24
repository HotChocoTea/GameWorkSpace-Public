import { useState } from 'react'
import { native } from '../../api/ai'
import type { Entity } from '../../types'
import { rowsOf, numeric, scalar, type Editor } from './worldUtils'

type Drop = {
  id: string
  itemId: string
  name: string
  weight: number
  minQty: number
  maxQty: number
  unitValue: number
}
type Simulation = {
  rolls: number
  totalValue: number
  expectedValue: number
  entries: {
    id: string
    probability: number
    count: number
    dropRate: number
    expectedQuantity: number
  }[]
}
const fields = [
  ['weight', '权重'],
  ['minQty', '最小数量'],
  ['maxQty', '最大数量'],
  ['unitValue', '单价'],
] as const
const percent = (v: number) => (v * 100).toFixed(2) + '%'
export function DropLab({ ed, items }: { ed: Editor; items: Entity[] }) {
  const entries: Drop[] = rowsOf(ed.e, 'entries').map((r) => ({
    id: r.id,
    itemId: scalar(r.itemId),
    name: scalar(r.name, r.id),
    weight: numeric(r.weight) ?? 1,
    minQty: numeric(r.minQty) ?? 1,
    maxQty: numeric(r.maxQty) ?? 1,
    unitValue: numeric(r.unitValue ?? r.value) ?? 0,
  }))
  const [rolls, setRolls] = useState(10000),
    [seed, setSeed] = useState('')
  const [result, setResult] = useState<{ key: string; sim: Simulation }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const key = JSON.stringify([entries, rolls, seed]),
    sim = result?.key === key ? result.sim : undefined
  const update = (id: string, patch: Partial<Drop>) =>
    ed.data(
      'entries',
      entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )
  async function run() {
    setError('')
    setBusy(true)
    setResult(undefined)
    try {
      if (
        seed.trim() &&
        (!Number.isSafeInteger(Number(seed)) || Number(seed) < 0)
      )
        throw Error('种子必须是非负安全整数')
      const sim = await native<Simulation>('simulate_drop_table', {
        entries,
        rolls,
        seed: seed.trim() ? Number(seed) : null,
      })
      setResult({ key, sim })
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <div className="lab-table-scroll">
        <table className="lab-table drop-inputs">
          <thead>
            <tr>
              <th>关联物品</th>
              <th>条目</th>
              {fields.map(([k, label]) => (
                <th key={k}>{label}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.id}>
                <td>
                  <select
                    aria-label="关联物品"
                    value={row.itemId}
                    onChange={(e) => {
                      const item = items.find((i) => i.id === e.target.value)
                      update(
                        row.id,
                        item
                          ? {
                              itemId: item.id,
                              name: item.title,
                              unitValue: numeric(item.data?.price) ?? 0,
                            }
                          : { itemId: '' },
                      )
                    }}
                  >
                    <option value="">自定义</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label="掉落项名称"
                    value={row.name}
                    onChange={(e) => update(row.id, { name: e.target.value })}
                  />
                </td>
                {fields.map(([field, label]) => (
                  <td key={field}>
                    <input
                      aria-label={row.name + label}
                      type="number"
                      min="0"
                      step={field.endsWith('Qty') ? 1 : 'any'}
                      value={row[field]}
                      onChange={(e) =>
                        update(row.id, { [field]: Number(e.target.value) })
                      }
                    />
                  </td>
                ))}
                <td>
                  <button
                    aria-label="删除掉落项"
                    onClick={() =>
                      ed.data(
                        'entries',
                        entries.filter((e) => e.id !== row.id),
                      )
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lab-tools">
        <button
          onClick={() =>
            ed.data('entries', [
              ...entries,
              {
                id: crypto.randomUUID(),
                itemId: '',
                name: '新掉落项',
                weight: 1,
                minQty: 1,
                maxQty: 1,
                unitValue: 1,
              },
            ])
          }
        >
          ＋ 添加掉落项
        </button>
        <label>
          模拟次数
          <select
            value={rolls}
            onChange={(e) => setRolls(Number(e.target.value))}
          >
            {[100, 1000, 10000, 50000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label>
          种子
          <input
            type="number"
            min="0"
            placeholder="随机"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !entries.length}
          onClick={() => void run()}
        >
          {busy ? '模拟中…' : '运行蒙特卡洛模拟'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {sim && (
        <>
          <div className="asset-kpis drop-kpis">
            {[
              ['单次期望价值', sim.expectedValue],
              ['总模拟次数', sim.rolls],
              ['总产出价值', sim.totalValue],
            ].map(([label, v]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{v.toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <div className="lab-table-scroll">
            <table className="lab-table">
              <thead>
                <tr>
                  {[
                    '条目',
                    '理论概率',
                    '实测次数',
                    '实测概率',
                    '偏差',
                    '期望数量 / 次',
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sim.entries.map((r, i) => (
                  <tr key={r.id}>
                    <th>{entries[i].name}</th>
                    <td>{percent(r.probability)}</td>
                    <td>{r.count}</td>
                    <td>{percent(r.dropRate)}</td>
                    <td>
                      {((r.dropRate - r.probability) * 100).toFixed(2)} pp
                    </td>
                    <td>{r.expectedQuantity.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figure className="rate-chart">
            <figcaption>理论概率 / 实测概率</figcaption>
            {sim.entries.map((r, i) => (
              <div key={r.id}>
                <span>{entries[i].name}</span>
                <section>
                  {[r.probability, r.dropRate].map((v, j) => (
                    <i
                      key={j}
                      title={percent(v)}
                      style={{ width: percent(v) }}
                    />
                  ))}
                </section>
              </div>
            ))}
          </figure>
        </>
      )}
    </div>
  )
}
