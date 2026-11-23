import { useState } from 'react'
import { Download, FileSpreadsheet, Plus, Upload } from 'lucide-react'
import { api } from '../../api/client'
import type { ParsedTable } from '../../api/table'
import { newEntity } from '../../state/catalog'
import {
  bugClosed,
  bugStates,
  bugStatus,
  dayKey,
  field,
  severities,
} from '../../state/planning'
import { useWorkspace } from '../../state/workspace'
import { Modal } from '../../components/ui'

const fields = [
  ['title', '标题'],
  ['severity', '严重程度'],
  ['status', '状态'],
  ['version', '版本'],
  ['foundDate', '发现日期'],
  ['reproSteps', '复现步骤'],
  ['expected', '预期结果'],
  ['actual', '实际结果'],
]
function template() {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + fields.map((f) => f[1]).join(',') + '\r\n'], {
      type: 'text/csv;charset=utf-8',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'Bug 导入模板.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
function ImportBugs({ close }: { close: () => void }) {
  const { project, notify } = useWorkspace()
  const [table, setTable] = useState<ParsedTable | null>(null),
    [mapping, map] = useState<number[]>([]),
    [error, fail] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState('')
  async function read(file?: File) {
    if (!file || busy) return
    setBusy(true)
    fail('')
    setTable(null)
    try {
      const value = await api.parseTabularFile(file)
      setTable(value)
      setName(file.name)
      map(
        fields.map(([key, title]) =>
          value.headers.findIndex((h) =>
            [key.toLowerCase(), title].includes(h.trim().toLowerCase()),
          ),
        ),
      )
    } catch (e) {
      fail(String(e))
    } finally {
      setBusy(false)
    }
  }
  const rows = (table?.rows ?? []).filter((row) => row[mapping[0]]?.trim())
  async function submit() {
    setBusy(true)
    fail('')
    try {
      const items = rows.map((row) => {
        const values = Object.fromEntries(
          fields.map(([key], i) => [key, (row[mapping[i]] ?? '').trim()]),
        )
        const { title, status, ...data } = values,
          item = newEntity(project.id, 'bug', title)
        item.status = bugStates.includes(status) ? status : '待处理'
        data.severity = severities.includes(data.severity)
          ? data.severity
          : '一般'
        if (!data.foundDate) data.foundDate = dayKey()
        item.data = data
        return item
      })
      await api.saveBatch(items)
      notify('已导入 ' + items.length + ' 条 Bug')
      close()
    } catch (e) {
      fail(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      wide
      title="表格导入 (CSV/XLSX)"
      onClose={() => {
        if (!busy) close()
      }}
    >
      <div className="form-body stack">
        <button className="secondary" onClick={template}>
          <Download size={15} />
          下载 CSV 模板
        </button>
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void read(e.dataTransfer.files[0])
          }}
        >
          <Upload />
          {busy ? '正在处理…' : name || '选择或拖入 CSV、XLS、XLSX 文件'}
          <input
            type="file"
            disabled={busy}
            accept=".csv,.xls,.xlsx"
            onChange={(e) => void read(e.target.files?.[0])}
          />
        </label>
        {table && (
          <>
            <h3>列映射</h3>
            <div className="fields-two">
              {fields.map(([key, label], i) => (
                <label key={key} className="field">
                  <span>
                    {label}
                    {!i ? ' *' : ''}
                  </span>
                  <select
                    value={mapping[i]}
                    onChange={(e) =>
                      map(
                        mapping.map((n, j) =>
                          i === j ? Number(e.target.value) : n,
                        ),
                      )
                    }
                  >
                    <option value={-1}>忽略</option>
                    {table.headers.map((h, j) => (
                      <option key={j} value={j}>
                        {h || '第 ' + (j + 1) + ' 列'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="split">
              <h3>导入预览</h3>
              <small>{table.totalRows} 行 · 显示前 5 行</small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {fields.map((f) => (
                      <th key={f[0]}>{f[1]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {mapping.map((col, j) => (
                        <td key={j}>{row[col] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table.totalRows !== rows.length && (
              <small>{table.totalRows - rows.length} 行缺少标题，将跳过</small>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          disabled={!rows.length || busy}
          onClick={() => void submit()}
        >
          导入 {rows.length} 条 Bug
        </button>
      </div>
    </Modal>
  )
}
export default function BugsView() {
  const {
    entities,
    project,
    save,
    run,
    inspect,
    smartImport,
    assistant,
    selected,
  } = useWorkspace()
  const [q, search] = useState(''),
    [status, setStatus] = useState(''),
    [severity, setSeverity] = useState(''),
    [importing, setImporting] = useState(false)
  const all = entities.filter((e) => e.entityType === 'bug'),
    rows = all.filter(
      (e) =>
        (!status ||
          (status === '已关闭' ? bugClosed(e) : bugStatus(e) === status)) &&
        (!severity || field(e, 'severity', '一般') === severity) &&
        (e.title + e.summary + field(e, 'version'))
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
  function create() {
    const e = newEntity(project.id, 'bug', '新 Bug')
    e.status = '待处理'
    e.data = { severity: '一般', foundDate: dayKey() }
    void run(async () => {
      await save(e)
      inspect(e.id)
    })
  }
  return (
    <>
      <div className="module-title">
        <h1>Bug 追踪</h1>
        <div className="actions">
          <button
            className="secondary"
            onClick={() =>
              assistant('结合反馈补全复现步骤和预期结果。', selected)
            }
          >
            AI 填写
          </button>
          <button className="secondary" onClick={() => smartImport('bugs')}>
            AI 智能导入
          </button>
          <button className="secondary" onClick={() => setImporting(true)}>
            <FileSpreadsheet size={15} />
            表格导入 (CSV/XLSX)
          </button>
          <button className="primary" onClick={create}>
            <Plus size={16} />
            记录 Bug
          </button>
        </div>
      </div>
      <div className="kpis">
        {[...severities, '已关闭'].map((s, i) => (
          <button
            key={s}
            className={'panel metric severity-' + i}
            onClick={() => {
              setSeverity(i === 4 ? '' : s)
              setStatus(i === 4 ? s : '')
            }}
          >
            <small>{s}</small>
            <strong>
              {
                all.filter((e) =>
                  i === 4 ? bugClosed(e) : field(e, 'severity', '一般') === s,
                ).length
              }
            </strong>
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          aria-label="搜索 Bug"
          placeholder="搜索 Bug…"
          value={q}
          onChange={(e) => search(e.target.value)}
        />
        {['', ...bugStates].map((s) => (
          <button
            key={s}
            className={'chip ' + (s === status ? 'active' : '')}
            onClick={() => setStatus(s)}
          >
            {s || '全部'}
          </button>
        ))}
        <select
          aria-label="筛选严重程度"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">全部严重程度</option>
          {severities.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              {['严重程度', '标题', '状态', '版本', '发现日期'].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <span
                    className={
                      'badge severity-' +
                      severities.indexOf(field(e, 'severity', '一般'))
                    }
                  >
                    {field(e, 'severity', '一般')}
                  </span>
                </td>
                <td>
                  <button className="card-title" onClick={() => inspect(e.id)}>
                    {e.title}
                  </button>
                </td>
                <td>{bugStatus(e)}</td>
                <td>{field(e, 'version', '—')}</td>
                <td>{field(e, 'foundDate', dayKey(new Date(e.createdAt)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">没有匹配的 Bug</p>}
      </div>
      {importing && <ImportBugs close={() => setImporting(false)} />}
    </>
  )
}
