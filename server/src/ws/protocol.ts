import type { RawData, WebSocket } from 'ws'

import type { WSMessage } from '../types.js'

export type OutgoingMessage<TData> = {
  type: string
  data: TData
  id: 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function isWSMessage(value: unknown): value is WSMessage {
  if (!isRecord(value)) return false
  const obj = value

  if (typeof obj.type !== 'string') return false
  if (!Object.hasOwn(obj, 'data')) return false
  if (typeof obj.id !== 'number') return false

  return true
}

export function rawToUtf8(raw: RawData): string | null {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return null
}

export function safeParseMessage(raw: RawData): WSMessage | null {
  const text = rawToUtf8(raw)

  if (!text || text.trim().length === 0) return null

  try {
    const parsed: unknown = JSON.parse(text)
    if (!isWSMessage(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function send<TData>(ws: WebSocket, type: string, data: TData) {
  if (ws.readyState !== ws.OPEN) return
  const message: OutgoingMessage<TData> = { type, data, id: 0 }
  ws.send(JSON.stringify(message))
}

export function sendError(ws: WebSocket, message: string) {
  send(ws, 'error', { message })
}
