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
  kind: 'styled' | 'cutout'
  label: string
  seed?: number
  status: GenerationStatus
  jobId: string
  resultUrl?: string
  error?: string
  sourceGenerationId?: string
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
