import type { EditableStylePayload, GenerationStatus, StylePreset } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

type GenerationRequest = {
  imageUrl: string
  styleId: string
  seed: number
}

const ensureOk = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(payload?.error ?? 'Request failed')
  }

  return (await response.json()) as T
}

const createFormData = (payload: EditableStylePayload) => {
  const formData = new FormData()
  formData.set('name', payload.name)
  formData.set('prompt', payload.prompt)

  if (payload.previewFile) {
    formData.set('previewFile', payload.previewFile)
  }

  if (payload.previewUrl) {
    formData.set('previewUrl', payload.previewUrl)
  }

  return formData
}

export const api = {
  downloadUrl(assetUrl: string, fileName?: string) {
    const params = new URLSearchParams({ url: assetUrl })

    if (fileName) {
      params.set('fileName', fileName)
    }

    return `${API_BASE_URL}/download?${params.toString()}`
  },

  async getStyles() {
    return ensureOk<{ styles: StylePreset[] }>(
      await fetch(`${API_BASE_URL}/styles`),
    )
  },

  async createStyle(payload: EditableStylePayload) {
    return ensureOk<StylePreset>(
      await fetch(`${API_BASE_URL}/styles`, {
        method: 'POST',
        body: createFormData(payload),
      }),
    )
  },

  async updateStyle(styleId: string, payload: EditableStylePayload) {
    return ensureOk<StylePreset>(
      await fetch(`${API_BASE_URL}/styles/${styleId}`, {
        method: 'PUT',
        body: createFormData(payload),
      }),
    )
  },

  async deleteStyle(styleId: string) {
    return ensureOk<{ ok: true }>(
      await fetch(`${API_BASE_URL}/styles/${styleId}`, {
        method: 'DELETE',
      }),
    )
  },

  async uploadAsset(file: File) {
    const formData = new FormData()
    formData.set('file', file)

    return ensureOk<{ imageUrl: string }>(
      await fetch(`${API_BASE_URL}/assets`, {
        method: 'POST',
        body: formData,
      }),
    )
  },

  async createGeneration(payload: GenerationRequest) {
    return ensureOk<{ jobId: string; status: GenerationStatus }>(
      await fetch(`${API_BASE_URL}/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    )
  },
  async getJob(jobId: string) {
    return ensureOk<{
      status: GenerationStatus
      resultUrl?: string
      error?: string
    }>(await fetch(`${API_BASE_URL}/jobs/${jobId}`))
  },
}
