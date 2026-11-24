import { useRef, useState } from 'react'
import { Image, Music, Play, Pause, Upload } from 'lucide-react'
import { api } from '../../api/client'
import { useWorkspace } from '../../state/workspace'
import { Field } from '../../components/PlanningUI'
import {
  Add,
  DataField,
  Detail,
  EntryField,
  Filter,
  Heading,
  SearchField,
} from '../world/WorldUI'
import {
  matches,
  strings,
  useWorld,
  value,
  type Editor,
} from '../world/worldUtils'
import type { Entity } from '../../types'

const stages = ['未开始', '灰盒占位', '制作中', '已实装', '已打磨']
const categories = [
  '立绘',
  '3D模型',
  '动画',
  '特效',
  'BGM',
  'SFX',
  'UI',
  '其他',
]
const stage = (e: Entity) => value(e, 'stage', e.status || stages[0])
const category = (e: Entity) => value(e, 'category', '其他')
const audio = (e: Entity) => ['BGM', 'SFX'].includes(category(e))
const time = (s: number) =>
  Math.floor(s / 60) + ':' + String(Math.floor(s) % 60).padStart(2, '0')

function AudioPreview({
  filename,
  title,
}: {
  filename: string
  title: string
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, play] = useState(false),
    [position, seek] = useState(0),
    [duration, length] = useState(0),
    [error, report] = useState('')
  return (
    <div
      className="asset-player"
      data-playing={playing}
      onDragStart={(ev) => ev.preventDefault()}
    >
      <audio
        ref={ref}
        src={api.assetUrl(filename)}
        preload="metadata"
        onLoadedMetadata={(e) =>
          length(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : 0,
          )
        }
        onTimeUpdate={(e) => seek(e.currentTarget.currentTime)}
        onPlay={() => play(true)}
        onPause={() => play(false)}
        onEnded={() => play(false)}
        onError={() => report('音频无法解码')}
      />
      <button
        className="icon-button"
        aria-label={(playing ? '暂停' : '播放') + title}
        onClick={() => {
          if (playing) ref.current?.pause()
          else void ref.current?.play().catch((e) => report(String(e)))
        }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <input
        type="range"
        aria-label={title + ' 播放进度'}
        min={0}
        max={duration || 1}
        step={0.01}
        disabled={!duration}
        value={position}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (ref.current) ref.current.currentTime = n
          seek(n)
        }}
      />
      <span className="asset-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <small>{error || time(position) + ' / ' + time(duration)}</small>
    </div>
  )
}
function Preview({ e }: { e: Entity }) {
  const filename = value(e, 'asset')
  if (filename && audio(e) && /\.(mp3|wav|ogg|flac|m4a|webm)$/i.test(filename))
    return <AudioPreview key={filename} filename={filename} title={e.title} />
  if (filename && /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(filename))
    return (
      <img
        className="asset-thumb"
        src={api.assetUrl(filename)}
        loading="lazy"
        alt={e.title}
      />
    )
  return (
    <div className="asset-empty-preview" aria-hidden="true">
      {audio(e) ? <Music size={23} /> : <Image size={23} />}
    </div>
  )
}
function AssetFields({ ed }: { ed: Editor }) {
  const w = useWorkspace(),
    e = ed.e,
    ids = strings(e.data?.linkedEntityIds),
    [busy, setBusy] = useState(false)
  async function upload(file: File) {
    setBusy(true)
    try {
      const stored = await api.saveAsset(file)
      ed.edit({ data: { asset: stored.filename, originalFilename: file.name } })
    } catch (err) {
      w.notify(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <EntryField editor={ed} name="title" label="资源名称" />
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
          name="stage"
          label="制作阶段"
          options={stages}
          fallback={stage(e)}
        />
      </div>
      <Preview e={e} />
      <label className="file-button">
        <Upload size={14} />
        {busy ? '上传中…' : audio(e) ? '上传音频' : '上传预览图'}
        <input
          disabled={busy}
          type="file"
          accept={
            audio(e)
              ? '.mp3,.wav,.ogg,.flac,.m4a,.webm'
              : 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp'
          }
          onChange={(ev) => {
            const f = ev.currentTarget.files?.[0]
            ev.currentTarget.value = ''
            if (f) void upload(f)
          }}
        />
      </label>
      {value(e, 'originalFilename') && (
        <small>{value(e, 'originalFilename')}</small>
      )}
      <DataField editor={ed} name="enginePath" label="引擎资源路径" />
      <div className="fields-two">
        <DataField editor={ed} name="owner" label="负责人" />
        <DataField
          editor={ed}
          name="priority"
          label="优先级"
          options={['低', '中', '高']}
          fallback="中"
        />
      </div>
      <Field label="关联角色、地点、物品、场景或载具">
        <select
          value=""
          onChange={(ev) => {
            if (ev.target.value)
              ed.data('linkedEntityIds', [...ids, ev.target.value])
          }}
        >
          <option value="">添加关联条目…</option>
          {w.entities
            .filter(
              (x) =>
                ['character', 'location', 'item', 'scene', 'vehicle'].includes(
                  x.entityType,
                ) && !ids.includes(x.id),
            )
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
        </select>
      </Field>
      <div className="world-chips">
        {ids.map((id) => {
          const row = w.entities.find((x) => x.id === id)
          return (
            <span className="chip" key={id}>
              <button disabled={!row} onClick={() => row && w.openEntity(row)}>
                {row?.title ?? id}
              </button>
              <button
                aria-label={'移除 ' + (row?.title ?? id)}
                onClick={() =>
                  ed.data(
                    'linkedEntityIds',
                    ids.filter((v) => v !== id),
                  )
                }
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
export default function AssetPipelineView() {
  const w = useWorld('asset_item', '看板'),
    [tab, setTab] = useState('看板'),
    [query, search] = useState(''),
    [kind, setKind] = useState(''),
    [filter, setFilter] = useState(''),
    [over, hover] = useState('')
  const filtered = w.rows.filter(
    (e) =>
      (matches(e, query) ||
        [value(e, 'enginePath'), value(e, 'owner')].some((s) =>
          s.toLowerCase().includes(query.toLowerCase()),
        )) &&
      (!kind || category(e) === kind) &&
      (!filter || stage(e) === filter),
  )
  const counts = (v: string) => w.rows.filter((e) => stage(e) === v).length
  return (
    <div className="world asset-pipeline">
      <Heading
        title="资产管线"
        tabs={['看板', '清单']}
        active={tab}
        choose={setTab}
      >
        <Add
          label="新建资源"
          click={() =>
            void w.create('新资源', {
              category: kind || '其他',
              stage: filter || stages[0],
              priority: '中',
              linkedEntityIds: [],
            })
          }
        />
      </Heading>
      <div className="asset-kpis">
        {[
          ['总资源', w.rows.length],
          ['灰盒占位待替换', counts(stages[1])],
          ['已实装', counts(stages[3])],
          ['已打磨', counts(stages[4])],
        ].map(([k, n]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <div className="world-filters">
        <SearchField
          label="搜索资源、负责人或路径"
          query={query}
          set={search}
        />
        <Filter
          label="分类"
          options={categories}
          current={kind}
          change={setKind}
        />
        <Filter
          label="阶段"
          options={stages}
          current={filter}
          change={setFilter}
        />
      </div>
      {tab === '看板' ? (
        <div className="asset-board">
          {stages.map((s) => (
            <section
              key={s}
              data-over={over === s}
              onDragOver={(ev) => {
                ev.preventDefault()
                hover(s)
              }}
              onDragLeave={() => hover('')}
              onDrop={(ev) => {
                ev.preventDefault()
                hover('')
                const row = w.rows.find(
                  (x) =>
                    x.id === ev.dataTransfer.getData('application/gws-asset'),
                )
                if (row && stage(row) !== s)
                  void w.run(() =>
                    w.save({ ...row, data: { ...row.data, stage: s } }),
                  )
              }}
            >
              <h3>
                {s}
                <small>{filtered.filter((e) => stage(e) === s).length}</small>
              </h3>
              {filtered
                .filter((e) => stage(e) === s)
                .map((e) => (
                  <article
                    className="asset-card"
                    key={e.id}
                    draggable
                    onDragStart={(ev) => {
                      ev.dataTransfer.effectAllowed = 'move'
                      ev.dataTransfer.setData('application/gws-asset', e.id)
                    }}
                    onDragEnd={() => hover('')}
                  >
                    <Preview e={e} />
                    <button
                      className="asset-card-title"
                      onClick={() => w.inspect(e.id)}
                    >
                      {e.title}
                    </button>
                    <small>
                      {[
                        category(e),
                        value(e, 'owner'),
                        value(e, 'priority', '中') + '优先级',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="world-table-wrap">
          <table className="world-table dense">
            <thead>
              <tr>
                {[
                  '名称',
                  '分类',
                  '阶段',
                  '负责人',
                  '优先级',
                  '引擎资源路径',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <th>
                    <button onClick={() => w.inspect(e.id)}>{e.title}</button>
                  </th>
                  {[
                    category(e),
                    stage(e),
                    value(e, 'owner', '—'),
                    value(e, 'priority', '中'),
                    value(e, 'enginePath', '—'),
                  ].map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="empty">暂无匹配资源</p>}
        </div>
      )}
      {w.selected && (
        <Detail key={w.selected.id} entity={w.selected} label="资源详情">
          {(ed) => <AssetFields ed={ed} />}
        </Detail>
      )}
    </div>
  )
}
