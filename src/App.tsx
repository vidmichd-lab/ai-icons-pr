import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCcwIcon,
  Settings2Icon,
  Trash2Icon,
} from 'lucide-react'
import { zipSync } from 'fflate'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, api } from '@/lib/api'
import { clearHistory, loadHistory, saveHistory } from '@/lib/history'
import { cn } from '@/lib/utils'
import type {
  AuthUser,
  EditableStylePayload,
  GeneratedAsset,
  HistorySession,
  ManagedUser,
  SourceUpload,
  StylePreset,
} from '@/types'

const MAX_FILES = 10

const newSeed = () => Math.floor(Math.random() * 4_294_967_295)

const ensureErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Что-то пошло не так'

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })

const isPendingStatus = (status?: GeneratedAsset['status']) =>
  status !== 'completed' && status !== 'failed' && status !== 'cancelled'

const updateSession = (
  sessions: HistorySession[],
  sessionId: string,
  updater: (session: HistorySession) => HistorySession,
) =>
  sessions.map((session) =>
    session.id === sessionId ? updater(session) : session,
  )

const patchGeneration = (
  session: HistorySession,
  generationId: string,
  updater: (generation: GeneratedAsset) => GeneratedAsset,
) => ({
  ...session,
  generations: session.generations.map((generation) =>
    generation.id === generationId ? updater(generation) : generation,
  ),
})

