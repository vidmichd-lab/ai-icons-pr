import type { HistorySession } from '../types'

const STORAGE_KEY = 'ai-icons-history-v1'

export const loadHistory = (): HistorySession[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as HistorySession[]) : []
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
