export type StylePreset = {
  id: string
  name: string
  prompt: string
  shortPrompt: string
  previewUrl: string
  createdAt: string
  updatedAt: string
}

export type EditableStylePayload = {
  id?: string
  name: string
  prompt: string
  previewFile?: File | null
  previewUrl?: string
}

export type AuthRole = 'admin' | 'manager'

export type GenerationQuota = {
  limit: number | null
  used: number
  remaining: number | null
  period: string
}

export type AuthUser = {
  id: string
  login: string
  name: string
  role: AuthRole
  quota: GenerationQuota
}

export type ManagedUser = {
  id: string
  login: string
  name: string
  role: AuthRole
  disabled: boolean
  createdAt: string
  updatedAt: string
  quota: GenerationQuota
}

export type GenerationStatus =
  | 'uploading'
  | 'backlogged'
  | 'queued'
  | 'scheduled'
  | 'processing'
  | 'sampling'
  | 'intermediate-complete'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GeneratedAsset = {
  id: string
  kind: 'styled'
  label: string
  seed?: number
  status: GenerationStatus
  jobId: string
  resultUrl?: string
  error?: string
  createdAt: string
}

export type HistorySession = {
  id: string
  sourceName: string
  sourcePreviewUrl: string
  sourceImageUrl: string
  styleId: string
  styleName: string
  createdAt: string
  activeGenerationId: string
  generations: GeneratedAsset[]
}

export type SourceUpload = {
  id: string
  file: File
  name: string
  previewUrl: string
}
