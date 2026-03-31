import type { WebSocket } from 'ws'

import type { Game, User } from './types.js'

export const usersByName = new Map<string, User>()
export const usersById = new Map<string, User>()
export const wsToUserId = new WeakMap<WebSocket, string>() // socket -> logged-in user id

export const gamesById = new Map<string, Game>()
export const gamesByCode = new Map<string, Game>()

export function putUser(user: User) {
  usersByName.set(user.name, user)
  usersById.set(user.index, user)
}

export function bindUserToSocket(user: User, ws: WebSocket) {
  user.ws = ws
  wsToUserId.set(ws, user.index)
}

export function getAuthedUser(ws: WebSocket): User | null {
  const userId = wsToUserId.get(ws)
  if (!userId) return null
  return usersById.get(userId) ?? null
}

export function putGame(game: Game) {
  gamesById.set(game.id, game)
  gamesByCode.set(game.code, game)
}
