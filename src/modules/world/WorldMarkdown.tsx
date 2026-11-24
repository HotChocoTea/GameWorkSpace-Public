import { MentionEditor } from '../../components/MentionEditor'
import { useRef, useState } from 'react'
import { Markdown } from '../../components/Markdown'
import { newEntity } from '../../state/catalog'
import { useWorkspace } from '../../state/workspace'
import { AssetInput } from './WorldUI'
import type { Editor } from './worldUtils'

export function WorldPreview({
  body,
  toggleTask,
}: {
  body: string
  toggleTask?: (line: number) => void
}) {
  const { entities, openEntity, save, project, run } = useWorkspace()
  const creating = useRef(new Map<string, Promise<void>>())
  return (
    <Markdown
      body={body}
      toggleTask={toggleTask}
      wiki={(title, key) => {
        const target = entities.find((e) => e.title.trim() === title)
        return (
          <button
            key={key}
            className={'wiki-link ' + (target ? '' : 'missing')}
            title={(target ? '打开词条' : '创建词条') + '「' + title + '」'}
            onClick={() => {
              if (target) {
                openEntity(target)
                return
              }
              if (!title || creating.current.has(title)) return
              const created = newEntity(project.id, 'lore', title)
              const op = run(async () => {
                await save(created)
                openEntity(created)
              }).finally(() => creating.current.delete(title))
              creating.current.set(title, op)
            }}
          >
            {target ? title : '＋ ' + title}
          </button>
        )
      }}
    />
  )
}
const tools = [
  ['H2', '## ', '', '小节'],
  ['H3', '### ', '', '小标题'],
  ['粗体', '**', '**', '重点'],
  ['列表', '- ', '', '列表项'],
  ['待办框', '- [ ] ', '', '待办事项'],
  ['引用', '> ', '', '引用内容'],
  ['代码块', '```\n', '\n```', '代码'],
]
export function DocumentBody({ editor }: { editor: Editor }) {
  const [mode, setMode] = useState('分屏'),
    area = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(editor)
  latest.current = editor
  function insert(
    before: string,
    after: string,
    placeholder: string,
    block = false,
  ) {
    const ed = latest.current,
      body = ed.e.body,
      el = area.current
    const start = el?.selectionStart ?? body.length,
      end = el?.selectionEnd ?? start
    const prefix = block && start > 0 && body[start - 1] !== '\n' ? '\n' : ''
    const middle = body.slice(start, end) || placeholder
    ed.edit({
      body:
        body.slice(0, start) +
        prefix +
        before +
        middle +
        after +
        body.slice(end),
    })
    const cursor = start + prefix.length + before.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(cursor, cursor + middle.length)
    })
  }
  function image(name: string) {
    insert('![图片](asset:' + name + ')', '', '', true)
  }
  function toggle(i: number) {
    const lines = editor.e.body.split(/\r?\n/)
    lines[i] = lines[i].replace(
      /^((?:[-*+]|\d+\.) \[)([ xX])\]/,
      (_, prefix: string, check: string) =>
        prefix + (check === ' ' ? 'x' : ' ') + ']',
    )
    editor.edit({ body: lines.join('\n') })
  }
  return (
    <section className="stack">
      <div className="world-bar">
        <div className="segments">
          {['编辑', '分屏', '预览'].map((s) => (
            <button
              key={s}
              className={mode === s ? 'active' : ''}
              onClick={() => setMode(s)}
            >
              {s}
            </button>
          ))}
        </div>
        {mode !== '预览' && (
          <div className="world-format">
            {tools.map(([name, before, after, placeholder]) => (
              <button
                key={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  insert(before, after, placeholder, name !== '粗体')
                }
              >
                {name}
              </button>
            ))}
            <AssetInput label="插入图片" saveFile={image} />
          </div>
        )}
      </div>
      <div className={mode === '分屏' ? 'world-md split-md' : 'world-md'}>
        {mode !== '预览' && (
          <MentionEditor
            aria-label="Markdown 正文"
            ref={area}
            value={editor.e.body}
            onValue={(body) => editor.edit({ body })}
          />
        )}
        {mode !== '编辑' && (
          <WorldPreview body={editor.e.body} toggleTask={toggle} />
        )}
      </div>
    </section>
  )
}
