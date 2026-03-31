import type { WebSocket } from 'ws'

import { randomUUID } from 'node:crypto'

import type { RegData, User } from '../types.js'
import { isRecord, send } from '../ws/protocol.js'
import { bindUserToSocket, putUser, usersByName } from '../state.js'

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

export function handleReg(ws: WebSocket, data: unknown) {
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
    index: randomUUID(),
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
