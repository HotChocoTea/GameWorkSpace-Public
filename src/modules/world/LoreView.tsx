import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { EntityLinkPanel } from '../../components/EntityLinkPanel'
import { Empty } from '../../components/ui'
import { ImpactButton } from '../../components/ImpactModal'
import { useWorkspace } from '../../state/workspace'
import { withData } from '../../state/planning'
import type { Entity } from '../../types'
import {
  Add,
  DataField,
  EntryField,
  Filter,
  Heading,
  Pairs,
  Photo,
  Reference,
  SaveStatus,
  SearchField,
  Select,
  TrashEntry,
} from './WorldUI'
import { WorldPreview } from './WorldMarkdown'
import {
  matches,
  numeric,
  record,
  scalar,
  secrecy,
  tiers,
  useEditor,
  useWorld,
  value,
  yearLabel,
} from './worldUtils'

const categories = [
  '历史',
  '势力',
  '世界规则',
  '地理',
  '魔法与科技',
  '宗教与神话',
  '生物',
  '文化风俗',
  '物品传说',
  '人物逸事',
  '时间线',
  '其他',
]
const tabs = ['词条', '编年史', '揭示']
function LoreEntry({ entity }: { entity: Entity }) {
  const ed = useEditor(entity),
    { entities, openEntity } = useWorkspace()
  const incoming = entities.filter(
    (e) =>
      e.id !== entity.id &&
      ['lore', 'doc'].includes(e.entityType) &&
      [...e.body.matchAll(/\[\[([^[\]\n]+)\]\]/g)].some(
        (m) => m[1].trim() === ed.e.title.trim(),
      ),
  )
  const meta = Object.entries(record(ed.e.data?.meta)).map(([label, v], i) => ({
    id: 'meta-' + i,
    label,
    value: scalar(v),
  }))
  return (
    <section
      className="world-page stack"
      ref={ed.panel}
      tabIndex={-1}
      aria-label="词条编辑器"
    >
      <div className="split">
        <Photo editor={ed} name="coverAsset" label="词条封面" />
        <ImpactButton id={ed.e.id} />
        <SaveStatus editor={ed} />
        <TrashEntry editor={ed} />
      </div>
      <div className="world-title-fields">
        <DataField editor={ed} name="icon" label="图标" fallback="📜" />
        <EntryField editor={ed} name="title" label="词条名" />
      </div>
      <EntryField editor={ed} name="summary" label="一句话简介" />
      <div className="fields-two">
        <DataField
          editor={ed}
          name="category"
          label="分类"
          options={categories}
          fallback="其他"
        />
        <DataField
          editor={ed}
          name="secrecy"
          label="保密程度"
          options={tiers}
          fallback={secrecy(ed.e)}
        />
        <DataField editor={ed} name="era" label="时代" />
        <DataField editor={ed} name="year" label="年份" type="number" />
      </div>
      <Reference
        editor={ed}
        name="revealQuestId"
        label="揭示任务"
        type="quest"
      />
      <Pairs editor={ed} name="meta" label="自定义资料" defaults={meta} />
      <EntryField editor={ed} name="body" label="词条正文" />
      <WorldPreview body={ed.e.body} />
      <section className="world-secret">
        <h3>
          <LockKeyhole size={15} /> 幕后真相 · 仅开发者可见
        </h3>
        <DataField
          editor={ed}
          name="secretTruth"
          label="开发者笔记"
          multiline
        />
      </section>
      <section className="stack">
        <h3>提到这个词条的地方</h3>
        <div className="world-chips">
          {incoming.map((e) => (
            <button className="chip" key={e.id} onClick={() => openEntity(e)}>
              {e.title}
            </button>
          ))}
          {!incoming.length && <small>暂无 Wiki 反链</small>}
        </div>
      </section>
      <EntityLinkPanel entity={ed.e} />
    </section>
  )
}
export default function LoreView() {
  const w = useWorld('lore', tabs[0]),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [tier, setTier] = useState(''),
    [era, setEra] = useState('')
  const filtered = w.rows.filter(
    (e) =>
      matches(e, query) &&
      (!category || value(e, 'category', '其他') === category) &&
      (!tier || secrecy(e) === tier),
  )
  const current = w.selected ?? filtered[0]
  const dated = w.rows
    .flatMap((e) => {
      const year = numeric(e.data?.year)
      return year === undefined ? [] : [{ e, year }]
    })
    .sort((a, b) => a.year - b.year)
  const eras = [
    ...new Set(dated.map(({ e }) => value(e, 'era', '未分期') || '未分期')),
  ]
  const quests = new Set(
    w.entities.filter((e) => e.entityType === 'quest').map((e) => e.id),
  )
  function revealed(e: Entity) {
    return (
      quests.has(value(e, 'revealQuestId')) ||
      w.links.some(
        (l) =>
          (l.sourceId === e.id && quests.has(l.targetId)) ||
          (l.targetId === e.id && quests.has(l.sourceId)),
      )
    )
  }
  function move(e: Entity, next: string) {
    if (tiers.includes(next) && secrecy(e) !== next)
      void w.run(() => w.save(withData(e, 'secrecy', next)))
  }
  return (
    <div className="world">
      <Heading title="设定集" tabs={tabs} active={w.tab} choose={w.switchTab}>
        <button
          className="secondary"
          onClick={() =>
            w.assistant('检查当前设定和项目资料之间的矛盾。', current?.id)
          }
        >
          AI 检查矛盾
        </button>
        <Add
          label="新建词条"
          click={() => {
            setQuery('')
            setTier('')
            setCategory('')
            void w.create('新词条', { category: '其他', secrecy: '未设定' })
          }}
        />
      </Heading>
      {w.tab === '词条' && (
        <div className="world-columns">
          <aside className="world-sidebar stack">
            <SearchField query={query} set={setQuery} label="搜索词条" />
            <Filter
              label="分类"
              options={categories}
              current={category}
              change={setCategory}
            />
            <Filter
              label="保密程度"
              options={tiers}
              current={tier}
              change={setTier}
            />
            {filtered.map((e) => (
              <button
                key={e.id}
                className={
                  'world-entry ' + (current?.id === e.id ? 'active' : '')
                }
                onClick={() => w.open(e)}
              >
                <strong>
                  {value(e, 'icon', '📜')} {e.title}
                </strong>
                <small>
                  {value(e, 'category', '其他')} · {secrecy(e)}{' '}
                  {e.body.trim().length < 40 && <b className="badge">待补</b>}
                </small>
              </button>
            ))}
            {!filtered.length && <Empty>暂无匹配词条</Empty>}
          </aside>
          {current ? (
            <LoreEntry key={current.id} entity={current} />
          ) : (
            <Empty>选择或新建词条</Empty>
          )}
        </div>
      )}
      {w.tab === '编年史' && (
        <>
          <div className="world-filters">
            {['', ...eras].map((s) => (
              <button
                key={s}
                className={'chip ' + (s === era ? 'active' : '')}
                onClick={() => setEra(s)}
              >
                {s || '全部时代'}
              </button>
            ))}
          </div>
          <div className="world-timeline">
            {dated
              .filter(({ e }) => !era || (value(e, 'era') || '未分期') === era)
              .map(({ e, year }) => (
                <button key={e.id} onClick={() => w.open(e)}>
                  <small>
                    {yearLabel(year)} · {value(e, 'era') || '未分期'}
                  </small>
                  <strong>{e.title}</strong>
                  <span>{e.summary}</span>
                </button>
              ))}
          </div>
          {!dated.length && <Empty>为词条填写年份后即可加入编年史</Empty>}
        </>
      )}
      {w.tab === '揭示' && (
        <div className="world-board">
          {tiers.map((t) => (
            <section
              key={t}
              className="world-lane"
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => {
                ev.preventDefault()
                const item = w.rows.find(
                  (e) => e.id === ev.dataTransfer.getData('text/plain'),
                )
                if (item) move(item, t)
              }}
            >
              <h2>
                {t}{' '}
                <small>{w.rows.filter((e) => secrecy(e) === t).length}</small>
              </h2>
              {w.rows
                .filter((e) => secrecy(e) === t)
                .map((e) => (
                  <article
                    key={e.id}
                    draggable
                    onDragStart={(ev) =>
                      ev.dataTransfer.setData('text/plain', e.id)
                    }
                  >
                    <button className="card-title" onClick={() => w.open(e)}>
                      {e.title}
                    </button>
                    <small>{e.summary}</small>
                    {(t === tiers[1] || t === tiers[2]) && !revealed(e) && (
                      <span className="world-warn">尚未在任务线中揭示</span>
                    )}
                    <Select
                      label={'移动' + e.title}
                      options={tiers}
                      current={t}
                      change={(s) => move(e, s)}
                    />
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
