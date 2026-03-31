import type { WebSocket } from 'ws'

import { endQuestion, finishGame } from '../gameplay.js'
import { gamesById, usersById, wsToUserId } from '../state.js'
import { broadcastPlayerList, broadcastToGameClients } from '../ws/broadcast.js'

export function handleDisconnect(ws: WebSocket) {
  const userId = wsToUserId.get(ws)
  if (!userId) return

  const user = usersById.get(userId)
  if (user?.ws === ws) {
    user.ws = undefined
  }

  for (const game of gamesById.values()) {
    if (game.hostId === userId) {
      if (game.status !== 'finished') {
        broadcastToGameClients(game, 'error', { message: 'Host disconnected.' })
        game.status = 'finished'
        if (game.questionTimer) {
          clearTimeout(game.questionTimer)
          game.questionTimer = undefined
        }
      }
      continue
    }

    const idx = game.players.findIndex((p) => p.index === userId)
    if (idx === -1) continue

    game.players.splice(idx, 1)
    game.playerAnswers.delete(userId)

    broadcastPlayerList(game)

    if (game.status === 'in_progress') {
      if (game.players.length === 0) {
        finishGame(game)
        continue
      }

      if (
        game.questionTimer &&
        game.playerAnswers.size >= game.players.length
      ) {
        clearTimeout(game.questionTimer)
        game.questionTimer = undefined
        endQuestion(game)
      }
    }
  }
}
