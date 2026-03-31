import type { Game } from './types.js'

import {
  broadcastPlayerList,
  broadcastQuestion,
  broadcastToGameClients,
} from './ws/broadcast.js'

export const BASE_POINTS = 1000
export const RESULT_DELAY_MS = 2000

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

export function finishGame(game: Game) {
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

export function endQuestion(game: Game) {
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

export function startQuestion(game: Game, questionIndex: number) {
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
