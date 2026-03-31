import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'

import type {
  AnswerData,
  CreateGameData,
  Game,
  JoinGameData,
  Player,
  Question,
  RegData,
  StartGameData,
  User,
  WSMessage,
} from './types.js'

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

const gamesById = new Map<string, Game>()
const gamesByCode = new Map<string, Game>()

const BASE_POINTS = 1000
const RESULT_DELAY_MS = 2000

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

function getAuthedUser(ws: WebSocket): User | null {
  const userId = wsToUserId.get(ws)
  if (!userId) return null
  return usersById.get(userId) ?? null
}

function putGame(game: Game) {
  gamesById.set(game.id, game)
  gamesByCode.set(game.code, game)
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

function broadcastToGameClients<TData>(game: Game, type: string, data: TData) {
  const sockets: WebSocket[] = []

  const hostWs = usersById.get(game.hostId)?.ws
  if (hostWs && hostWs.readyState === hostWs.OPEN) sockets.push(hostWs)

  for (const player of game.players) {
    const playerWs = player.ws
    if (playerWs && playerWs.readyState === playerWs.OPEN)
      sockets.push(playerWs)
  }

  for (const ws of sockets) {
    send(ws, type, data)
  }
}

function broadcastPlayerList(game: Game) {
  const players: Array<Pick<Player, 'name' | 'index' | 'score'>> =
    game.players.map((p) => ({ name: p.name, index: p.index, score: p.score }))
  broadcastToGameClients(game, 'update_players', players)
}

function broadcastPlayerJoined(game: Game, playerName: string) {
  broadcastToGameClients(game, 'player_joined', {
    playerName,
    playerCount: game.players.length,
  })
}

function broadcastQuestion(game: Game) {
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

function finishGame(game: Game) {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer)
    game.questionTimer = undefined
  }

  game.status = 'finished'

  const sorted = [...game.players].sort((a, b) => b.score - a.score)
  let distinctRank = 0
  let prevScore: number | null = null

  const scoreboard = sorted.map((p) => {
    if (prevScore === null || p.score !== prevScore) {
      distinctRank += 1
      prevScore = p.score
    }

    return { name: p.name, score: p.score, rank: distinctRank }
  })

  broadcastToGameClients(game, 'game_finished', { scoreboard })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function computePoints(args: {
  correct: boolean
  answerTimestampMs: number
  questionStartTimestampMs: number
  timeLimitMs: number
}) {
  if (!args.correct) return 0

  const elapsedMs = args.answerTimestampMs - args.questionStartTimestampMs
  const timeRemainingMs = clamp(
    args.timeLimitMs - elapsedMs,
    0,
    args.timeLimitMs,
  )
  const ratio = timeRemainingMs / args.timeLimitMs

  return clamp(Math.floor(BASE_POINTS * ratio), 0, BASE_POINTS)
}

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

function safeParseJoinGameData(value: unknown): JoinGameData | null {
  if (!isRecord(value)) return null
  if (typeof value.code !== 'string') return null

  const code = value.code.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) return null

  return { code }
}

function safeParseStartGameData(value: unknown): StartGameData | null {
  if (!isRecord(value)) return null
  if (typeof value.gameId !== 'string') return null
  const gameId = value.gameId.trim()
  if (gameId.length === 0) return null
  return { gameId }
}

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

function handleCreateGame(ws: WebSocket, data: unknown) {
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

function endQuestion(game: Game) {
  if (game.status !== 'in_progress') return

  if (game.questionTimer) {
    clearTimeout(game.questionTimer)
    game.questionTimer = undefined
  }

  const questionIndex = game.currentQuestion
  const question = game.questions[questionIndex]
  if (!question) return

  const startMs = game.questionStartTime ?? Date.now()
  const timeLimitMs = question.timeLimitSec * 1000

  const playerResults = game.players.map((player) => {
    const ans = game.playerAnswers.get(player.index)
    const answered = !!ans
    const correct = answered && ans!.answerIndex === question.correctIndex

    const pointsEarned = answered
      ? computePoints({
          correct,
          answerTimestampMs: ans!.timestamp,
          questionStartTimestampMs: startMs,
          timeLimitMs,
        })
      : 0

    player.score += pointsEarned

    return {
      name: player.name,
      answered,
      correct,
      pointsEarned,
      totalScore: player.score,
    }
  })

  broadcastToGameClients(game, 'question_result', {
    questionIndex,
    correctIndex: question.correctIndex,
    playerResults,
  })
  broadcastPlayerList(game)

  const nextIndex = questionIndex + 1
  if (nextIndex < game.questions.length) {
    setTimeout(() => {
      if (game.status !== 'in_progress') return
      startQuestion(game, nextIndex)
    }, RESULT_DELAY_MS)
  } else {
    setTimeout(() => finishGame(game), RESULT_DELAY_MS)
  }
}

function startQuestion(game: Game, questionIndex: number) {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer)
    game.questionTimer = undefined
  }

  game.currentQuestion = questionIndex
  game.questionStartTime = Date.now()
  game.playerAnswers = new Map()

  broadcastQuestion(game)

  const question = game.questions[game.currentQuestion]
  if (!question) return

  game.questionTimer = setTimeout(() => {
    endQuestion(game)
  }, question.timeLimitSec * 1000)
}

function handleAnswer(ws: WebSocket, data: unknown) {
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

  // Only accept the first answer per player per question.
  if (game.playerAnswers.has(player.index)) {
    sendError(ws, 'Answer already submitted for this question.')
    return
  }

  const timestamp = Date.now()
  game.playerAnswers.set(player.index, {
    answerIndex: payload.answerIndex,
    timestamp,
  })

  // Keep the player's ws up to date (reconnects): if reloaded tab, or logs in second tab
  player.ws = ws

  send(ws, 'answer_accepted', { questionIndex: payload.questionIndex })

  // Early end: if everyone answered, end immediately.
  if (game.playerAnswers.size >= game.players.length) {
    clearTimeout(game.questionTimer)
    game.questionTimer = undefined
    endQuestion(game)
  }
}

function handleDisconnect(ws: WebSocket) {
  const userId = wsToUserId.get(ws)
  if (!userId) return

  const user = usersById.get(userId)
  if (user?.ws === ws) {
    user.ws = undefined
  }

  for (const game of gamesById.values()) {
    // Host disconnect: stop game and notify everyone remaining.
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

    // Player disconnect: remove from roster and drop any in-flight answer.
    game.players.splice(idx, 1)
    game.playerAnswers.delete(userId)

    broadcastPlayerList(game)

    if (game.status === 'in_progress') {
      if (game.players.length === 0) {
        finishGame(game)
        continue
      }

      // If everyone remaining already answered, end early.
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

function handleJoinGame(ws: WebSocket, data: unknown) {
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

function handleStartGame(ws: WebSocket, data: unknown) {
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
      handleCreateGame(ws, msg.data)
      break
    case 'join_game':
      handleJoinGame(ws, msg.data)
      break
    case 'start_game':
      handleStartGame(ws, msg.data)
      break
    case 'answer':
      handleAnswer(ws, msg.data)
      break
    default:
      sendError(ws, `Unknown message type: ${msg.type}`)
  }
}

function onSocketClose(_ws: WebSocket) {
  handleDisconnect(_ws)
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
