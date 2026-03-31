import type { WebSocket } from 'ws'

import type { AnswerData } from '../types.js'
import { endQuestion } from '../gameplay.js'
import { gamesById, getAuthedUser } from '../state.js'
import { isRecord, send, sendError } from '../ws/protocol.js'

function safeParseAnswerData(value: unknown): AnswerData | null {
  if (!isRecord(value)) return null
  if (typeof value.gameId !== 'string') return null
  if (typeof value.questionIndex !== 'number') return null
  if (typeof value.answerIndex !== 'number') return null

  const gameId = value.gameId.trim()
  if (gameId.length === 0) return null

  const questionIndex = value.questionIndex
  if (!Number.isInteger(questionIndex) || questionIndex < 0) return null

  const answerIndex = value.answerIndex
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3)
    return null

  return { gameId, questionIndex, answerIndex }
}

export function handleAnswer(ws: WebSocket, data: unknown) {
  const user = getAuthedUser(ws)
  if (!user) {
    sendError(ws, 'Not registered. Please send {type:"reg"} first.')
    return
  }

  const payload = safeParseAnswerData(data)
  if (!payload) {
    sendError(
      ws,
      'Invalid answer payload. Expected { gameId: string, questionIndex: number, answerIndex: number }',
    )
    return
  }

  const game = gamesById.get(payload.gameId)
  if (!game) {
    sendError(ws, 'Game not found.')
    return
  }

  if (game.status !== 'in_progress') {
    sendError(ws, 'Game is not in progress.')
    return
  }

  if (!game.questionTimer) {
    sendError(ws, 'Question is not accepting answers right now.')
    return
  }

  if (payload.questionIndex !== game.currentQuestion) {
    sendError(ws, 'Answer is for a different question.')
    return
  }

  if (game.hostId === user.index) {
    sendError(ws, 'Host cannot answer questions.')
    return
  }

  const player = game.players.find((p) => p.index === user.index)
  if (!player) {
    sendError(ws, 'You are not a player in this game.')
    return
  }

  if (game.playerAnswers.has(player.index)) {
    sendError(ws, 'Answer already submitted for this question.')
    return
  }

  const timestamp = Date.now()
  game.playerAnswers.set(player.index, {
    answerIndex: payload.answerIndex,
    timestamp,
  })

  player.ws = ws

  send(ws, 'answer_accepted', { questionIndex: payload.questionIndex })

  if (game.playerAnswers.size >= game.players.length) {
    clearTimeout(game.questionTimer)
    game.questionTimer = undefined
    endQuestion(game)
  }
}
