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

import { safeParseMessage, send, sendError, isRecord } from './ws/protocol.js'
import {
  broadcastPlayerJoined,
  broadcastPlayerList,
  broadcastQuestion,
  broadcastToGameClients,
} from './ws/broadcast.js'
import {
  bindUserToSocket,
  gamesByCode,
  gamesById,
  getAuthedUser,
  putGame,
  putUser,
  usersById,
  usersByName,
  wsToUserId,
} from './state.js'
import {
  endQuestion,
  finishGame,
  startQuestion,
  RESULT_DELAY_MS,
} from './gameplay.js'
import { handleAnswer } from './handlers/answer.js'
import { handleCreateGame } from './handlers/create_game.js'
import { handleDisconnect } from './handlers/disconnect.js'
import { handleJoinGame } from './handlers/join_game.js'
import { handleReg } from './handlers/reg.js'
import { handleStartGame } from './handlers/start_game.js'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

// WebSocket server
const wss = new WebSocketServer({ port: PORT })

const MAX_PLAYERS_PER_GAME = 50

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