function App() {
  const [styles, setStyles] = useState<StylePreset[]>([])
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [isLoggingIn, startLogin] = useTransition()
  const [selectedStyleId, setSelectedStyleId] = useState<string>('')
  const [uploads, setUploads] = useState<SourceUpload[]>([])
  const [history, setHistory] = useState<HistorySession[]>([])
  const [notice, setNotice] = useState<string>('')
  const [isStylesLoading, setIsStylesLoading] = useState(true)
  const [isArchiveDownloading, setIsArchiveDownloading] = useState(false)
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null)
  const [isGenerating, startGenerating] = useTransition()
  const [isStylesBusy, startStylesMutation] = useTransition()
  const [isHydrated, setIsHydrated] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingStyle, setEditingStyle] = useState<StylePreset | null>(null)
  const [previewAsset, setPreviewAsset] = useState<{ url: string; label: string } | null>(null)
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false)
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([])
  const [generatedCredentials, setGeneratedCredentials] = useState<{ login: string; password: string } | null>(null)
  const [isAdminLoading, setIsAdminLoading] = useState(false)
  const [isAdminBusy, startAdminMutation] = useTransition()

  const isRootAdmin = authUser?.login === 'vidmich'
  const quotaLabel = authUser
    ? authUser.quota.limit === null
      ? '∞'
      : `${authUser.quota.remaining}/${authUser.quota.limit}`
    : null

  const loadStyles = async () => {
    setIsStylesLoading(true)

    try {
      const response = await api.getStyles()
      setStyles(response.styles)
      setSelectedStyleId((current) => current || response.styles[0]?.id || '')
      setNotice('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthUser(null)
      } else {
        setNotice(ensureErrorMessage(error))
      }
    } finally {
      setIsStylesLoading(false)
      setIsHydrated(true)
    }
  }

  const refreshAuthUser = async () => {
    try {
      const response = await api.getMe()
      setAuthUser(response.user)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthUser(null)
      }
    }
  }

  const loadAdminUsers = useCallback(async () => {
    if (!isRootAdmin) {
      return
    }

    setIsAdminLoading(true)

    try {
      const response = await api.getAdminUsers()
      setManagedUsers(response.users)
      setNotice('')
    } catch (error) {
      setNotice(ensureErrorMessage(error))
    } finally {
      setIsAdminLoading(false)
    }
  }, [isRootAdmin])

  useEffect(() => {
    void api
      .getMe()
      .then(async (response) => {
        setAuthUser(response.user)
        await loadStyles()
      })
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 401)) {
          setNotice(ensureErrorMessage(error))
        }

        setIsStylesLoading(false)
        setIsHydrated(true)
      })
  }, [])

  useEffect(() => {
    if (!authUser?.login) {
      return
    }

    saveHistory(authUser.login, history)
  }, [authUser?.login, history])

  useEffect(() => {
    if (!authUser?.login) {
      setHistory([])
      return
    }

    setHistory(loadHistory(authUser.login))
  }, [authUser?.login])

  useEffect(() => {
    if (isAdminPanelOpen && isRootAdmin) {
      void loadAdminUsers()
    }
  }, [isAdminPanelOpen, isRootAdmin, loadAdminUsers])

  const selectedStyle = useMemo(
    () => styles.find((style) => style.id === selectedStyleId) ?? null,
    [selectedStyleId, styles],
  )

  const onDrop = (acceptedFiles: File[]) => {
    void (async () => {
      const freeSlots = Math.max(MAX_FILES - uploads.length, 0)
      const files = acceptedFiles.slice(0, freeSlots)

      try {
        const nextUploads = await Promise.all(
          files.map(async (file) => ({
            id: crypto.randomUUID(),
            file,
            name: file.name,
            previewUrl: await readFileAsDataUrl(file),
          })),
        )

        setUploads((current) => [...current, ...nextUploads])
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })()
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: MAX_FILES,
    multiple: true,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
  })

  const clearUploads = () => {
    setUploads([])
  }

  const clearHistoryState = () => {
    if (authUser?.login) {
      clearHistory(authUser.login)
    }
    setHistory([])
  }

  const handleLogin = () => {
    if (!login.trim() || !password.trim()) {
      setNotice('Введите логин и пароль.')
      return
    }

    startLogin(async () => {
      try {
        const response = await api.login({
          login: login.trim(),
          password,
        })

        setAuthUser(response.user)
        setPassword('')
        setNotice('')
        await loadStyles()
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const handleLogout = () => {
    void api
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setAuthUser(null)
        setStyles([])
        setSelectedStyleId('')
        setPassword('')
        setManagedUsers([])
        setGeneratedCredentials(null)
        setIsAdminPanelOpen(false)
        setNotice('')
      })
  }

  const handleGenerate = () => {
    if (!selectedStyle) {
      setNotice('Сначала выберите стиль.')
      return
    }

    if (uploads.length === 0) {
      setNotice('Добавьте хотя бы одну иконку.')
      return
    }

    setNotice('')

    startGenerating(async () => {
      for (const upload of uploads) {
        const sessionId = crypto.randomUUID()
        const generationId = crypto.randomUUID()
        const seed = newSeed()

        setHistory((current) => [
          {
            id: sessionId,
            sourceName: upload.name,
            sourcePreviewUrl: upload.previewUrl,
            sourceImageUrl: '',
            styleId: selectedStyle.id,
            styleName: selectedStyle.name,
            createdAt: new Date().toISOString(),
            activeGenerationId: generationId,
            generations: [
              {
                id: generationId,
                kind: 'styled',
                label: `Seed ${seed}`,
                seed,
                status: 'uploading',
                jobId: '',
                createdAt: new Date().toISOString(),
              },
            ],
          },
          ...current,
        ])

        try {
          const asset = await api.uploadAsset(upload.file)
          const generation = await api.createGeneration({
            imageUrl: asset.imageUrl,
            styleId: selectedStyle.id,
            seed,
          })

          setAuthUser((current) =>
            current
              ? {
                  ...current,
                  quota: generation.quota,
                }
              : current,
          )

          setHistory((current) =>
            updateSession(current, sessionId, (session) => ({
              ...session,
              sourceImageUrl: asset.imageUrl,
              generations: session.generations.map((item) =>
                item.id === generationId
                  ? {
                      ...item,
                      jobId: generation.jobId,
                      status: generation.status,
                    }
                  : item,
              ),
            })),
          )

          void pollJob(sessionId, generationId, generation.jobId)
        } catch (error) {
          if (error instanceof ApiError && error.status === 429) {
            await refreshAuthUser()
          }

          setHistory((current) =>
            updateSession(current, sessionId, (session) =>
              patchGeneration(session, generationId, (generation) => ({
                ...generation,
                status: 'failed',
                error: ensureErrorMessage(error),
              })),
            ),
          )
        }
      }

      clearUploads()
    })
  }

  const pollJob = async (
    sessionId: string,
    generationId: string,
    jobId: string,
    attempts = 0,
  ): Promise<void> => {
    if (attempts > 60) {
      setHistory((current) =>
        updateSession(current, sessionId, (session) =>
          patchGeneration(session, generationId, (generation) => ({
            ...generation,
            status: 'failed',
            error: 'Krea не вернула результат за ожидаемое время.',
          })),
        ),
      )
      return
    }

    const response = await api.getJob(jobId)

    if (response.status === 'completed' && response.resultUrl) {
      setHistory((current) =>
        updateSession(current, sessionId, (session) =>
          patchGeneration(session, generationId, (generation) => ({
            ...generation,
            status: 'completed',
            resultUrl: response.resultUrl,
          })),
        ),
      )
      return
    }

    if (response.status === 'failed' || response.status === 'cancelled') {
      setHistory((current) =>
        updateSession(current, sessionId, (session) =>
          patchGeneration(session, generationId, (generation) => ({
            ...generation,
            status: 'failed',
            error: response.error ?? 'Генерация завершилась ошибкой.',
          })),
        ),
      )
      return
    }

    setHistory((current) =>
      updateSession(current, sessionId, (session) =>
        patchGeneration(session, generationId, (generation) => ({
          ...generation,
          status: response.status,
        })),
      ),
    )

    await new Promise((resolve) => window.setTimeout(resolve, 2_500))
    await pollJob(sessionId, generationId, jobId, attempts + 1)
  }

  const reroll = (session: HistorySession) => {
    if (!session.sourceImageUrl) {
      setNotice('Исходник для повторной генерации еще не загружен.')
      return
    }

    const generationId = crypto.randomUUID()
    const seed = newSeed()

    setHistory((current) =>
      updateSession(current, session.id, (item) => ({
        ...item,
        activeGenerationId: generationId,
        generations: [
          {
            id: generationId,
            kind: 'styled',
            label: `Seed ${seed}`,
            seed,
            status: 'queued',
            jobId: '',
            createdAt: new Date().toISOString(),
          },
          ...item.generations,
        ],
      })),
    )

    startGenerating(async () => {
      try {
        const response = await api.createGeneration({
          imageUrl: session.sourceImageUrl,
          styleId: session.styleId,
          seed,
        })

        setAuthUser((current) =>
          current
            ? {
                ...current,
                quota: response.quota,
              }
            : current,
        )

        setHistory((current) =>
          updateSession(current, session.id, (item) =>
            patchGeneration(item, generationId, (generation) => ({
              ...generation,
              jobId: response.jobId,
              status: response.status,
            })),
          ),
        )

        void pollJob(session.id, generationId, response.jobId)
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          await refreshAuthUser()
        }

        setHistory((current) =>
          updateSession(current, session.id, (item) =>
            patchGeneration(item, generationId, (generation) => ({
              ...generation,
              status: 'failed',
              error: ensureErrorMessage(error),
            })),
          ),
        )
      }
    })
  }

  const openStyleCreator = (style?: StylePreset) => {
    if (!isRootAdmin) {
      return
    }

    setEditingStyle(style ?? null)
    setIsEditorOpen(true)
  }

  const upsertStyle = (payload: EditableStylePayload) => {
    startStylesMutation(async () => {
      try {
        const nextStyle = payload.id
          ? await api.updateStyle(payload.id, payload)
          : await api.createStyle(payload)

        setStyles((current) => {
          const withoutCurrent = current.filter((style) => style.id !== nextStyle.id)
          return [nextStyle, ...withoutCurrent]
        })

        setSelectedStyleId(nextStyle.id)
        setIsEditorOpen(false)
        setEditingStyle(null)
        setNotice('')
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const removeStyle = (styleId: string) => {
    startStylesMutation(async () => {
      try {
        await api.deleteStyle(styleId)

        setStyles((current) => {
          const nextStyles = current.filter((style) => style.id !== styleId)
          setSelectedStyleId((currentSelected) =>
            currentSelected === styleId ? nextStyles[0]?.id ?? '' : currentSelected,
          )
          return nextStyles
        })

        setNotice('')
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const createManagedUser = (payload: { login: string; name: string; quotaLimit: number }) => {
    startAdminMutation(async () => {
      try {
        const response = await api.createAdminUser(payload)
        setManagedUsers((current) =>
          [response.user, ...current.filter((user) => user.id !== response.user.id)].sort((left, right) =>
            left.login.localeCompare(right.login),
          ),
        )
        setGeneratedCredentials({
          login: response.user.login,
          password: response.password,
        })
        setNotice('')
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const deleteManagedUser = (login: string) => {
    startAdminMutation(async () => {
      try {
        await api.deleteAdminUser(login)
        setManagedUsers((current) => current.filter((user) => user.login !== login))
        setNotice('')
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const updateManagedUserQuota = (login: string, quotaLimit: number | null) => {
    startAdminMutation(async () => {
      try {
        const response = await api.updateAdminUserQuota(login, quotaLimit)
        setManagedUsers((current) =>
          current.map((user) => (user.login === login ? response.user : user)),
        )
        setNotice('')
      } catch (error) {
        setNotice(ensureErrorMessage(error))
      }
    })
  }

  const downloadPng = async (url: string, fileName: string) => {
    setActiveDownloadId(fileName)

    try {
      const response = await fetch(api.downloadUrl(url, fileName), {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Не удалось скачать PNG')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setNotice(ensureErrorMessage(error))
    } finally {
      setActiveDownloadId(null)
    }
  }

  const downloadSelectedArchive = async () => {
    const selected = history
      .map((session) => {
        const activeGeneration =
          session.generations.find((generation) => generation.id === session.activeGenerationId) ??
          null

        if (!activeGeneration?.resultUrl || activeGeneration.status !== 'completed') {
          return null
        }

        return {
          label: `${session.sourceName.replace(/\.[^.]+$/, '')}-${activeGeneration.label}.png`,
          url: activeGeneration.resultUrl,
        }
      })
      .filter((entry): entry is { label: string; url: string } => entry !== null)

    if (selected.length === 0) {
      setNotice('Выберите готовые генерации для скачивания.')
      return
    }

    setIsArchiveDownloading(true)

    try {
      const entries = await Promise.all(
        selected.map(async (entry, index) => {
          const response = await fetch(api.downloadUrl(entry.url, entry.label), {
            credentials: 'include',
          })

          if (!response.ok) {
            throw new Error('Не удалось скачать один из результатов')
          }

          const buffer = new Uint8Array(await response.arrayBuffer())
          const safeName = `${String(index + 1).padStart(2, '0')}-${entry.label}`
          return [safeName, buffer] as const
        }),
      )

      const archiveEntries: Record<string, Uint8Array> = {}

      for (const [fileName, bytes] of entries) {
        archiveEntries[fileName] = bytes as Uint8Array
      }

      const archive = zipSync(archiveEntries)
      const blob = new Blob([archive as BlobPart], { type: 'application/zip' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'ai-icons-selected.zip'
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setNotice(ensureErrorMessage(error))
    } finally {
      setIsArchiveDownloading(false)
    }
  }

  const selectedCompletedCount = history.reduce((count, session) => {
    const activeGeneration = session.generations.find(
      (generation) =>
        generation.id === session.activeGenerationId &&
        generation.status === 'completed' &&
        generation.resultUrl,
    )

    return count + (activeGeneration ? 1 : 0)
  }, 0)

  if (!authUser) {
    return (
      <div className="mx-auto flex h-[100svh] w-full max-w-[560px] items-center justify-center p-4">
        <Card className="w-full bg-card/90 backdrop-blur-sm">
          <CardHeader className="items-center gap-2 border-b text-center">
            <CardTitle className="text-center text-lg">AI Icons</CardTitle>
            <p className="text-center text-sm text-muted-foreground">
              Вход для сотрудников. Для доступа, обратитесь к{' '}
              <a
                href="https://staff.yandex-team.ru/vidmich"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground no-underline"
              >
                @vidmich
              </a>
              .
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">Логин</label>
              <Input
                autoComplete="username"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="manager"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">Пароль</label>
              <Input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleLogin()
                  }
                }}
              />
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button className="w-full" onClick={handleLogin} disabled={isLoggingIn || isStylesLoading}>
              {isLoggingIn || isStylesLoading ? (
                <LoadingSpinner label="Входим…" size="sm" />
              ) : (
                'Войти'
              )}
            </Button>
          </CardFooter>
          {notice ? (
            <div className="px-4 pb-4 text-sm text-destructive">{notice}</div>
          ) : null}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-[100svh] w-full max-w-[1480px] flex-col overflow-hidden p-3 md:p-4">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)_minmax(540px,2fr)]">
        <Card className="h-full min-h-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="min-h-14 items-center border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">1</Badge>
              Стиль
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3">
            <ScrollArea className="-mx-3 min-h-0 flex-1 px-3">
              {isStylesLoading ? (
                <div className="flex min-h-32 items-center justify-center">
                  <LoadingSpinner label="Загружаем стили" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {styles.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyleId(style.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border border-border bg-background/80 p-2 text-left transition hover:bg-muted/70',
                        style.id === selectedStyleId &&
                          'border-secondary bg-muted ring-1 ring-secondary/40',
                      )}
                    >
                      <img
                        src={style.previewUrl}
                        alt={style.name}
                        className="size-16 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">{style.name}</div>
                      </div>
                      {isRootAdmin ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            openStyleCreator(style)
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
          <CardFooter className="mt-auto justify-center py-3">
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Вайб-код от{' '}
                <a
                  className="font-medium text-foreground"
                  href="https://staff.yandex-team.ru/vidmich"
                  rel="noreferrer"
                  target="_blank"
                >
                  @vidmich
                </a>
              </p>
              {isRootAdmin ? (
                <Button size="icon-sm" variant="outline" onClick={() => openStyleCreator()}>
                  <PlusIcon />
                  <span className="sr-only">Добавить стиль</span>
                </Button>
              ) : null}
            </div>
          </CardFooter>
        </Card>

        <Card className="h-full min-h-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="min-h-14 items-center border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">2</Badge>
              Загрузка
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div
              {...getRootProps()}
              className={cn(
                'flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/70 px-4 py-6 text-center transition',
                isDragActive && 'border-secondary bg-accent/60',
              )}
            >
              <input {...getInputProps()} />
              <div className="text-sm font-semibold text-foreground">Перетащите файлы сюда</div>
              <p className="mt-1 text-xs text-muted-foreground">
                До 10 файлов, квадратный исходник PNG, JPG, WEBP с иконкой на белом фоне
              </p>
            </div>

            <ScrollArea className="-mx-4 min-h-0 flex-1 px-4">
              <div className="grid gap-2 pb-1">
                {uploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/80 p-2"
                  >
                    <img
                      src={upload.previewUrl}
                      alt={upload.name}
                      className="size-16 rounded-lg object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{upload.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
          <CardFooter className="mt-auto flex-col gap-2 py-3">
            <Button
              className="w-full"
              disabled={!isHydrated || isGenerating || uploads.length === 0}
              onClick={handleGenerate}
            >
              {isGenerating ? <LoadingSpinner label="Генерация идет…" size="sm" /> : 'Сгенерировать'}
            </Button>
            {uploads.length > 0 ? (
              <Button className="w-full" variant="outline" onClick={clearUploads}>
                <Trash2Icon data-icon="inline-start" />
                Очистить
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <Card className="h-full min-h-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="min-h-14 items-center border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">3</Badge>
              Результат
            </CardTitle>
            <CardAction className="self-center">
              <div className="flex items-center gap-2">
                {quotaLabel ? <span className="text-xs text-muted-foreground">{quotaLabel}</span> : null}
                {isRootAdmin ? (
                  <Button size="sm" variant="ghost" onClick={() => setIsAdminPanelOpen(true)}>
                    <Settings2Icon data-icon="inline-start" />
                    Панель управления
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={handleLogout}>
                  Выйти
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadSelectedArchive()}
                  disabled={selectedCompletedCount === 0}
                >
                  {isArchiveDownloading ? (
                    <LoadingSpinner label="Собираем архив" size="sm" />
                  ) : (
                    <>
                      <DownloadIcon data-icon="inline-start" />
                      Скачать архив
                    </>
                  )}
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3">
            <ScrollArea className="-mx-3 min-h-0 flex-1 px-3">
              <div className="flex flex-col gap-3 py-1 pr-1">
                {history.map((session) => {
                  const activeGeneration =
                    session.generations.find(
                      (generation) => generation.id === session.activeGenerationId,
                    ) ?? session.generations[0]
                  return (
                    <Card
                      key={session.id}
                      size="sm"
                      className="border border-border bg-background py-3 shadow-none"
                    >
                      <CardHeader className="gap-3">
                        <div className="flex items-start gap-3">
                          <img
                            src={session.sourcePreviewUrl}
                            alt={session.sourceName}
                            className="size-24 rounded-lg object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {session.sourceName}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{session.styleName}</p>
                            <p className="mt-1 text-xs font-medium text-foreground/70">Исходник</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {activeGeneration?.error ? (
                                activeGeneration.error
                              ) : isPendingStatus(activeGeneration?.status) ? (
                                <span className="inline-flex items-center gap-2">
                                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                                  {statusLabel(activeGeneration?.status)}
                                </span>
                              ) : (
                                statusLabel(activeGeneration?.status)
                              )}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-5">
                          {session.generations.map((generation) => (
                            <div
                              key={generation.id}
                              className={cn(
                                'rounded-xl border border-border bg-muted/30 p-2 text-left transition hover:bg-muted/60',
                                generation.id === session.activeGenerationId &&
                                  'border-secondary bg-muted ring-1 ring-secondary/40',
                              )}
                            >
                              <div className="relative mb-2 overflow-hidden rounded-lg bg-background">
                                <button
                                  type="button"
                                  className="block w-full"
                                  onClick={() => {
                                    setHistory((current) =>
                                      updateSession(current, session.id, (item) => ({
                                        ...item,
                                        activeGenerationId: generation.id,
                                      })),
                                    )

                                    if (generation.resultUrl) {
                                      setPreviewAsset({
                                        url: generation.resultUrl,
                                        label: `${session.sourceName} · ${generation.label}`,
                                      })
                                    }
                                  }}
                                >
                                  {generation.resultUrl ? (
                                    <img
                                      src={generation.resultUrl}
                                      alt={generation.label}
                                      className="aspect-square w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex aspect-square items-center justify-center">
                                      <LoadingSpinner label={shortStatus(generation.status)} size="sm" />
                                    </div>
                                  )}
                                </button>
                              </div>
                              <button
                                type="button"
                                className="block w-full"
                                onClick={() =>
                                  setHistory((current) =>
                                    updateSession(current, session.id, (item) => ({
                                      ...item,
                                      activeGenerationId: generation.id,
                                    })),
                                  )
                                }
                              >
                                <div className="truncate text-[11px] font-medium text-foreground">
                                  {generation.label}
                                </div>
                              </button>
                              {generation.resultUrl ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="mt-2 w-full"
                                  onClick={() =>
                                    void downloadPng(
                                      generation.resultUrl!,
                                      `${session.sourceName.replace(/\.[^.]+$/, '')}-${generation.label}.png`,
                                    )
                                  }
                                >
                                  {activeDownloadId === `${session.sourceName.replace(/\.[^.]+$/, '')}-${generation.label}.png` ? (
                                    <LoaderCircleIcon className="animate-spin" />
                                  ) : (
                                    <>
                                      <DownloadIcon data-icon="inline-start" />
                                      Скачать
                                    </>
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                      <CardFooter className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => reroll(session)}>
                          <RefreshCcwIcon data-icon="inline-start" />
                          Новый seed
                        </Button>
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
          <CardFooter className="mt-auto py-3">
            <Button
              className="w-full"
              variant="outline"
              onClick={clearHistoryState}
              disabled={history.length === 0}
            >
              <Trash2Icon data-icon="inline-start" />
              Очистить
            </Button>
          </CardFooter>
        </Card>
      </div>

      {notice ? (
        <div className="pointer-events-none fixed right-4 bottom-4 z-50 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg">
          {notice}
        </div>
      ) : null}

      <StyleEditor
        busy={isStylesBusy}
        key={editingStyle?.id ?? 'new-style'}
        onClose={() => {
          setIsEditorOpen(false)
          setEditingStyle(null)
        }}
        onDelete={editingStyle ? removeStyle : undefined}
        onSubmit={upsertStyle}
        open={isEditorOpen}
        style={editingStyle}
      />

      <AdminPanel
        busy={isAdminBusy}
        generatedCredentials={generatedCredentials}
        loading={isAdminLoading}
        onClose={() => {
          setIsAdminPanelOpen(false)
          setGeneratedCredentials(null)
        }}
        onCreateUser={createManagedUser}
        onDeleteUser={deleteManagedUser}
        onUpdateQuota={updateManagedUserQuota}
        open={isAdminPanelOpen}
        users={managedUsers}
      />

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        <DialogContent className="max-w-4xl p-3 sm:p-4">
          {previewAsset ? (
            <div className="flex flex-col gap-3">
              <DialogHeader>
                <DialogTitle className="truncate pr-8 text-sm">{previewAsset.label}</DialogTitle>
              </DialogHeader>
              <div className="overflow-hidden rounded-xl bg-background">
                <img
                  src={previewAsset.url}
                  alt={previewAsset.label}
                  className="max-h-[80svh] w-full object-contain"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

type AdminPanelProps = {
  busy: boolean
  generatedCredentials: { login: string; password: string } | null
  loading: boolean
  onClose: () => void
  onCreateUser: (payload: { login: string; name: string; quotaLimit: number }) => void
  onDeleteUser: (login: string) => void
  onUpdateQuota: (login: string, quotaLimit: number | null) => void
  open: boolean
  users: ManagedUser[]
}

function AdminPanel({
  busy,
  generatedCredentials,
  loading,
  onClose,
  onCreateUser,
  onDeleteUser,
  onUpdateQuota,
  open,
  users,
}: AdminPanelProps) {
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [quotaLimit, setQuotaLimit] = useState('100')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="w-[min(92vw,760px)] max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Панель управления</DialogTitle>
          <DialogDescription>
            Доступами управляет только `vidmich`. Для каждого пользователя действует лимит 100 генераций в месяц.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Логин</label>
                <Input
                  value={login}
                  onChange={(event) => setLogin(event.target.value.toLowerCase())}
                  placeholder="manager01"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">Имя</label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Менеджер"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">Лимит в месяц</label>
                <Input
                  inputMode="numeric"
                  value={quotaLimit}
                  onChange={(event) => setQuotaLimit(event.target.value.replace(/[^\d]/g, ''))}
                  placeholder="100"
                />
              </div>
            </div>
            <Button
              className="w-full md:w-auto"
              disabled={busy || !login.trim() || !name.trim() || !Number(quotaLimit)}
              onClick={() => {
                onCreateUser({ login: login.trim(), name: name.trim(), quotaLimit: Number(quotaLimit) || 100 })
                setLogin('')
                setName('')
                setQuotaLimit('100')
              }}
            >
              {busy ? <LoadingSpinner label="Создаем пользователя" size="sm" /> : 'Сгенерировать доступ'}
            </Button>
          </div>

          {generatedCredentials ? (
            <div className="grid gap-2 rounded-xl border border-border bg-background p-3">
              <div className="text-sm font-semibold text-foreground">Новые доступы</div>
              <div className="text-sm text-muted-foreground">Логин: {generatedCredentials.login}</div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                <code className="text-sm text-foreground">{generatedCredentials.password}</code>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(generatedCredentials.password)}
                >
                  <CopyIcon data-icon="inline-start" />
                  Копировать
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border">
            <ScrollArea className="max-h-[42svh]">
              <div className="grid gap-2 p-3">
                {loading ? (
                  <div className="flex min-h-24 items-center justify-center">
                    <LoadingSpinner label="Загружаем пользователей" />
                  </div>
                ) : (
                  users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{user.login}</div>
                        <div className="truncate text-xs text-muted-foreground">{user.name}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs font-medium text-foreground">
                            {user.quota.limit === null ? '∞' : `${user.quota.remaining}/${user.quota.limit}`}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{user.role}</div>
                        </div>
                        {user.login !== 'vidmich' ? (
                          <Input
                            className="h-8 w-20"
                            inputMode="numeric"
                            defaultValue={String(user.quota.limit ?? 100)}
                            onBlur={(event) => {
                              const nextLimit = Number(event.target.value.replace(/[^\d]/g, '')) || 100
                              if (nextLimit !== user.quota.limit) {
                                onUpdateQuota(user.login, nextLimit)
                              }
                            }}
                          />
                        ) : null}
                        {user.login !== 'vidmich' ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => onDeleteUser(user.login)}
                            disabled={busy}
                          >
                            <Trash2Icon data-icon="inline-start" />
                            Удалить
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type StyleEditorProps = {
  busy: boolean
  onClose: () => void
  onDelete?: (styleId: string) => void
  onSubmit: (payload: EditableStylePayload) => void
  open: boolean
  style: StylePreset | null
}

function StyleEditor({
  busy,
  onClose,
  onDelete,
  onSubmit,
  open,
  style,
}: StyleEditorProps) {
  const [name, setName] = useState(style?.name ?? '')
  const [prompt, setPrompt] = useState(style?.prompt ?? '')
  const [previewFile, setPreviewFile] = useState<File | null>(null)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{style ? 'Редактировать стиль' : 'Новый стиль'}</DialogTitle>
          <DialogDescription>
            Все элементы интерфейса здесь переведены на единый shadcn-слой.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Название</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Prompt</label>
            <Textarea
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Preview</label>
            <Input
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setPreviewFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {style && onDelete ? (
            <Button variant="outline" onClick={() => onDelete(style.id)} disabled={busy}>
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              disabled={busy || !name.trim() || !prompt.trim()}
              onClick={() =>
                onSubmit({
                  id: style?.id,
                  name,
                  prompt,
                  previewFile,
                  previewUrl: style?.previewUrl,
                })
              }
            >
              {busy ? <LoadingSpinner label="Сохраняю…" size="sm" /> : 'Сохранить'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const statusLabel = (status?: GeneratedAsset['status']) => {
  switch (status) {
    case 'uploading':
      return 'Загружаем исходник в Krea'
    case 'queued':
      return 'Стоит в очереди'
    case 'processing':
    case 'sampling':
    case 'intermediate-complete':
      return 'Krea рендерит вариант'
    case 'completed':
      return 'Готово'
    case 'failed':
      return 'Ошибка'
    default:
      return 'Ожидание'
  }
}

const shortStatus = (status: GeneratedAsset['status']) => {
  switch (status) {
    case 'completed':
      return 'PNG'
    case 'failed':
      return 'ERR'
    case 'uploading':
      return 'UP'
    default:
      return '...'
  }
}

type LoadingSpinnerProps = {
  label?: string
  size?: 'sm' | 'default'
}

function LoadingSpinner({ label, size = 'default' }: LoadingSpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <LoaderCircleIcon
        className={cn('animate-spin', size === 'sm' ? 'size-3.5' : 'size-4')}
      />
      {label ? <span>{label}</span> : null}
    </span>
  )
}

export default App
