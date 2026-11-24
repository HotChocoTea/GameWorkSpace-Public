# GameWorkSpace v2.1.0

本地优先的 Windows 游戏开发工作台。双击 `target/release/gameworkspace.exe` 即可启动，需要 Microsoft Edge WebView2 Runtime。发布程序已内嵌前端。首次打开空工作区时会创建「光域守护」示例项目。将 `gameworkspace-mcp.exe` 放在桌面程序同一目录，设置页即可找到它。

## 工作区

工作台按项目展示封面、进度和里程碑。项目内使用可收起的左侧栏导航，`F2` 可在侧栏旁展开 AI 助手。外观默认「暖纸」，也可选「液态玻璃」「深海」「墨白」。过渡动画跟随系统的减少动态效果设置。

| 工作区 | 模块 |
| --- | --- |
| 总览 | 概览与数据统计 |
| 规划与制作 | 任务看板、路线图与里程碑、日历、工时、资产管线 |
| 文档与世界 | 文档、设定集、概念图、角色、地点、阵营、载具、物品与合成树、收集品、数值平衡、本地化 |
| 剧情与地图 | 任务线与流程走查、场景对白、关系网、地图设计 |
| 测试与记录 | Bug 追踪、开发日志 |

可在项目的功能管理中启用上述 23 个模块。`Ctrl+K` 全局检索，`F2` 打开 AI 助手。删除的条目在回收站保留 14 天。项目支持 Markdown 设计文档、Agent ZIP 包与含资源的 `.gws.json` 备份。

## v2.1.0 制作工具

- **地图设计**可在多个图层上绘制地形、放置图标和图钉。通过 Windows 原生保存对话框，可将整张地图导出为原始分辨率的高清 PNG、保留图层与图钉的结构化 JSON，或供 Tiled 打开的 `.tmj` 地图及配套 `.bmp` 图集。
- **资产管线**按阶段管理美术和音频，支持角色、地点等条目关联、音频播放与拖动定位。概览可直接查看待替换的灰盒资源。
- **数值平衡**用公式和命名变量绘制多条成长曲线，逐级覆盖数值并导出 CSV 或 JSON。掉落模拟按权重与数量区间抽样，支持固定种子复现结果，并比较期望收益与实际产出。
- **场景对白**可为台词与选项设置条件、跳转和变量赋值。播放时可调整变量，用数字键 1–9 选择，按 ← 回到上一步的台词和变量状态。
- **本地化**提取世界条目、场景对白和分支选项，保留已有译文。可逐条编辑、批量翻译缺失项、添加目标语种及导出 CSV / JSON。BYOK 翻译会带上项目题材、角色性格和说话方式。
- **引擎同步**可一键导出到 Unity、Godot、Unreal 或通用 JSON 目标目录，也可在保存后自动同步。导出内容包括 Yarn Spinner 对白、Tiled 地图和本地化表。
- **数据与快照**支持迁移工作区目录。迁移完成后重启桌面和 MCP。自动或手动快照滚动保留最近 7 份，恢复快照会创建项目副本。

## 全模块 AI 助手与实时模型列表（BYOK）

在 **设置 → AI API Key** 的下拉列表选择服务商，或填写兼容接口的服务地址。保存密钥后可测试连接。点击「获取最新模型」会实时请求服务商的 `/models` 接口，将带创建时间的模型从新到旧排列。可从列表选择，也可输入自定义模型 ID。密钥由当前 Windows 用户的 DPAPI 加密，保存在数据目录的 `secrets.bin`。MCP 资源、审计和项目导出只使用项目数据。

按 `F2` 打开助手。默认在发送时锁定当前模块，例如场景对白、物品、地图设计或数值平衡。助手支持 **10 种写操作**，涵盖条目与地图的增删改、关系连线的增删及合成配方的写入与删除。可在结构化预览中逐项或批量审核，应用后点击「去查看」跳转到对应内容，也可回滚提议。日历与工时数据只读。

## 连接 MCP

原生 MCP 服务向 Codex CLI、Claude、Cursor 和 Antigravity 开放 **29 个工具**，支持新建地图、编辑图层格子和图钉。桌面每 300 毫秒检查数据库变更，自动刷新当前工作区。在 **设置 → MCP 配置** 点击「自检 MCP 服务」，可查看握手耗时、工具数和当前可读资源数。选择客户端，复制 stdio 配置并合入现有配置文件。片段会填入两条本机绝对路径。保存后在客户端重新加载 MCP 服务，用 `list_projects` 验证连接。

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

桌面与 MCP 共享 SQLite WAL 数据库 `gameworkspace.db`。两者优先使用 `--data-dir` 指定的目录，其次读取环境变量 `GAMEWORKSPACE_DATA_DIR`。两项均未设置时，使用已保存的迁移目录，默认目录为 `%APPDATA%\com.gameworkspace.app`。MCP 配置页显示最近 50 条 MCP 写入。

### Agent 工作流

先读 `gws://projects`，再用项目 ID 读取 `gws://project/{projectId}/overview`、`schema` 或 `export/markdown`。工具覆盖条目检索与编辑、双向关联、任务流程校验、地图、配方、工时及导出。设置页展示与服务端一致的完整目录。批量改动默认预览，可用以下参数调用 `batch_apply_changes`：

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
cargo build --release --workspace --features gameworkspace/custom-protocol
```

开发模式使用 `npm run tauri dev`。发布构建产出 `target/release/gameworkspace.exe` 和 `target/release/gameworkspace-mcp.exe`。端到端测试使用临时数据库，覆盖真实 stdio 子进程、HTTP、200 次 WAL 并发写入与读取，以及一万个条目的 FTS5 和中文短词检索。

## 参考视频

本项目的制作参考了[这期哔哩哔哩视频](https://www.bilibili.com/video/BV1gHsz6ZE5H)。
