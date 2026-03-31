import type { WebSocket } from 'ws'

import type { Game, Player } from '../types.js'
import { usersById } from '../state.js'
import { send } from './protocol.js'

export function broadcastToGameClients<TData>(
  game: Game,
  type: string,
  data: TData,
) {
  const sockets = new Set<WebSocket>()

  const hostWs = usersById.get(game.hostId)?.ws
  if (hostWs && hostWs.readyState === hostWs.OPEN) sockets.add(hostWs)

  for (const player of game.players) {
    const playerWs = player.ws
    if (playerWs && playerWs.readyState === playerWs.OPEN) sockets.add(playerWs)
  }

  for (const ws of sockets.values()) {
    send(ws, type, data)
  }
}

export function broadcastPlayerList(game: Game) {
  const players: Array<Pick<Player, 'name' | 'index' | 'score'>> =
    game.players.map((p) => ({
      name: p.name,
      index: p.index,
      score: p.score,
    }))
  broadcastToGameClients(game, 'update_players', players)
}

export function broadcastPlayerJoined(game: Game, playerName: string) {
  broadcastToGameClients(game, 'player_joined', {
    playerName,
    playerCount: game.players.length,
  })
}

export function broadcastQuestion(game: Game) {
  const question = game.questions[game.currentQuestion]
  if (!question) return

  broadcastToGameClients(game, 'question', {
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitSec: question.timeLimitSec,
  })
}
