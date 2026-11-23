import { useState } from 'react'
import { Check, Upload, Trash2, ImagePlus } from 'lucide-react'
import type { Project } from '../../types'
import { api } from '../../api/client'
import { presets, modules, groups } from '../../state/catalog'
import { Modal } from '../../components/ui'

export function ProjectForm({
  initial,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Project
  isNew: boolean
  onClose: () => void
  onSave: (p: Project) => Promise<void>
  onDelete: () => void
}) {
  const [p, set] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  function field<K extends keyof Project>(k: K, v: Project[K]) {
    set((prev) => ({ ...prev, [k]: v }))
  }
  const upload = async (
    file: File | undefined,
    key: 'coverAsset' | 'logoAsset',
  ) => {
    if (!file) return
    setBusy(true)
    try {
      field(key, (await api.upload(file)).filename)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  function multi(key: 'genres' | 'platforms', choices: string[]) {
    return (
      <div className="choice-list">
        {[...new Set([...choices, ...p[key]])].map((x) => (
          <button
            type="button"
            aria-pressed={p[key].includes(x)}
            className={p[key].includes(x) ? 'selected' : ''}
            key={x}
            onClick={() =>
              field(
                key,
                p[key].includes(x)
                  ? p[key].filter((g) => g !== x)
                  : [...p[key], x],
              )
            }
          >
            {x}
          </button>
        ))}
      </div>
    )
  }
  return (
    <Modal wide title={isNew ? '新建项目' : '项目设置'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!p.name.trim()) {
            setError('请输入项目名称')
            return
          }
          setBusy(true)
          try {
            await onSave({ ...p, name: p.name.trim() })
            onClose()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="form-body">
          <label>
            项目名称
            <input
              autoFocus
              required
              maxLength={100}
              value={p.name}
              onChange={(e) => field('name', e.target.value)}
              placeholder="为你的世界命名"
            />
          </label>
          <label>
            一句话简介
            <textarea
              rows={2}
              value={p.pitch}
              onChange={(e) => field('pitch', e.target.value)}
              placeholder="这个项目讲述怎样的故事？"
            />
          </label>
          <fieldset>
            <legend>项目封面</legend>
            <div className="cover-grid">
              {Object.entries(presets).map(([key, label]) => (
                <button
                  type="button"
                  className={
                    p.coverPreset === key && !p.coverAsset ? 'selected' : ''
                  }
                  aria-pressed={p.coverPreset === key && !p.coverAsset}
                  key={key}
                  onClick={() =>
                    set({ ...p, coverPreset: key, coverAsset: null })
                  }
                >
                  <img src={'/covers/' + key + '.jpg'} alt="" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <label className="file-button">
              <Upload size={14} />
              {p.coverAsset ? '更换自定义封面' : '上传封面'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void upload(e.target.files?.[0], 'coverAsset')}
              />
            </label>
            {p.coverAsset && (
              <img
                className="upload-preview"
                src={api.assetUrl(p.coverAsset)}
                alt="自定义封面"
              />
            )}
          </fieldset>
          <div className="form-row">
            <fieldset>
              <legend>项目 Logo</legend>
              <div className="actions">
                {p.logoAsset && (
                  <img
                    className="logo-thumb"
                    src={api.assetUrl(p.logoAsset)}
                    alt="项目 Logo"
                  />
                )}
                <label className="file-button">
                  <ImagePlus size={14} />
                  上传 Logo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      void upload(e.target.files?.[0], 'logoAsset')
                    }
                  />
                </label>
                <button
                  type="button"
                  className="subtle"
                  onClick={() => field('logoAsset', null)}
                >
                  无
                </button>
              </div>
            </fieldset>
            <label>
              开发引擎
              <select
                value={p.engine}
                onChange={(e) => field('engine', e.target.value)}
              >
                {[
                  'Unity',
                  'Unreal Engine',
                  'Godot',
                  'GameMaker',
                  '自研引擎',
                  '其他',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>游戏类型</legend>
            {multi('genres', [
              '叙事冒险',
              '探索',
              '角色扮演',
              '解谜',
              '模拟经营',
              '动作',
              '策略',
            ])}
          </fieldset>
          <fieldset>
            <legend>目标平台</legend>
            {multi('platforms', [
              'PC',
              'Steam Deck',
              'Switch',
              'PlayStation',
              'Xbox',
              'iOS',
              'Android',
              'Web',
            ])}
          </fieldset>
        </div>
        <footer className="modal-footer">
          {!isNew && (
            <button
              type="button"
              className="danger-text push-left"
              onClick={onDelete}
            >
              <Trash2 size={15} />
              删除项目
            </button>
          )}
          {error && (
            <span role="alert" className="danger-text">
              {error}
            </span>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {isNew ? '创建项目' : '保存设置'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
export function ModulesDialog({
  p,
  onClose,
  onSave,
}: {
  p: Project
  onClose: () => void
  onSave: (p: Project) => Promise<void>
}) {
  const [ids, set] = useState(p.enabledModules),
    [error, setError] = useState('')
  return (
    <Modal title="添加功能" wide onClose={onClose}>
      <div className="form-body">
        {groups.map((g) => (
          <fieldset key={g.name}>
            <legend>{g.name}</legend>
            <div className="module-grid">
              {g.items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={ids.includes(m.id) ? 'selected' : ''}
                  aria-pressed={ids.includes(m.id)}
                  onClick={() =>
                    set(
                      ids.includes(m.id)
                        ? ids.filter((x) => x !== m.id)
                        : [...ids, m.id],
                    )
                  }
                >
                  <m.icon size={16} />
                  {m.label}
                  {ids.includes(m.id) && <Check size={14} />}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <footer className="modal-footer">
        <span className="push-left muted">
          已启用 {ids.length} / {modules.length}
        </span>
        {error && <span role="alert">{error}</span>}
        <button
          className="primary"
          onClick={async () => {
            try {
              await onSave({ ...p, enabledModules: ids })
              onClose()
            } catch (e) {
              setError(String(e))
            }
          }}
        >
          保存功能
        </button>
      </footer>
    </Modal>
  )
}
