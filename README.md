# GameWorkSpace

本地优先的 Windows 游戏开发工作台。双击 `target/release/gameworkspace.exe` 即可启动，需要 Microsoft Edge WebView2 Runtime。发布程序已内嵌前端。首次打开空工作区时会创建「光域守护」示例项目。将 `gameworkspace-mcp.exe` 放在桌面程序同一目录，设置页即可找到它。

## 工作区

| 工作区 | 模块 |
| --- | --- |
| 总览 | 概览与数据统计 |
| 规划 | 任务看板、路线图与里程碑、日历、工时 |
| 世界 | 文档、设定集、概念图、角色、地点、阵营、载具、物品与合成树、收集品 |
| 叙事 | 任务线与流程走查、场景对白、关系网、地图设计 |
| 质检 | Bug 追踪、开发日志 |

可在项目的功能管理中启用上述 20 个模块。`Ctrl+K` 全局检索，`F2` 打开 AI 助手。删除的条目在回收站保留 14 天。项目支持 Markdown 设计文档、Agent ZIP 包与含资源的 `.gws.json` 备份。

## AI 助手和自带密钥（BYOK）

打开 **设置 → AI API Key**，选择服务商和模型。如使用兼容接口，填写服务地址。输入密钥并点击「保存密钥」，再点「测试连接」。密钥由当前 Windows 用户的 DPAPI 加密，单独保存于数据目录的 `secrets.bin`。MCP 资源、审计和项目导出只使用项目数据。AI 助手支持逐项审核、批量审核及对已应用提议的回滚。

## 连接 MCP

在 **设置 → MCP 配置** 点击「自检 MCP 服务」，可查看握手耗时、工具数和当前可读资源数。选择客户端，复制 stdio 配置并合入现有配置文件。片段会填入两条本机绝对路径。保存后在客户端重新加载 MCP 服务，用 `list_projects` 验证连接。

| 客户端 | stdio 配置位置 | 使用已启动的本地 HTTP 服务 |
| --- | --- | --- |
| Codex CLI | `~/.codex/config.toml` 中的 `[mcp_servers.gameworkspace]` | `codex mcp add gameworkspace --url http://127.0.0.1:47890/mcp` |
| Claude Code / Desktop | Code 项目的 `.mcp.json` 或 Desktop 的 `%APPDATA%\Claude\claude_desktop_config.json`，合入 `mcpServers` | Claude Code 执行 `claude mcp add --transport http gameworkspace http://127.0.0.1:47890/mcp`。Desktop 本机接入使用左列配置 |
| Cursor | 项目的 `.cursor/mcp.json` 中的 `mcpServers` | 服务条目填入 `{"url":"http://127.0.0.1:47890/mcp"}` |
| Antigravity | 在 MCP Servers → Manage MCP Servers → View raw config 打开 `mcp_config.json` | 服务条目填入 `{"serverUrl":"http://127.0.0.1:47890/mcp"}` |

stdio 客户端启动独立进程，桌面关闭时仍可读写。HTTP 可由设置页启动或停止，默认端口为 47890，关闭桌面也会关闭内嵌服务。也可在 PowerShell 中独立启动并用 `Ctrl+C` 停止：

```powershell
.\target\release\gameworkspace-mcp.exe --http 127.0.0.1:47890
```

需要认证时追加 `--token <TOKEN>`，客户端随请求发送 `Authorization: Bearer <TOKEN>`。健康检查位于 `GET /health`，JSON-RPC 入口为 `POST /mcp`。默认只绑定 `127.0.0.1`。协议支持 `2024-11-05` 与 `2025-03-26`。[MCP 传输规范](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)

桌面与 MCP 共享 SQLite WAL 数据库 `mino.db`。MCP 的显式 `--data-dir` 优先，其次两个程序依次检查 `GAMEWORKSPACE_DATA_DIR`、`MINO_STUDIO_DATA_DIR`。默认目录为 `%APPDATA%\com.gameworkspace.app`。若只有旧目录 `%APPDATA%\studio.mino.desktop` 含数据库，两者均使用旧库。运行中的桌面每 300 毫秒检查变更序号，刷新当前工作区并在 MCP 配置页显示最近 50 条 MCP 写入。

### Agent 工作流

先读 `gws://projects`，再用项目 ID 读取 `gws://project/{projectId}/overview`、`schema` 或 `export/markdown`。23 个工具覆盖条目检索与编辑、双向关联、任务流程校验、地图、配方、工时及导出。设置页展示与服务端一致的完整目录。批量改动默认预览，可用以下参数调用 `batch_apply_changes`：

```json
{
  "projectId": "lightward",
  "mode": "dry_run",
  "operations": [
    {"operation": "create_entity", "entityType": "doc", "title": "灯塔关卡评审"}
  ]
}
```

`dry_run` 返回每项的前后快照，`review` 把提议送到项目 AI 面板，`apply` 在同一事务内写入改动和回滚快照。导出工具 `export_agent_bundle` 可直接返回 Markdown，指定 `outputPath` 可写出 `.md`、`.zip` 或 `.gws.json`。

## 从源码构建

在 Windows 上安装 Node.js、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 WebView2 Runtime。在仓库根目录执行：

```powershell
npm ci
npm run build
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release --workspace --features mino-studio/custom-protocol
```

开发模式使用 `npm run tauri dev`。发布构建产出 `target/release/gameworkspace.exe` 和 `target/release/gameworkspace-mcp.exe`。端到端测试使用临时数据库，覆盖真实 stdio 子进程、HTTP、200 次 WAL 并发写入与读取，以及一万个条目的 FTS5 和中文短词检索。
