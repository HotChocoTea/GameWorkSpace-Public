import { useEffect, useState } from 'react'
import {
  defaultSystem,
  native,
  preferences,
  saveProvider,
  tiers,
  type Provider,
  type KeyStatus,
} from '../../api/ai'

export function AiSettings() {
  const [configs, setConfigs] = useState<Provider[]>([]),
    [id, setId] = useState(''),
    [key, setKey] = useState('')
  const [system, setSystem] = useState(defaultSystem),
    [status, setStatus] = useState<KeyStatus[]>([]),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    preferences()
      .then((p) => {
        if (live) {
          setConfigs(p.configs)
          setId(p.active.id)
          setStatus(p.status)
          setSystem(p.system)
        }
      })
      .catch((e) => {
        if (live) setFeedback(String(e))
      })
    return () => {
      live = false
    }
  }, [])
  const config = configs.find((p) => p.id === id),
    saved = status.find((p) => p.providerId === id)
  function patch(values: Partial<Provider>) {
    setConfigs((all) => all.map((p) => (p.id === id ? { ...p, ...values } : p)))
  }
  async function act(work: () => Promise<string>) {
    setBusy(true)
    setFeedback('')
    try {
      setFeedback(await work())
    } catch (e) {
      setFeedback(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ai-settings">
      {config && (
        <fieldset disabled={busy}>
          <label>
            服务提供商
            <select
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                setKey('')
                setFeedback('')
              }}
            >
              {configs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL
            <input
              type="url"
              value={config.baseUrl}
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </label>
          <div className="ai-form-pair">
            <label>
              模型
              <input
                list="ai-models"
                value={config.model}
                onChange={(e) => patch({ model: e.target.value })}
              />
              <datalist id="ai-models">
                {config.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label>
              推理深度
              <select
                value={config.reasoningTier}
                onChange={(e) =>
                  patch({
                    reasoningTier: e.target.value as Provider['reasoningTier'],
                  })
                }
              >
                {Object.entries(tiers).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {config.id === 'custom' && (
            <label>
              <input
                type="checkbox"
                checked={config.requiresKey}
                onChange={(e) => patch({ requiresKey: e.target.checked })}
              />
              需要 API Key
            </label>
          )}
          <label>
            API Key
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                saved?.configured ? '输入新密钥以替换' : '输入服务密钥'
              }
            />
          </label>
          <small>
            {saved?.configured
              ? '已使用 Windows DPAPI 加密保存 ' + saved.masked
              : config.requiresKey
                ? '尚未配置密钥'
                : '此服务可免密钥连接'}
          </small>
          <div className="actions wrap">
            <button
              className="secondary"
              disabled={!key.trim()}
              onClick={() =>
                void act(async () => {
                  await native('set_api_key', { providerId: id, apiKey: key })
                  setKey('')
                  setStatus(await native<KeyStatus[]>('list_api_key_status'))
                  await saveProvider(configs, id, system)
                  return '密钥已保存'
                })
              }
            >
              保存密钥
            </button>
            <button
              className="secondary"
              disabled={!saved?.configured}
              onClick={() =>
                void act(async () => {
                  await native('delete_api_key', { providerId: id })
                  setStatus(await native<KeyStatus[]>('list_api_key_status'))
                  window.dispatchEvent(new Event('gws-provider-changed'))
                  return '密钥已清除'
                })
              }
            >
              清除密钥
            </button>
            <button
              className="secondary"
              onClick={() =>
                void act(async () => {
                  const r = await native<{
                    ok: boolean
                    latencyMs: number
                    message: string
                  }>('test_ai_connection', { config })
                  return r.message + ' · ' + r.latencyMs + ' ms'
                })
              }
            >
              测试连接
            </button>
          </div>
          <label>
            全局 AI 系统提示词
            <textarea
              rows={4}
              value={system}
              onChange={(e) => setSystem(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => setSystem(defaultSystem)}
            >
              恢复默认
            </button>
            <button
              className="primary"
              onClick={() =>
                void act(async () => {
                  await saveProvider(configs, id, system)
                  return '已保存 AI 配置'
                })
              }
            >
              保存配置
            </button>
          </div>
        </fieldset>
      )}
      {(busy || feedback) && (
        <p role="status">{busy ? '正在处理…' : feedback}</p>
      )}
    </div>
  )
}
