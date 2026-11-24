import { invoke } from '@tauri-apps/api/core'
import { api, desktop } from './client'
import type { AiMessage, AiProposal, Entity, Json } from '../types'

export interface Provider {
  id: string
  name: string
  protocol: 'anthropic' | 'openai_compat'
  baseUrl: string
  model: string
  models: string[]
  reasoningTier: 'fast' | 'standard' | 'ultra'
  requiresKey: boolean
}
export interface KeyStatus {
  providerId: string
  configured: boolean
  masked?: string
}
export type Attachment =
  | { kind: 'image'; name: string; mime: string; base64: string }
  | { kind: 'text'; name: string; text: string }
export type Candidate = Pick<
  Entity,
  'entityType' | 'title' | 'summary' | 'body' | 'status' | 'tags' | 'data'
>
export type ImportMode = 'design' | 'bugs'
export const defaultSystem =
  '你是游戏设计项目的创作助手。用中文回答，引用项目中已有的条目。'
export const tiers = { fast: '轻量', standard: '标准', ultra: '深度 Ultra' }

export function native<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop)
    return Promise.reject(new Error('请在 GameWorkSpace 桌面端使用此功能'))
  return invoke<T>(command, args)
}
export async function preferences() {
  const [defaults, settings, system, status] = await Promise.all([
    native<Provider[]>('ai_providers'),
    api.getSetting('ai.providers'),
    api.getSetting('ai.system'),
    native<KeyStatus[]>('list_api_key_status'),
  ])
  const saved = settings?.value as {
    active?: string
    configs?: Record<string, Partial<Provider>>
  } | null
  const configs = defaults.map((p) => {
    const stored = saved?.configs?.[p.id]
    const models = Array.isArray(stored?.models)
      ? stored.models.filter((m) => typeof m === 'string' && m.trim())
      : []
    return {
      ...p,
      ...stored,
      model:
        typeof stored?.model === 'string' && stored.model.trim()
          ? stored.model
          : p.model,
      models: [...new Set([...models, ...p.models])],
    }
  })
  return {
    configs,
    active: configs.find((p) => p.id === saved?.active) ?? configs[0],
    system: typeof system?.value === 'string' ? system.value : defaultSystem,
    status,
  }
}
export async function saveProvider(
  configs: Provider[],
  active: string,
  system: string,
) {
  for (const p of configs) {
    if (!p.baseUrl.trim() && p.id !== active) continue
    const url = new URL(p.baseUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw Error('Base URL 仅支持无凭据、查询参数或片段的 HTTP(S) 服务地址')
  }
  await api.saveSetting('ai.providers', {
    active,
    configs: Object.fromEntries(
      configs.map((p) => [
        p.id,
        {
          baseUrl: p.baseUrl,
          model: p.model,
          models: p.models,
          reasoningTier: p.reasoningTier,
          requiresKey: p.requiresKey,
        },
      ]),
    ),
  } as Json)
  await api.saveSetting('ai.system', system)
  window.dispatchEvent(new Event('gws-provider-changed'))
}
export async function aiHistory(projectId: string) {
  const [messages, proposals] = await Promise.all([
    native<AiMessage[]>('list_ai_messages', { projectId }),
    native<AiProposal[]>('list_ai_proposals', { projectId }),
  ])
  return { messages, proposals }
}
export async function readAttachment(file: File): Promise<Attachment> {
  if (/\.(md|txt)$/i.test(file.name))
    return { kind: 'text', name: file.name, text: await file.text() }
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)
  )
    throw Error('请选择 PNG、JPEG、GIF、WebP、Markdown 或文本文件')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  return {
    kind: 'image',
    name: file.name,
    mime: file.type,
    base64: url.slice(url.indexOf(',') + 1),
  }
}
export async function fileBytes(file: Blob) {
  return Array.from(new Uint8Array(await file.arrayBuffer()))
}
export function downloadFile(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[<>:"/\\|?*]/g, '_')
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export async function saveExportFile(
  data: BlobPart | Blob,
  filename: string,
  filterLabel: string,
  extension: string,
  mime: string,
): Promise<string | null> {
  if (!desktop) {
    downloadFile(data, filename, mime)
    return filename
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  return native<string | null>('save_export_file', {
    defaultName: filename,
    filterLabel,
    extension,
    bytes: await fileBytes(blob),
  })
}
