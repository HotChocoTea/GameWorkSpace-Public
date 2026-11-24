import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
} from 'react'
import { moduleFor } from '../state/catalog'
import { useWorkspace } from '../state/workspace'
import type { Entity } from '../types'

type Props = Omit<ComponentPropsWithRef<'textarea'>, 'onChange' | 'value'> & {
  value: string
  onValue: (value: string) => void
}

export function MentionEditor({
  value,
  onValue,
  onKeyDown,
  ref,
  ...props
}: Props) {
  const { entities } = useWorkspace()
  const local = useRef<HTMLTextAreaElement | null>(null),
    popup = useRef<HTMLDivElement>(null)
  const [match, setMatch] = useState<{
    start: number
    end: number
    query: string
  } | null>(null)
  const [active, select] = useState(0),
    id = useId()
  const choices = match
    ? entities
        .filter(
          (e) =>
            !e.deletedAt &&
            e.title
              .toLocaleLowerCase()
              .includes(match.query.toLocaleLowerCase()),
        )
        .slice(0, 9)
    : []
  function detect(el: HTMLTextAreaElement) {
    const end = el.selectionStart,
      token = /(?:@|\[\[)([^\n@\[\]]{0,80})$/u.exec(el.value.slice(0, end))
    setMatch(
      token && el.selectionEnd === end
        ? { start: token.index, end, query: token[1] }
        : null,
    )
    select(0)
  }
  function pick(e: Entity) {
    if (!match) return
    const token = '[[' + e.title + ']]'
    const end = match.start + token.length
    onValue(value.slice(0, match.start) + token + value.slice(match.end))
    setMatch(null)
    requestAnimationFrame(() => {
      local.current?.focus()
      local.current?.setSelectionRange(end, end)
    })
  }
  useLayoutEffect(() => {
    const menu = popup.current,
      el = local.current
    if (!menu || !el || !choices.length) return
    menu.showPopover()
    function position() {
      if (!el || !menu) return
      const rect = el.getBoundingClientRect(),
        height = menu.offsetHeight
      menu.style.left =
        Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8)) +
        'px'
      menu.style.top =
        Math.max(
          8,
          Math.min(
            innerHeight - height - 8,
            rect.bottom + height + 4 <= innerHeight
              ? rect.bottom + 4
              : rect.top - height - 4,
          ),
        ) + 'px'
    }
    position()
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      menu.hidePopover()
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [match, choices.length])
  return (
    <>
      <textarea
        {...props}
        value={value}
        ref={(el) => {
          local.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        aria-autocomplete="list"
        aria-controls={choices.length ? id : undefined}
        aria-activedescendant={choices.length ? id + '-' + active : undefined}
        onChange={(ev) => {
          onValue(ev.currentTarget.value)
          detect(ev.currentTarget)
        }}
        onClick={(ev) => detect(ev.currentTarget)}
        onBlur={(ev) => {
          setMatch(null)
          props.onBlur?.(ev)
        }}
        onKeyDown={(ev) => {
          if (
            choices.length &&
            !ev.nativeEvent.isComposing &&
            ['ArrowDown', 'ArrowUp', 'Escape', 'Enter'].includes(ev.key)
          ) {
            ev.preventDefault()
            ev.stopPropagation()
            if (ev.key === 'Escape') setMatch(null)
            else if (ev.key === 'Enter') pick(choices[active] ?? choices[0])
            else
              select(
                (i) =>
                  (i + (ev.key === 'ArrowDown' ? 1 : -1) + choices.length) %
                  choices.length,
              )
          } else {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key))
              setMatch(null)
            onKeyDown?.(ev)
          }
        }}
      />
      {!!choices.length && (
        <div
          ref={popup}
          popover="manual"
          className="mention-menu"
          role="listbox"
          id={id}
          aria-label="关联条目"
        >
          {choices.map((e, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              id={id + '-' + i}
              key={e.id}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => pick(e)}
            >
              <span
                className="mention-type"
                data-tone={
                  (e.entityType.charCodeAt(0) + e.entityType.length) % 4
                }
              >
                {moduleFor(e.entityType)?.label ?? e.entityType}
              </span>
              {e.title}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
