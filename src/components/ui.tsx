import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEventHandler,
} from 'react'
import { X, ChevronRight, Layers3 } from 'lucide-react'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Layers3 size={20} />
      </span>
      {!compact && (
        <span>
          Game<b>WorkSpace</b>
        </span>
      )}
    </div>
  )
}
export function IconButton({
  label,
  children,
  onClick,
  className = '',
}: {
  label: string
  children: ReactNode
  onClick: MouseEventHandler<HTMLButtonElement>
  className?: string
}) {
  return (
    <button
      type="button"
      className={'icon-button ' + className}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = '',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId()
  useEffect(() => {
    const dlg = ref.current
    dlg?.showModal()
    return () => dlg?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={'modal ' + (wide ? 'wide ' : '') + className}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const b = ref.current!.getBoundingClientRect()
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose()
        }
      }}
    >
      <header className="modal-heading">
        <h2 id={id}>{title}</h2>
        <IconButton label="关闭" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
    </dialog>
  )
}
export function Menu({
  label,
  trigger,
  children,
}: {
  label: string
  trigger: ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', click)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="menu-trigger"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && <div className="dropdown">{children(() => setOpen(false))}</div>}
    </div>
  )
}
export function SectionTitle({
  children,
  count,
}: {
  children: ReactNode
  count?: number
}) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
export const Crumb = () => <ChevronRight size={13} className="muted" />
