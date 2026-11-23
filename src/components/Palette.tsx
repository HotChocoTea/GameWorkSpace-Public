import { useEffect, useRef, useState } from 'react'
import {
  Search,
  Plus,
  CornerDownLeft,
  ArrowDownUp,
  FileText,
} from 'lucide-react'
import { api } from '../api/client'
import { moduleFor } from '../state/catalog'
import { Modal, Empty } from './ui'
import type { Project, SearchResult } from '../types'

interface Hit extends SearchResult {
  projectId: string
}
export function Palette({
  projects,
  current,
  revision,
  open,
  create,
  onClose,
}: {
  projects: Project[]
  current?: Project
  revision: number
  open: (r: Hit) => void
  create: (type: string, title: string) => Promise<void>
  onClose: () => void
}) {
  const [q, setQ] = useState(''),
    [rows, setRows] = useState<Hit[]>([]),
    [idx, setIdx] = useState(0),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const input = useRef<HTMLInputElement>(null),
    box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    let alive = true
    const term = q.trim()
    setIdx(0)
    setRows([])
    setError('')
    setPending(!!term)
    const timer = setTimeout(async () => {
      try {
        if (term) {
          const scope = current ? [current] : projects
          const found = await Promise.all(
            scope.map(async (p) =>
              (await api.search(p.id, term)).map((r) => ({
                ...r,
                projectId: p.id,
              })),
            ),
          )
          if (alive) setRows(found.flat().slice(0, 60))
        }
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setPending(false)
      }
    }, 90)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, current, projects, revision])
  const actions = current
    ? [
        ['task', '任务'],
        ['doc', '文档'],
      ]
    : [['project', '项目']]
  const options = [
    ...rows.map((r) => ({
      id: r.id,
      title: r.title,
      label: [
        moduleFor(r.entityType)?.label,
        projects.find((p) => p.id === r.projectId)?.name,
      ]
        .filter(Boolean)
        .join(' · '),
      icon: moduleFor(r.entityType)?.icon ?? FileText,
      run: () => open(r),
    })),
    ...actions.map(([kind, name]) => ({
      id: kind,
      title: '新建' + name + (q.trim() ? '「' + q.trim() + '」' : ''),
      label: '快速创建',
      icon: Plus,
      run: () => create(kind, q.trim()),
    })),
  ]
  const run = async (i: number) => {
    try {
      await options[i]?.run()
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => {
    box.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [idx])
  return (
    <Modal title="全局搜索" onClose={onClose} className="palette">
      <div className="palette-input">
        <Search size={21} />
        <input
          ref={input}
          value={q}
          placeholder={current ? '搜索项目中的条目…' : '搜索所有项目中的条目…'}
          role="combobox"
          aria-label="搜索关键词"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={'result-' + idx}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx(
                (idx + (e.key === 'ArrowDown' ? 1 : -1) + options.length) %
                  options.length,
              )
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              void run(idx)
            }
          }}
        />
      </div>
      <div
        className="palette-list"
        ref={box}
        id="palette-results"
        role="listbox"
      >
        {pending && <Empty>正在搜索…</Empty>}
        {q && !pending && !rows.length && <Empty>没有找到匹配的条目</Empty>}
        {options.map((o, i) => (
          <button
            role="option"
            id={'result-' + i}
            aria-selected={idx === i}
            className={idx === i ? 'highlight' : ''}
            key={o.id}
            onMouseEnter={() => setIdx(i)}
            onClick={() => void run(i)}
          >
            <o.icon size={17} />
            <span>
              {o.title}
              <small>{o.label}</small>
            </span>
            <CornerDownLeft size={13} />
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer className="palette-foot">
        <ArrowDownUp size={13} />
        选择
        <CornerDownLeft size={13} />
        打开 <kbd>Esc</kbd>关闭
      </footer>
    </Modal>
  )
}
