import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { native } from '../../api/ai'
import { api } from '../../api/client'

type Entry = {
  seq: number
  createdAt: string
  entityType: string
  entityId: string
  action: string
}
type Status = {
  binaryPath: string
  binaryExists: boolean
  dataDir: string
  dbPath: string
  httpRunning: boolean
  httpPort: number
  httpUrl: string | null
  recentChanges: Entry[]
  directory: {
    tools: { name: string; description: string }[]
    resources: { uri?: string; uriTemplate?: string; name: string }[]
  }
}
type Check = {
  ok: boolean
  latencyMs: number
  toolCount: number
  resourceCount: number
  projectCount: number
  message: string
}
const clients = [
  'Codex CLI',
  'Claude Code / Desktop',
  'Cursor',
  'Antigravity',
] as const
const locations = [
  '~/.codex/config.toml',
  '.mcp.json · claude_desktop_config.json',
  '.cursor/mcp.json',
  'mcp_config.json',
]

export default function McpSettings() {
  const [status, setStatus] = useState<Status>()
  const [port, setPort] = useState('47890')
  const [client, setClient] = useState(0)
  const [check, setCheck] = useState<Check>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const revision = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++revision.current
    try {
      const result = await native<Status>('get_mcp_status')
      if (version === revision.current) {
        setStatus(result)
        if (result.httpRunning) setPort(String(result.httpPort))
      }
    } catch (e) {
      if (version === revision.current) setError(String(e))
    }
  }, [])
  useEffect(() => {
    let live = true
    let stop: (() => void) | undefined
    void api
      .subscribe((event) => {
        if (live && event?.externalMcpCount) void refresh()
      })
      .then((off) => {
        if (live) stop = off
        else off()
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
    void refresh()
    return () => {
      live = false
      revision.current++
      stop?.()
    }
  }, [refresh])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await action()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value)
    setFeedback(label + '已复制')
  }
  const config = status && {
    command: status.binaryPath,
    args: ['--stdio', '--data-dir', status.dataDir],
  }
  const snippet = !config
    ? ''
    : client === 0
      ? [
          '[mcp_servers.gameworkspace]',
          'command = ' + JSON.stringify(config.command),
          'args = ' + JSON.stringify(config.args),
        ].join('\n')
      : JSON.stringify({ mcpServers: { gameworkspace: config } }, null, 2)
  return (
    <div className="mcp-settings">
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      {!status ? (
        <button className="secondary" onClick={() => void refresh()}>
          读取本地服务状态
        </button>
      ) : (
        <>
          <fieldset>
            <legend>本机服务</legend>
            <dl>
              <dt>
                MCP 可执行文件 · {status.binaryExists ? '已找到' : '未找到'}
              </dt>
              <dd>
                <code>{status.binaryPath}</code>
              </dd>
              <dt>SQLite · WAL</dt>
              <dd>
                <code>{status.dbPath}</code>
              </dd>
            </dl>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setCheck(await native<Check>('test_mcp_self_check')),
                )
              }
            >
              自检 MCP 服务
            </button>
            {check && (
              <p role="status">
                {check.message} · {check.latencyMs.toFixed(2)} ms ·{' '}
                {check.toolCount} 个工具 · {check.resourceCount} 个资源 ·{' '}
                {check.projectCount} 个项目
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend>本地 HTTP 服务</legend>
            <div className="actions wrap">
              <label>
                端口{' '}
                <input
                  type="number"
                  aria-label="HTTP 端口"
                  min="1"
                  max="65535"
                  value={port}
                  disabled={status.httpRunning || busy}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
              <button
                role="switch"
                aria-checked={status.httpRunning}
                aria-label="本地 HTTP 服务"
                className="secondary"
                disabled={
                  busy ||
                  (!status.httpRunning &&
                    (!Number.isInteger(+port) || +port < 1 || +port > 65535))
                }
                onClick={() =>
                  void run(async () => {
                    if (status.httpRunning) await native('stop_mcp_http')
                    else await native('start_mcp_http', { port: +port })
                    await refresh()
                  })
                }
              >
                {status.httpRunning ? '停止服务' : '启动服务'}
              </button>
            </div>
            {status.httpUrl && (
              <p>
                <code>{status.httpUrl}</code>{' '}
                <button
                  className="secondary"
                  onClick={() =>
                    void run(() => copy(status.httpUrl!, 'HTTP 地址'))
                  }
                >
                  <Copy size={14} />
                  复制地址
                </button>
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend>客户端配置 · stdio</legend>
            <div className="choice-list" aria-label="MCP 客户端">
              {clients.map((c, i) => (
                <button
                  key={c}
                  aria-pressed={client === i}
                  className={client === i ? 'selected' : ''}
                  onClick={() => {
                    setClient(i)
                    setFeedback('')
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <p>
              <code>{locations[client]}</code>
            </p>
            <pre>{snippet}</pre>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(() => copy(snippet, '配置'))}
            >
              <Copy size={14} />
              复制配置
            </button>
          </fieldset>
          <details>
            <summary>
              工具与资源目录 · {status.directory.tools.length} 个工具 /{' '}
              {status.directory.resources.length} 类资源
            </summary>
            <dl>
              {status.directory.resources.map((r) => (
                <div key={r.name}>
                  <dt>
                    <code>{r.uri ?? r.uriTemplate}</code>
                  </dt>
                  <dd>{r.name}</dd>
                </div>
              ))}
              {status.directory.tools.map((t) => (
                <div key={t.name}>
                  <dt>
                    <code>{t.name}</code>
                  </dt>
                  <dd>{t.description}</dd>
                </div>
              ))}
            </dl>
          </details>
          <fieldset>
            <legend>MCP 审计日志</legend>
            <button className="secondary" onClick={() => void refresh()}>
              <RefreshCw size={14} />
              刷新日志
            </button>
            {status.recentChanges.length ? (
              <div className="mcp-audit">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作</th>
                      <th>对象</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recentChanges.map((e) => (
                      <tr key={e.seq}>
                        <td>{new Date(e.createdAt).toLocaleString('zh-CN')}</td>
                        <td>{e.action}</td>
                        <td>{e.entityType}</td>
                        <td>
                          <code>{e.entityId}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>暂无 MCP 写入记录</p>
            )}
          </fieldset>
        </>
      )}
    </div>
  )
}
