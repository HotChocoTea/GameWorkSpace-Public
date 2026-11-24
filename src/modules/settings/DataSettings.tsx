import { useEffect, useState } from 'react'
import { api, desktop } from '../../api/client'
import { native } from '../../api/ai'
import { FolderOpen, History } from 'lucide-react'
import type { Project } from '../../types'

type SnapshotInfo = {
  filename: string
  createdAt: string
  sizeBytes: number
  label: string
}
export function DataSettings() {
  const [dir, setDir] = useState(''),
    [target, setTarget] = useState(''),
    [auto, setAuto] = useState(true),
    [rows, setRows] = useState<SnapshotInfo[]>([])
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [moved, setMoved] = useState(''),
    [form, setForm] = useState(false),
    [restore, setRestore] = useState('')
  async function refresh() {
    setRows(await native<SnapshotInfo[]>('list_snapshots'))
  }
  useEffect(() => {
    if (!desktop) return
    let live = true
    Promise.all([
      native<string>('active_data_dir'),
      api.getSetting('snapshots:auto'),
      native<SnapshotInfo[]>('list_snapshots'),
    ])
      .then(([path, pref, list]) => {
        if (live) {
          setDir(path)
          setAuto(pref?.value !== false)
          setRows(list)
        }
      })
      .catch((e) => {
        if (live) setStatus(String(e))
      })
    return () => {
      live = false
    }
  }, [])
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack data-settings">
      <fieldset>
        <legend>工作区数据目录</legend>
        <code className="path-label">
          {desktop ? dir || '正在读取…' : '浏览器预览 · 本地目录在桌面端可用'}
        </code>
        <div className="actions wrap">
          <button
            disabled={!dir}
            className="secondary"
            onClick={() =>
              void run(() => native('open_data_dir_in_explorer', { dir }))
            }
          >
            <FolderOpen size={15} />
            打开目录
          </button>
          <button
            className="secondary"
            disabled={!dir || !!moved}
            onClick={() => setForm(!form)}
          >
            迁移数据目录
          </button>
        </div>
        {form && (
          <form
            className="stack"
            onSubmit={(ev) => {
              ev.preventDefault()
              void run(async () => {
                const result = await native<{ dataDir: string }>(
                  'migrate_data_dir',
                  { targetDir: target.trim() },
                )
                setMoved(result.dataDir)
                setForm(false)
              })
            }}
          >
            <label>
              目标空目录
              <input
                required
                value={target}
                placeholder="D:\GameWorkSpaceData"
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <small>
              迁移后立即重启桌面端和 MCP
              服务以切换工作区。启动参数和环境变量中的目录优先。
            </small>
            <button
              className="primary"
              disabled={busy || !target.trim() || target.trim() === dir}
            >
              校验并迁移
            </button>
          </form>
        )}
        {moved && (
          <p role="status">已迁移至 {moved}。请现在重启应用和 MCP 服务。</p>
        )}
      </fieldset>
      <fieldset>
        <legend>
          <History size={16} /> 自动快照 &amp; 本地时光机
        </legend>
        <label className="setting-row">
          启动时自动创建每日快照
          <input
            type="checkbox"
            disabled={!desktop || busy}
            checked={auto}
            onChange={(e) => {
              const next = e.target.checked
              void run(async () => {
                await api.saveSetting('snapshots:auto', next)
                setAuto(next)
              })
            }}
          />
        </label>
        <div className="setting-row">
          <span>保留最近 7 份</span>
          <button
            className="secondary"
            disabled={!desktop || busy || !!moved}
            onClick={() =>
              void run(async () => {
                await native('create_snapshot', {
                  projectId: null,
                  label: '手动快照',
                })
                await refresh()
                setStatus('已创建快照')
              })
            }
          >
            立即创建快照
          </button>
        </div>
        <div className="snapshot-list">
          {rows.map((s) => (
            <div className="setting-row" key={s.filename}>
              <span>
                <strong>{s.label}</strong>
                <small>
                  {new Date(s.createdAt).toLocaleString()} ·{' '}
                  {s.sizeBytes.toLocaleString()} B
                </small>
              </span>
              <button
                className="text-action"
                disabled={busy || !!moved}
                onClick={() => setRestore(s.filename)}
              >
                恢复此快照
              </button>
            </div>
          ))}
          {!rows.length && <small>暂无本地快照</small>}
        </div>
        {restore && (
          <div className="stack">
            <small>从 {restore} 恢复项目副本，现有项目会保留。</small>
            <div className="actions">
              <button className="secondary" onClick={() => setRestore('')}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const projects = await native<Project[]>(
                      'restore_snapshot',
                      { filename: restore },
                    )
                    setRestore('')
                    setStatus('已恢复 ' + projects.length + ' 个项目')
                  })
                }
              >
                确认恢复
              </button>
            </div>
          </div>
        )}
      </fieldset>
      {status && <p role="status">{status}</p>}
    </div>
  )
}
