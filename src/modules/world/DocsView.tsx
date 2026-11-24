import { useEffect, useRef, useState, type RefObject } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import { RecycleBin } from '../../components/Records'
import { Empty, IconButton, Menu } from '../../components/ui'
import { ImpactButton } from '../../components/ImpactModal'
import { useWorkspace } from '../../state/workspace'
import type { Entity } from '../../types'
import {
  DataField,
  EntryField,
  Heading,
  Reference,
  SaveStatus,
  SearchField,
  Tree,
} from './WorldUI'
import { DocumentBody } from './WorldMarkdown'
import { ancestors, parentsFor, useEditor, useWorld, value } from './worldUtils'

const templates: Record<string, string> = {
  '游戏设计文档（GDD）':
    '## 体验目标\n玩家扮演谁？离开游戏后，最想记住哪一刻？\n\n## 核心循环\n- 玩家观察到的信号\n- 决策、行动与反馈\n- 长期目标与新选择\n\n## 关卡与系统\n### 首个可玩切片\n记录入口、挑战、奖励与失败后的返回点。\n\n## 验收标准\n- [ ] 新玩家能独立完成首轮循环\n- [ ] 记录一次可量化的试玩观察',
  一页纸提案:
    '## 电梯陈述\n用一句话描述玩家身份、核心动作和独特体验。\n\n## 为谁而做\n目标玩家与游玩场景是什么？\n\n## 三个设计支柱\n- 操作手感\n- 核心取舍\n- 世界氛围\n\n## 最小演示\n描述三分钟内能看到的开场、转折与回报。\n\n## 立项条件\n- [ ] 确定原型负责人\n- [ ] 约定验证日期',
  范围评估:
    '## 交付边界\n### 必须交付\n- 首个完整可玩循环\n### 可延后\n- 可拆分的扩展内容\n\n## 资源与依赖\n逐项记录负责人、预计人日与前置资源。\n\n## 风险与降级方案\n列出最可能超时的系统，以及可接受的替代设计。\n\n## 冻结条件\n- [ ] 明确内容上限\n- [ ] 团队确认删减顺序',
  试玩提问清单:
    '## 场次记录\n版本、玩家经验、设备与测试时长。\n\n## 观察任务\n- [ ] 记录首次停顿的位置\n- [ ] 记录第一次主动尝试的新动作\n\n## 访谈\n- 你认为刚才的目标是什么？\n- 哪个反馈改变了你的下一步？\n- 哪一刻你想退出？\n\n## 复盘\n区分观察事实与团队解释，写下下一轮验证问题。',
  商店页准备清单:
    '## 商品定位\n一句话简介、类型标签与目标受众。\n\n## 视觉素材\n- [ ] 检查小尺寸封面可读性\n- [ ] 选取呈现真实玩法的截图\n- [ ] 准备带字幕的预告片\n\n## 页面信息\n- [ ] 核对本地化、配置要求与手柄支持\n- [ ] 核对发布日期与支持邮箱\n\n## 上线验收\n在移动端与桌面端检查裁切、文案和购买入口。',
  宣传节奏清单:
    '## 传播目标\n写下受众、行动目标与衡量方式。\n\n## 预热期\n- [ ] 发布核心机制短片\n- [ ] 收集首轮问题\n\n## 试玩窗口\n- [ ] 公布试玩日期和渠道\n- [ ] 准备媒体包与反馈表\n\n## 发售周\n- [ ] 安排版本说明和直播场次\n\n## 复盘\n对照各渠道的访问、愿望单与反馈，安排下一次更新。',
}
type FlushRef = RefObject<(() => Promise<void>) | null>
function importTitle(body: string, filename: string) {
  let fence = ''
  for (const line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (line.trim() === marker && marker.startsWith(fence)) fence = ''
    } else if (!fence) {
      const title = /^ {0,3}#[ \t]+(.+)$/
        .exec(line)?.[1]
        .replace(/[ \t]+#+[ \t]*$/, '')
        .trim()
      if (title) return title
    }
  }
  return filename.replace(/\.(md|txt)$/i, '') || '未命名文档'
}
function Page({
  entity,
  rows,
  flushRef,
}: {
  entity: Entity
  rows: Entity[]
  flushRef: FlushRef
}) {
  const ed = useEditor(entity),
    { openEntity } = useWorkspace()
  useEffect(() => {
    flushRef.current = ed.flush
    return () => {
      flushRef.current = null
    }
  }, [ed.flush, flushRef])
  return (
    <section
      className="world-page stack"
      ref={ed.panel}
      tabIndex={-1}
      aria-label="文档编辑器"
    >
      <nav className="world-crumb">
        根目录
        {ancestors(ed.e, rows).map((p) => (
          <span key={p.id}>
            {' '}
            / <button onClick={() => openEntity(p)}>{p.title}</button>
          </span>
        ))}{' '}
        / {ed.e.title}
      </nav>
      <div className="world-title-fields">
        <DataField editor={ed} name="icon" label="图标" fallback="📄" />
        <EntryField editor={ed} name="title" label="标题" />
      </div>
      <div className="split">
        <Reference
          editor={ed}
          name="parentId"
          label="上级页面"
          rows={parentsFor(ed.e, rows)}
          empty="根目录"
        />
        <div className="world-stamp">
          <ImpactButton id={ed.e.id} />
          <SaveStatus editor={ed} />
          <small>
            更新于 {new Date(entity.updatedAt).toLocaleString('zh-CN')}
          </small>
        </div>
      </div>
      <DocumentBody editor={ed} />
      <details>
        <summary>关联与反链</summary>
        <EntityLinkPanel entity={ed.e} />
      </details>
    </section>
  )
}
export default function DocsView() {
  const w = useWorld('doc', '文档'),
    [query, setQuery] = useState(''),
    [bin, setBin] = useState(false)
  const file = useRef<HTMLInputElement>(null),
    flushRef = useRef<(() => Promise<void>) | null>(null)
  const current = w.selected ?? w.rows[0]
  function create(title: string, body = '', parentId = '') {
    setQuery('')
    void w.create(title, { parentId: parentId || null, icon: '📄' }, body)
  }
  async function importFile(f: File) {
    const body = (await f.text()).replace(/^\uFEFF/, '')
    create(importTitle(body, f.name), body)
  }
  return (
    <div className="world">
      <Heading title="文档">
        <button
          className="secondary"
          onClick={() =>
            w.assistant('为当前设计文档撰写正文草案。', current?.id)
          }
        >
          AI 写作
        </button>
        <button
          className="secondary"
          onClick={() =>
            w.assistant('延续此文档的语气和结构，续写下一节。', current?.id)
          }
        >
          AI 续写
        </button>
        <button className="secondary" onClick={() => w.smartImport('design')}>
          AI 智能导入
        </button>
      </Heading>
      <div className="world-columns">
        <aside className="world-sidebar stack">
          <SearchField query={query} set={setQuery} label="搜索文档" />
          <Menu
            label="新建文档"
            trigger={
              <>
                <Plus size={15} /> 新建文档
              </>
            }
          >
            {(dismiss) => (
              <>
                <button
                  onClick={() => {
                    dismiss()
                    create('未命名文档')
                  }}
                >
                  空白文档
                </button>
                <button
                  onClick={() => {
                    dismiss()
                    file.current?.click()
                  }}
                >
                  导入 Markdown 文件…
                </button>
                {Object.entries(templates).map(([name, body]) => (
                  <button
                    key={name}
                    onClick={() => {
                      dismiss()
                      create(name, '# ' + name + '\n\n' + body)
                    }}
                  >
                    {name}
                  </button>
                ))}
              </>
            )}
          </Menu>
          <input
            ref={file}
            hidden
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            onChange={(ev) => {
              const f = ev.target.files?.[0]
              if (f) void importFile(f).catch((e) => w.notify(String(e)))
              ev.target.value = ''
            }}
          />
          <Tree
            rows={w.rows}
            selected={current?.id}
            query={query}
            render={(e) => (
              <button className="tree-name" onClick={() => w.open(e)}>
                {value(e, 'icon', '📄')} {e.title}
              </button>
            )}
            tools={(e) => (
              <>
                <IconButton
                  label="添加子页面"
                  onClick={() => create('未命名子页面', '', e.id)}
                >
                  <Plus size={13} />
                </IconButton>
                <IconButton
                  label={'删除' + e.title}
                  onClick={() =>
                    void w.run(async () => {
                      if (current?.id === e.id) await flushRef.current?.()
                      await w.trash(e.id)
                      if (w.selected?.id === e.id) w.close()
                    })
                  }
                >
                  <Trash2 size={13} />
                </IconButton>
              </>
            )}
          />
          <button
            className="secondary bin-shortcut"
            onClick={() => setBin(true)}
          >
            <Trash2 size={14} /> 回收站
          </button>
        </aside>
        {current ? (
          <Page
            key={current.id}
            entity={current}
            rows={w.rows}
            flushRef={flushRef}
          />
        ) : (
          <Empty>从空白页或设计模板开始编写文档</Empty>
        )}
      </div>
      {bin && (
        <RecycleBin
          projectId={w.project.id}
          revision={w.revision}
          onClose={() => setBin(false)}
        />
      )}
    </div>
  )
}
