import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'

import type { RegData, User, WSMessage } from './types.js'

type OutgoingMessage<TData> = {
  type: string
  data: TData
  id: 0
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

// WebSocket server
const wss = new WebSocketServer({ port: PORT })

const usersByName = new Map<string, User>()
const usersById = new Map<string, User>()
const wsToUserId = new WeakMap<WebSocket, string>() // socket to logged-in user.id

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function putUser(user: User) {
  usersByName.set(user.name, user)
  usersById.set(user.index, user)
}

function bindUserToSocket(user: User, ws: WebSocket) {
  user.ws = ws
  wsToUserId.set(ws, user.index)
}

function isWSMessage(value: unknown): value is WSMessage {
  if (!isRecord(value)) return false
  const obj = value

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

function safeParseRegData(value: unknown): RegData | null {
  if (!isRecord(value)) return null
  if (typeof value.name !== 'string') return null
  if (typeof value.password !== 'string') return null

  const name = value.name.trim()
  const password = value.password

  if (name.length === 0) return null
  if (password.length === 0) return null

  return { name, password }
}

function handleReg(ws: WebSocket, data: unknown) {
  const reg = safeParseRegData(data)
  if (!reg) {
    send(ws, 'reg', {
      name: '',
      index: '',
      error: true,
      errorText:
        'Invalid reg payload. Expected { name: string, password: string }',
    })
    return
  }

  const existing = usersByName.get(reg.name)
  if (existing) {
    if (existing.password !== reg.password) {
      send(ws, 'reg', {
        name: reg.name,
        index: '',
        error: true,
        errorText: 'Invalid password',
      })
      return
    }

    bindUserToSocket(existing, ws)

    send(ws, 'reg', {
      name: existing.name,
      index: existing.index,
      error: false,
      errorText: '',
    })
    return
  }

  const user: User = {
    name: reg.name,
    password: reg.password,
    index: randomUUID(), // the client protocol expects 'Id' field to be names 'index' in reg response for some reason
    ws,
  }

  putUser(user)
  bindUserToSocket(user, ws)

  send(ws, 'reg', {
    name: user.name,
    index: user.index,
    error: false,
    errorText: '',
  })
}

function onSocketMessage(ws: WebSocket, raw: RawData) {
  const msg = safeParseMessage(raw)
  if (!msg) {
    sendError(ws, 'Invalid JSON message')
    return
  }

  switch (msg.type) {
    case 'reg':
      handleReg(ws, msg.data)
      break
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
