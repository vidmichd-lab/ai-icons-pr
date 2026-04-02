import type {
  AuthUser,
  EditableStylePayload,
  GenerationStatus,
  ManagedUser,
  StylePreset,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

type GenerationRequest = {
  imageUrl: string
  styleId: string
  seed: number
}

type LoginPayload = {
  login: string
  password: string
}

type AdminCreateUserPayload = {
  login: string
  name: string
  quotaLimit?: number
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const fetchApi = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  })

const ensureOk = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null

    throw new ApiError(payload?.error ?? 'Request failed', response.status)
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

  async getMe() {
    return ensureOk<{ user: AuthUser }>(await fetchApi('/auth/me', { cache: 'no-store' }))
  },

  async login(payload: LoginPayload) {
    return ensureOk<{ user: AuthUser }>(
      await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
  },

  async logout() {
    return ensureOk<{ ok: true }>(
      await fetchApi('/auth/logout', {
        method: 'POST',
      }),
    )
  },

  async getStyles() {
    return ensureOk<{ styles: StylePreset[] }>(
      await fetchApi('/styles', {
        cache: 'no-store',
      }),
    )
  },

  async createStyle(payload: EditableStylePayload) {
    return ensureOk<StylePreset>(
      await fetchApi('/styles', {
        method: 'POST',
        body: createFormData(payload),
      }),
    )
  },

  async updateStyle(styleId: string, payload: EditableStylePayload) {
    return ensureOk<StylePreset>(
      await fetchApi(`/styles/${styleId}`, {
        method: 'PUT',
        body: createFormData(payload),
      }),
    )
  },

  async deleteStyle(styleId: string) {
    return ensureOk<{ ok: true }>(
      await fetchApi(`/styles/${styleId}`, {
        method: 'DELETE',
      }),
    )
  },

  async uploadAsset(file: File) {
    const formData = new FormData()
    formData.set('file', file)

    return ensureOk<{ imageUrl: string }>(
      await fetchApi('/assets', {
        method: 'POST',
        body: formData,
      }),
    )
  },

  async createGeneration(payload: GenerationRequest) {
    return ensureOk<{ jobId: string; status: GenerationStatus; quota: AuthUser['quota'] }>(
      await fetchApi('/generations', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
  },

  async getJob(jobId: string) {
    return ensureOk<{
      status: GenerationStatus
      resultUrl?: string
      error?: string
    }>(await fetchApi(`/jobs/${jobId}`))
  },

  async getAdminUsers() {
    return ensureOk<{ users: ManagedUser[] }>(await fetchApi('/admin/users', { cache: 'no-store' }))
  },

  async createAdminUser(payload: AdminCreateUserPayload) {
    return ensureOk<{ user: ManagedUser; password: string }>(
      await fetchApi('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
  },

  async deleteAdminUser(login: string) {
    return ensureOk<{ ok: true }>(
      await fetchApi(`/admin/users/${encodeURIComponent(login)}`, {
        method: 'DELETE',
      }),
    )
  },

  async updateAdminUserQuota(login: string, quotaLimit: number | null) {
    return ensureOk<{ user: ManagedUser }>(
      await fetchApi(`/admin/users/${encodeURIComponent(login)}`, {
        method: 'PUT',
        body: JSON.stringify({ quotaLimit }),
      }),
    )
  },
}
