import type { WebSocket } from 'ws'

import type { StartGameData } from '../types.js'
import { gamesById, getAuthedUser } from '../state.js'
import { isRecord, sendError } from '../ws/protocol.js'
import { startQuestion } from '../gameplay.js'

function safeParseStartGameData(value: unknown): StartGameData | null {
  if (!isRecord(value)) return null
  if (typeof value.gameId !== 'string') return null
  const gameId = value.gameId.trim()
  if (gameId.length === 0) return null
  return { gameId }
}

export function handleStartGame(ws: WebSocket, data: unknown) {
  const user = getAuthedUser(ws)
  if (!user) {
    sendError(ws, 'Not registered. Please send {type:"reg"} first.')
    return
  }

  const payload = safeParseStartGameData(data)
  if (!payload) {
    sendError(ws, 'Invalid start_game payload. Expected { gameId: string }')
    return
  }

  const game = gamesById.get(payload.gameId)
  if (!game) {
    sendError(ws, 'Game not found.')
    return
  }

  if (game.hostId !== user.index) {
    sendError(ws, 'Only the host can start the game.')
    return
  }

  if (game.status !== 'waiting') {
    sendError(ws, 'Game already started or finished.')
    return
  }

  if (game.players.length < 1) {
    sendError(ws, 'Cannot start game without players.')
    return
  }

  game.status = 'in_progress'
  startQuestion(game, 0)
}
