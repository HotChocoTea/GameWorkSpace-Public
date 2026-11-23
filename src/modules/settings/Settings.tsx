import { lazy, Suspense, useState } from 'react'
import {
  Palette,
  Keyboard,
  Database,
  Sparkles,
  Cable,
  Upload,
  RotateCcw,
  Trash2,
  Download,
  Check,
  ImageOff,
} from 'lucide-react'
import { AiSettings } from './AiSettings'
import { native, downloadFile } from '../../api/ai'
import { api } from '../../api/client'
import {
  defaults,
  themes,
  shortcutOf,
  type Preferences,
  type Theme,
} from '../../state/catalog'
import { Modal } from '../../components/ui'
import type { ProjectStats } from '../../types'

const tabs = [
  ['外观', Palette],
  ['快捷键', Keyboard],
  ['数据与备份', Database],
  ['AI API Key', Sparkles],
  ['MCP 配置', Cable],
] as const
const McpSettings = lazy(() => import('./McpSettings'))
export function Settings({
  prefs,
  update,
  stats,
  onClose,
  bin,
  backup,
  restore,
  smartImport,
  initialTab,
}: {
  prefs: Preferences
  update: (patch: Partial<Preferences>) => void
  stats: ProjectStats[]
  onClose: () => void
  bin: () => void
  restore: () => void
  smartImport?: () => void
  initialTab: string
  backup: () => void
}) {
  const [tab, setTab] = useState<string>(initialTab),
    [capture, setCapture] = useState<'ai' | 'search' | null>(null),
    [error, setError] = useState('')
  return (
    <Modal title="设置" onClose={onClose} wide>
      <div className="settings-layout">
        <nav aria-label="设置分类">
          {tabs.map(([t, Icon]) => (
            <button
              className={tab === t ? 'active' : ''}
              key={t}
              onClick={() => {
                setTab(t)
                setCapture(null)
                setError('')
              }}
            >
              <Icon size={16} />
              {t}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          <h3>{tab}</h3>
          {tab === '外观' && (
            <>
              <fieldset>
                <legend>工作台主题</legend>
                <div className="theme-options">
                  {(Object.entries(themes) as [Theme, string][]).map(
                    ([k, v]) => (
                      <button
                        aria-pressed={prefs.theme === k}
                        key={k}
                        className={prefs.theme === k ? 'selected' : ''}
                        onClick={() => update({ theme: k })}
                      >
                        <i className={'swatch ' + k} />
                        <span>{v}</span>
                        {prefs.theme === k && <Check size={13} />}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
              <fieldset>
                <legend>亮度</legend>
                <div className="choice-list">
                  {(['system', 'light', 'dark'] as const).map((b, i) => (
                    <button
                      key={b}
                      className={prefs.brightness === b ? 'selected' : ''}
                      aria-pressed={prefs.brightness === b}
                      onClick={() => update({ brightness: b })}
                    >
                      {['跟随系统', '浅色', '深色'][i]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>工作台壁纸</legend>
                <div className="wall-options">
                  <button
                    className={!prefs.wallpaper ? 'selected' : ''}
                    onClick={() => update({ wallpaper: null })}
                  >
                    <ImageOff size={16} />无
                  </button>
                  {prefs.wallpapers.map((n, i) => (
                    <button
                      key={n}
                      aria-label={'选择壁纸 ' + (i + 1)}
                      className={prefs.wallpaper === n ? 'selected' : ''}
                      onClick={() => update({ wallpaper: n })}
                    >
                      <img src={api.assetUrl(n)} alt={'壁纸 ' + (i + 1)} />
                    </button>
                  ))}
                  <label className="file-button">
                    <Upload size={14} />
                    上传图片
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]
                        if (f)
                          try {
                            const { filename } = await api.upload(f)
                            update({
                              wallpaper: filename,
                              wallpapers: [
                                ...new Set([...prefs.wallpapers, filename]),
                              ],
                            })
                          } catch (e) {
                            setError(String(e))
                          }
                      }}
                    />
                  </label>
                </div>
              </fieldset>
              <label className="range-label">
                模糊 <span>{prefs.blur} px</span>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={prefs.blur}
                  onChange={(e) => update({ blur: +e.target.value })}
                />
              </label>
              <label className="range-label">
                淡化 <span>{prefs.fade}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={prefs.fade}
                  onChange={(e) => update({ fade: +e.target.value })}
                />
              </label>
            </>
          )}
          {tab === '快捷键' && (
            <>
              {(['search', 'ai'] as const).map((key, i) => (
                <div className="setting-row" key={key}>
                  <span>{['全局搜索', 'AI 助手'][i]}</span>
                  <button
                    className="key-editor"
                    onClick={() => setCapture(key)}
                    onKeyDown={(e) => {
                      if (capture !== key) return
                      e.stopPropagation()
                      e.preventDefault()
                      if (e.key === 'Escape') {
                        setCapture(null)
                        return
                      }
                      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key))
                        return
                      const chord = shortcutOf(e)
                      if (
                        chord ===
                        prefs.shortcuts[key === 'ai' ? 'search' : 'ai']
                      ) {
                        setError('这个组合键已分配')
                        return
                      }
                      setError('')
                      update({
                        shortcuts: { ...prefs.shortcuts, [key]: chord },
                      })
                      setCapture(null)
                    }}
                  >
                    {capture === key ? '请按下组合键' : prefs.shortcuts[key]}
                  </button>
                </div>
              ))}
              <button
                className="secondary"
                onClick={() => {
                  update({ shortcuts: { ...defaults.shortcuts } })
                  setCapture(null)
                  setError('')
                }}
              >
                <RotateCcw size={14} />
                恢复默认快捷键
              </button>
            </>
          )}
          {tab === '数据与备份' && (
            <>
              <div className="setting-row">
                本地项目<b>{stats.length}</b>
              </div>
              <div className="setting-row">
                创作条目<b>{stats.reduce((n, s) => n + s.entities, 0)}</b>
              </div>
              <div className="setting-row">
                回收站保留时间<b>14 天</b>
              </div>
              <div className="actions wrap">
                <button className="secondary" onClick={bin}>
                  <Trash2 size={15} />
                  打开回收站
                </button>
                <button className="secondary" onClick={restore}>
                  导入备份文件
                </button>
                {smartImport && (
                  <button className="secondary" onClick={smartImport}>
                    AI 智能导入
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      const bytes =
                        await native<ArrayBuffer>('export_all_backups')
                      downloadFile(
                        bytes,
                        '全部项目.gws.json',
                        'application/json',
                      )
                    } catch (e) {
                      setError(String(e))
                    }
                  }}
                >
                  导出全部项目备份
                </button>
                <button className="secondary" onClick={backup}>
                  <Download size={15} />
                  导出项目
                </button>
              </div>
            </>
          )}
          {tab === 'AI API Key' && <AiSettings />}
          {tab === 'MCP 配置' && (
            <Suspense fallback={<p role="status">正在读取 MCP 配置…</p>}>
              <McpSettings />
            </Suspense>
          )}
          {error && (
            <p role="alert" className="danger-text">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
