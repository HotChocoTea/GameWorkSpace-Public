import { useEffect, useRef, useState } from 'react'
import { Archive, FileText, FolderArchive, Upload } from 'lucide-react'
import { Modal } from '../../components/ui'
import { api, desktop } from '../../api/client'
import {
  downloadFile,
  fileBytes,
  native,
  preferences,
  type Candidate,
  type ImportMode,
} from '../../api/ai'
import type { Project } from '../../types'

type Done = (message: string) => void
const formats = [
  {
    command: 'export_project_zip',
    ext: '.zip',
    mime: 'application/zip',
    icon: FolderArchive,
    title: '完整设计包',
    detail: '给 AI Agent 开发 · 设计文档、项目数据、地图与素材',
  },
  {
    command: 'export_project_backup',
    ext: '.gws.json',
    mime: 'application/json',
    icon: Archive,
    title: '完整备份',
    detail: '无损迁移 · 包含项目记录和原始素材',
  },
  {
    command: 'export_project_markdown',
    ext: '.md',
    mime: 'text/markdown;charset=utf-8',
    icon: FileText,
    title: '纯文本设计稿',
    detail: '阅读与分享 · 单文件 Markdown 游戏设计文档',
  },
]
export function ExportModal({
  projects,
  initial,
  onClose,
  done,
}: {
  projects: Project[]
  initial?: string
  onClose: () => void
  done: Done
}) {
  const [id, setId] = useState(initial ?? projects[0]?.id ?? ''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const project = projects.find((p) => p.id === id)
  async function save(f: (typeof formats)[number]) {
    if (!project) return
    setBusy(f.ext)
    setError('')
    try {
      if (!desktop && f.ext === '.gws.json') {
        const s = await api.exportProject(id)
        const embeddedAssets: Record<string, string> = {}
        for (const name of new Set(
          JSON.stringify(s).match(/[0-9a-f]{64}\.[a-z0-9]{1,10}/g) ?? [],
        )) {
          const response = await fetch(api.assetUrl(name))
          if (!response.ok) throw Error('无法读取资源 ' + name)
          const bytes = new Uint8Array(await response.arrayBuffer())
          let content = ''
          for (const b of bytes) content += String.fromCharCode(b)
          embeddedAssets[name] = btoa(content)
        }
        downloadFile(
          JSON.stringify({
            format: 'gameworkspace-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            snapshot: s,
            embeddedAssets,
          }),
          project.name + f.ext,
          f.mime,
        )
      } else {
        const data = await native<string | ArrayBuffer>(f.command, {
          projectId: id,
        })
        downloadFile(data, project.name + f.ext, f.mime)
      }
      done('已导出 ' + project.name + f.ext)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <Modal title="导出项目" onClose={onClose}>
      <div className="form-body export-options">
        <label>
          项目
          <select
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!busy}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {formats.map((f) => (
          <button
            key={f.ext}
            className="export-card"
            disabled={!project || !!busy}
            onClick={() => void save(f)}
          >
            <f.icon size={23} />
            <span>
              <strong>
                {f.title} <small>{f.ext}</small>
              </strong>
              <small>{f.detail}</small>
            </span>
          </button>
        ))}
        {busy && <p role="status">正在生成 {busy}…</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
export function RestoreModal({
  onClose,
  onRestore,
}: {
  onClose: () => void
  onRestore: (p: Project[]) => void
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function restore(f: File) {
    setBusy(true)
    setError('')
    try {
      onRestore(
        await native<Project[]>('import_backup_bytes', {
          bytes: await fileBytes(f),
        }),
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="导入项目备份" onClose={onClose}>
      <div className="form-body">
        <p>选择单项目或全部项目备份。重名 ID 将作为独立项目恢复。</p>
        <label className="file-button">
          <Upload size={16} />
          {busy ? '正在恢复…' : '选择备份文件'}
          <input
            type="file"
            disabled={busy}
            accept=".gws.json,.mino.json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void restore(f)
              e.target.value = ''
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
const labels: Record<string, string> = {
  character: '角色',
  location: '地点',
  faction: '阵营',
  quest: '任务线',
  item: '物品',
  lore: '设定',
  task: '任务',
  doc: '文档',
  bug: 'Bug',
}
export function ImportModal({
  projects,
  initialId,
  initial,
  onClose,
  imported,
}: {
  projects: Project[]
  initialId: string
  initial: ImportMode
  onClose: () => void
  imported: (ids: string[], project: Project) => void
}) {
  const [projectId, setProjectId] = useState(initialId)
  const project = projects.find((p) => p.id === projectId) ?? projects[0]
  const [mode, setMode] = useState(initial),
    [file, setFile] = useState<File>(),
    [raw, setRaw] = useState(''),
    [paste, setPaste] = useState('')
  const [items, setItems] = useState<Candidate[]>([]),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const version = useRef(0)
  const show = (rows: Candidate[]) => {
    setItems(rows)
    setSelected(new Set(rows.map((_, i) => i)))
  }
  useEffect(() => {
    const ticket = ++version.current
    setError('')
    show([])
    setRaw(file ? '' : paste)
    if (!file && !paste.trim()) {
      setBusy('')
      return
    }
    setBusy('正在解析…')
    const timer = setTimeout(
      async () => {
        try {
          const result = await native<{
            rawText: string
            candidates: Candidate[]
          }>('parse_import_file', {
            filename: file?.name ?? '粘贴.md',
            bytes: await fileBytes(file ?? new Blob([paste])),
            mode,
          })
          if (ticket === version.current) {
            setRaw(result.rawText)
            show(result.candidates)
          }
        } catch (e) {
          if (ticket === version.current) setError(String(e))
        } finally {
          if (ticket === version.current) setBusy('')
        }
      },
      file ? 0 : 180,
    )
    return () => {
      clearTimeout(timer)
      version.current++
    }
  }, [file, paste, mode])
  async function enhance() {
    const ticket = ++version.current
    setBusy('AI 深度解析中…')
    setError('')
    try {
      const { active } = await preferences()
      const candidates = await native<Candidate[]>('ai_parse_import', {
        projectId: project.id,
        mode,
        rawText: raw,
        config: active,
      })
      if (ticket === version.current) show(candidates)
    } catch (e) {
      if (ticket === version.current) setError(String(e))
    } finally {
      if (ticket === version.current) setBusy('')
    }
  }
  async function commit() {
    setBusy('正在导入…')
    setError('')
    try {
      const b = await native<{ createdIds: string[] }>('commit_import_batch', {
        projectId: project.id,
        candidates: items.filter((_, i) => selected.has(i)),
      })
      imported(b.createdIds, project)
    } catch (e) {
      setError(String(e))
      setBusy('')
    }
  }
  const locked = busy === '正在导入…'
  return (
    <Modal title="AI 智能导入" wide onClose={onClose}>
      <div className="form-body smart-import">
        <label>
          目标项目{' '}
          <select
            disabled={!!busy}
            value={project.id}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="choice-list">
          {(['design', 'bugs'] as const).map((m, i) => (
            <button
              className={mode === m ? 'selected' : ''}
              key={m}
              disabled={locked}
              onClick={() => setMode(m)}
            >
              {['设计文档 → 项目内容', '原始反馈 → Bug'][i]}
            </button>
          ))}
        </div>
        <label
          className="import-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (!locked && e.dataTransfer.files[0])
              setFile(e.dataTransfer.files[0])
          }}
        >
          <Upload size={19} />
          {file?.name ?? '拖入文件或点击选择'}
          <small>Word · Excel · CSV · Markdown · TXT</small>
          <input
            type="file"
            disabled={locked}
            accept=".docx,.xlsx,.xls,.csv,.md,.txt"
            onChange={(e) => {
              setFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <div className="import-split">
          <label>
            原始内容
            <textarea
              disabled={locked}
              rows={14}
              value={file ? raw : paste}
              placeholder="也可以直接粘贴文档或反馈…"
              onChange={(e) => {
                setFile(undefined)
                setPaste(e.target.value)
              }}
            />
          </label>
          <section>
            <h4>
              导入预览 <small>{items.length} 条</small>
            </h4>
            <div className="candidate-list">
              {items.map((c, i) => (
                <label key={i}>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    disabled={locked}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const s = new Set(prev)
                        if (e.target.checked) s.add(i)
                        else s.delete(i)
                        return s
                      })
                    }
                  />
                  <span>
                    <small className="badge">{labels[c.entityType]}</small>{' '}
                    <b>{c.title}</b>
                    <small>{c.summary || c.body}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
        {error && <p role="alert">{error}</p>}
        {busy && <small role="status">{busy}</small>}
      </div>
      <footer className="modal-footer">
        <button
          className="secondary"
          disabled={!!busy || !raw.trim()}
          onClick={() => void enhance()}
        >
          AI 深度解析
        </button>
        <button
          className="primary"
          disabled={!!busy || !selected.size}
          onClick={() => void commit()}
        >
          导入 {selected.size} 条内容
        </button>
      </footer>
    </Modal>
  )
}
