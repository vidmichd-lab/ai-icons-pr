import type { HistorySession } from '../types'

const STORAGE_KEY = 'ai-icons-history-v1'

const normalizeSession = (session: HistorySession): HistorySession | null => {
  if (!session?.id || !session?.sourceName || !session?.styleId || !session?.styleName) {
    return null
  }

  const sourcePreviewUrl =
    session.sourcePreviewUrl.startsWith('blob:') && session.sourceImageUrl
      ? session.sourceImageUrl
      : session.sourcePreviewUrl

  return {
    ...session,
    sourcePreviewUrl,
    generations: Array.isArray(session.generations) ? session.generations : [],
  }
}

export const loadHistory = (): HistorySession[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

export const saveHistory = (history: HistorySession[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

export const clearHistory = () => {
  localStorage.removeItem(STORAGE_KEY)
}
