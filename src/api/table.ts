export interface ParsedTable {
  headers: string[]
  rows: string[][]
  totalRows: number
}

export function parseCsv(source: string): ParsedTable {
  const records: string[][] = []
  let cells: string[] = [],
    value = '',
    quoted = false
  const finish = () => {
    cells.push(value)
    if (cells.some((cell) => cell.trim())) records.push(cells)
    cells = []
    value = ''
  }
  const text = source.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && ch === ',') {
      cells.push(value)
      value = ''
    } else if (!quoted && (ch === '\r' || ch === '\n')) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      finish()
    } else value += ch
  }
  if (quoted) throw Error('CSV 引号未闭合')
  finish()
  const headers = records.shift()
  if (!headers) throw Error('表格为空')
  return { headers, rows: records, totalRows: records.length }
}
