import type { WebSocket } from 'ws'

import { randomUUID } from 'node:crypto'

import type { CreateGameData, Game, Question } from '../types.js'
import { gamesByCode, getAuthedUser, putGame } from '../state.js'
import { isRecord, send, sendError } from '../ws/protocol.js'

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

function generateUniqueRoomCode(): string | null {
  for (let i = 0; i < 50; i++) {
    const code = generateRoomCode()
    if (!gamesByCode.has(code)) return code
  }
  return null
}

function safeParseQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null
  if (typeof value.text !== 'string') return null
  if (!Array.isArray(value.options)) return null
  if (typeof value.correctIndex !== 'number') return null
  if (typeof value.timeLimitSec !== 'number') return null

  const text = value.text.trim()
  if (text.length === 0) return null

  const options = value.options
  if (options.length !== 4) return null
  if (!options.every((opt) => typeof opt === 'string')) return null

  const correctIndex = value.correctIndex
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3)
    return null

  const timeLimitSec = value.timeLimitSec
  if (!Number.isFinite(timeLimitSec) || timeLimitSec <= 0) return null

  return {
    text,
    options: options as string[],
    correctIndex,
    timeLimitSec,
  }
}

function safeParseCreateGameData(value: unknown): CreateGameData | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.questions)) return null

  const questions: Question[] = []
  for (const q of value.questions) {
    const parsed = safeParseQuestion(q)
    if (!parsed) return null
    questions.push(parsed)
  }

  if (questions.length === 0) return null
  return { questions }
}

export function handleCreateGame(ws: WebSocket, data: unknown) {
  const user = getAuthedUser(ws)
  if (!user) {
    sendError(ws, 'Not registered. Please send {type:"reg"} first.')
    return
  }

  const payload = safeParseCreateGameData(data)
  if (!payload) {
    sendError(ws, 'Invalid create_game payload.')
    return
  }

  const code = generateUniqueRoomCode()
  if (!code) {
    sendError(ws, 'Failed to generate room code. Try again.')
    return
  }

  const game: Game = {
    id: randomUUID(),
    code,
    hostId: user.index,
    questions: payload.questions,
    players: [],
    currentQuestion: -1,
    status: 'waiting',
    playerAnswers: new Map(),
  }

  putGame(game)
  send(ws, 'game_created', { gameId: game.id, code: game.code })
}
