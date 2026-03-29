import 'dotenv/config'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'

import type { WSMessage } from './types.js'

type OutgoingMessage<TData> = {
  type: string
  data: TData
  id: 0
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

// WebSocket server
const wss = new WebSocketServer({ port: PORT })

function isWSMessage(value: unknown): value is WSMessage {
  if (!value || typeof value !== 'object') return false

  const obj = value as Record<string, unknown>

  if (typeof obj.type !== 'string') return false
  if (!Object.hasOwn(obj, 'data')) return false
  if (typeof obj.id !== 'number') return false

  return true
}

function rawToUtf8(raw: RawData): string | null {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return null
}

function safeParseMessage(raw: RawData): WSMessage | null {
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

function send<TData>(ws: WebSocket, type: string, data: TData) {
  if (ws.readyState !== ws.OPEN) return
  const message: OutgoingMessage<TData> = { type, data, id: 0 }
  ws.send(JSON.stringify(message))
}

function sendError(ws: WebSocket, message: string) {
  send(ws, 'error', { message })
}

function onSocketMessage(ws: WebSocket, raw: RawData) {
  const msg = safeParseMessage(raw)
  if (!msg) {
    sendError(ws, 'Invalid JSON message')
    return
  }

  // lifecycle + routing shell only (handlers added in later steps)
  switch (msg.type) {
    case 'reg':
    case 'create_game':
    case 'join_game':
    case 'start_game':
    case 'answer':
      sendError(ws, `Not implemented yet: ${msg.type}`)
      break
    default:
      sendError(ws, `Unknown message type: ${msg.type}`)
  }
}

function onSocketClose(_ws: WebSocket) {
  // Disconnect cleanup will be implemented in a later step.
}

wss.on('listening', () => {
  const addr = wss.address()
  const port = typeof addr === 'string' ? PORT : (addr?.port ?? PORT)
  console.log(`WebSocket server running at ws://localhost:${port}`)
})

wss.on('connection', (ws) => {
  ws.on('message', (raw) => onSocketMessage(ws, raw))
  ws.on('close', () => onSocketClose(ws))
})
