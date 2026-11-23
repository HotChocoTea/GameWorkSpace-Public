import type { ReactNode } from 'react'
import { api } from '../api/client'

type WikiRenderer = (title: string, key: number) => ReactNode
function inline(source: string, wiki?: WikiRenderer): ReactNode[] {
  const pattern =
    /(!?\[([^\]]*)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[\[([^\[\]\n]+)\]\])/g
  const result: ReactNode[] = []
  let last = 0
  for (const match of source.matchAll(pattern)) {
    const at = match.index!
    result.push(source.slice(last, at))
    const [, token, alt, url, bold, underBold, italic, underItalic, code] =
      match
    if (match[9]) {
      result.push(wiki ? wiki(match[9].trim(), at) : token)
    } else if (url) {
      let href = ''
      try {
        const parsed = new URL(url, document.baseURI)
        if (['https:', 'http:'].includes(parsed.protocol)) href = parsed.href
        if (
          token.startsWith('!') &&
          /^asset:[a-f0-9]{64}\.(png|jpg|webp|gif|avif|bmp)$/.test(url)
        )
          href = api.assetUrl(url.slice(6))
      } catch {
        /* Preserve the label for unsupported URLs. */
      }
      result.push(
        !href ? (
          alt
        ) : token.startsWith('!') ? (
          <img key={at} src={href} loading="lazy" alt={alt} />
        ) : (
          <a key={at} href={href} target="_blank" rel="noreferrer">
            {alt}
          </a>
        ),
      )
    } else if (code) result.push(<code key={at}>{code}</code>)
    else if (bold || underBold)
      result.push(<strong key={at}>{inline(bold || underBold, wiki)}</strong>)
    else result.push(<em key={at}>{inline(italic || underItalic, wiki)}</em>)
    last = at + token.length
  }
  return [...result, source.slice(last)]
}
export function Markdown({
  body,
  wiki,
  toggleTask,
}: {
  body: string
  wiki?: WikiRenderer
  toggleTask?: (line: number) => void
}) {
  const lines = body.replace(/\r\n/g, '\n').split('\n'),
    nodes: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      key = i
    if (!line.trim()) continue
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      while (++i < lines.length && !/^\s*```/.test(lines[i]))
        code.push(lines[i])
      nodes.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[
        heading[1].length - 1
      ]
      nodes.push(<Tag key={key}>{inline(heading[2], wiki)}</Tag>)
      continue
    }
    if (/^>\s?/.test(line)) {
      nodes.push(
        <blockquote key={key}>
          {inline(line.replace(/^>\s?/, ''), wiki)}
        </blockquote>,
      )
      continue
    }
    if (/^(?:[-*+] |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line),
        rx = ordered ? /^\d+\. / : /^[-*+] /,
        items: ReactNode[] = []
      do {
        const value = lines[i].replace(rx, ''),
          check = /^\[([ xX])\] (.*)/.exec(value)
        const lineIndex = i
        items.push(
          <li key={i}>
            {check ? (
              <>
                <input
                  type="checkbox"
                  aria-label={check[2]}
                  checked={check[1] !== ' '}
                  disabled={!toggleTask}
                  onChange={() => toggleTask?.(lineIndex)}
                />{' '}
                {inline(check[2], wiki)}
              </>
            ) : (
              inline(value, wiki)
            )}
          </li>,
        )
        i++
      } while (i < lines.length && rx.test(lines[i]))
      i--
      nodes.push(
        ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>,
      )
      continue
    }
    nodes.push(<p key={key}>{inline(line, wiki)}</p>)
  }
  return <article className="markdown">{nodes}</article>
}
