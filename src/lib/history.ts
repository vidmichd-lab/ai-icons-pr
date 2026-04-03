import type { HistorySession } from '../types'

const STORAGE_KEY_PREFIX = 'ai-icons-history-v2'

const storageKey = (login: string) => `${STORAGE_KEY_PREFIX}:${login}`

const normalizeSession = (session: HistorySession): HistorySession | null => {
  if (!session?.id || !session?.sourceName || !session?.styleId || !session?.styleName) {
    return null
  }

  const sourcePreviewUrl =
    session.sourcePreviewUrl?.startsWith('blob:') && session.sourceImageUrl
      ? session.sourceImageUrl
      : (session.sourcePreviewUrl ?? '')

  return {
    ...session,
    sourcePreviewUrl,
    sourcePrompt: session.sourcePrompt?.trim() ? session.sourcePrompt : undefined,
    generations: Array.isArray(session.generations) ? session.generations : [],
  }
}

export const loadHistory = (login: string): HistorySession[] => {
  try {
    const raw = localStorage.getItem(storageKey(login))
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as HistorySession[]
    return Array.isArray(parsed)
      ? parsed
          .map((session) => normalizeSession(session))
          .filter((session): session is HistorySession => session !== null)
      : []
  } catch {
    return []
  }
}

export const saveHistory = (login: string, history: HistorySession[]) => {
  localStorage.setItem(storageKey(login), JSON.stringify(history))
}

export const clearHistory = (login: string) => {
  localStorage.removeItem(storageKey(login))
}
