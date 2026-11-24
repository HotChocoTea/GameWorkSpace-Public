import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { api, desktop } from '../../api/client'
import { native } from '../../api/ai'
import { Modal } from '../../components/ui'

const presets = {
  unity: 'Unity C# + JSON',
  godot: 'Godot GDScript + JSON',
  unreal: 'Unreal DataTable CSV',
  generic: '通用 JSON + Tiled .tmj',
}
const defaults = {
  targetDir: '',
  preset: 'generic',
  autoSyncOnSave: false,
  includeMaps: true,
  includeYarn: true,
  includeLocalization: true,
}
type Config = typeof defaults
type Result = {
  targetDir: string
  filesWritten: string[]
  fileSizes: Record<string, number>
  syncedAt: string
  totalBytes: number
}
export default function EngineSyncModal({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const key = 'engine_sync:' + projectId
  const [config, set] = useState<Config>(defaults),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [status, report] = useState(''),
    [result, setResult] = useState<Result>()
  useEffect(() => {
    let live = true
    api
      .getSetting(key)
      .then((s) => {
        if (live) {
          set({ ...defaults, ...(s?.value as Partial<Config>) })
          setReady(true)
        }
      })
      .catch((e) => report(String(e)))
    return () => {
      live = false
    }
  }, [key])
  async function save(sync: boolean) {
    setBusy(true)
    report('')
    try {
      const next = { ...config, targetDir: config.targetDir.trim() }
      if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(next.targetDir))
        throw Error('请输入完整的输出目录路径')
      await api.saveSetting(key, next)
      if (sync)
        setResult(
          await native<Result>('sync_project_to_engine', {
            projectId,
            config: next,
          }),
        )
      report(sync ? '同步完成' : '已保存同步设置')
    } catch (e) {
      report(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="引擎数据同步" onClose={onClose}>
      <div className="form-body stack">
        <label>
          目标目录
          <input
            placeholder="D:\UnityProject\MyGame\Assets\GameData"
            value={config.targetDir}
            onChange={(e) => set({ ...config, targetDir: e.target.value })}
          />
        </label>
        <label>
          引擎预设
          <select
            value={config.preset}
            onChange={(e) => set({ ...config, preset: e.target.value })}
          >
            {Object.entries(presets).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ['includeMaps', '地图 · Tiled .tmj'],
            ['includeYarn', '场景对白 · Yarn .yarn'],
            ['includeLocalization', '本地化 JSON / CSV'],
            ['autoSyncOnSave', '保存时自动热同步'],
          ] as const
        ).map(([k, label]) => (
          <label className="setting-row" key={k}>
            {label}
            <input
              type="checkbox"
              checked={config[k]}
              onChange={(e) => set({ ...config, [k]: e.target.checked })}
            />
          </label>
        ))}
        <div className="actions">
          <button
            className="secondary"
            disabled={!ready || busy}
            onClick={() => void save(false)}
          >
            保存设置
          </button>
          <button
            className="primary"
            disabled={!desktop || !ready || busy}
            onClick={() => void save(true)}
          >
            <RefreshCw size={15} />
            {busy ? '处理中…' : '一键同步到引擎'}
          </button>
        </div>
        {!desktop && <small>在桌面端将文件写入引擎目录。</small>}
        {status && <p role="status">{status}</p>}
        {result && (
          <section className="stack">
            <p>
              {new Date(result.syncedAt).toLocaleString()} ·{' '}
              {result.filesWritten.length} 个文件 ·{' '}
              {result.totalBytes.toLocaleString()} B
            </p>
            <div className="snapshot-list">
              {result.filesWritten.map((f) => (
                <div className="setting-row" key={f}>
                  <code>{f}</code>
                  <small>{result.fileSizes[f].toLocaleString()} B</small>
                </div>
              ))}
            </div>
            <button
              className="secondary"
              onClick={() =>
                void native('open_data_dir_in_explorer', {
                  dir: result.targetDir,
                }).catch((e) => report(String(e)))
              }
            >
              <FolderOpen size={15} />
              打开输出目录
            </button>
          </section>
        )}
      </div>
    </Modal>
  )
}
