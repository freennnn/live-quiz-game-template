import type { WebSocket } from 'ws'

import type { JoinGameData, Player } from '../types.js'
import { gamesByCode, getAuthedUser } from '../state.js'
import { broadcastPlayerJoined, broadcastPlayerList } from '../ws/broadcast.js'
import { isRecord, send, sendError } from '../ws/protocol.js'

const MAX_PLAYERS_PER_GAME = 50

function safeParseJoinGameData(value: unknown): JoinGameData | null {
  if (!isRecord(value)) return null
  if (typeof value.code !== 'string') return null

  const code = value.code.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) return null

  return { code }
}

export function handleJoinGame(ws: WebSocket, data: unknown) {
  const user = getAuthedUser(ws)
  if (!user) {
    sendError(ws, 'Not registered. Please send {type:"reg"} first.')
    return
  }

  const payload = safeParseJoinGameData(data)
  if (!payload) {
    sendError(ws, 'Invalid join_game payload. Expected { code: string }')
    return
  }

  const game = gamesByCode.get(payload.code)
  if (!game) {
    sendError(ws, 'Game not found. Invalid code.')
    return
  }

  if (game.status !== 'waiting') {
    sendError(ws, 'Game already started or finished.')
    return
  }

  if (game.hostId === user.index) {
    sendError(ws, 'Host cannot join as a player.')
    return
  }

  const existingPlayer = game.players.find((p) => p.index === user.index)
  if (existingPlayer) {
    existingPlayer.ws = ws
    send(ws, 'game_joined', { gameId: game.id })
    broadcastPlayerList(game)
    return
  }

  if (game.players.length >= MAX_PLAYERS_PER_GAME) {
    sendError(ws, 'Game is full.')
    return
  }

  const player: Player = {
    name: user.name,
    index: user.index,
    score: 0,
    ws,
  }

  game.players.push(player)

  send(ws, 'game_joined', { gameId: game.id })
  broadcastPlayerJoined(game, player.name)
  broadcastPlayerList(game)
}
