import { useEffect, useMemo, useState, useTransition } from 'react'
import { useDropzone } from 'react-dropzone'
import { DownloadIcon, PaintBucketIcon, PlusIcon, RefreshCcwIcon, Trash2Icon } from 'lucide-react'
import { zipSync, strToU8 } from 'fflate'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { clearHistory, loadHistory, saveHistory } from '@/lib/history'
import { cn } from '@/lib/utils'
import type {
  EditableStylePayload,
  GeneratedAsset,
  HistorySession,
  SourceUpload,
  StylePreset,
} from '@/types'

const MAX_FILES = 10
const STYLE_EDITOR_PASSWORD = '1337'

const newSeed = () => Math.floor(Math.random() * 4_294_967_295)

const ensureErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Что-то пошло не так'

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Не удалось подготовить PNG'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать PNG'))
    reader.readAsDataURL(blob)
  })

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
  const [selectedStyleId, setSelectedStyleId] = useState<string>('')
  const [uploads, setUploads] = useState<SourceUpload[]>([])
  const [history, setHistory] = useState<HistorySession[]>(() => loadHistory())
  const [notice, setNotice] = useState<string>('')
  const [isGenerating, startGenerating] = useTransition()
  const [isStylesBusy, startStylesMutation] = useTransition()
  const [isHydrated, setIsHydrated] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingStyle, setEditingStyle] = useState<StylePreset | null>(null)
  const [isStylesUnlocked, setIsStylesUnlocked] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [pendingStyleAction, setPendingStyleAction] = useState<StylePreset | null | 'new'>(null)

  useEffect(() => {
    void api.getStyles().then((response) => {
      setStyles(response.styles)
      setSelectedStyleId((current) => current || response.styles[0]?.id || '')
      setIsHydrated(true)
    })
  }, [])

  useEffect(() => {
    saveHistory(history)
  }, [history])

  const selectedStyle = useMemo(
    () => styles.find((style) => style.id === selectedStyleId) ?? null,
    [selectedStyleId, styles],
  )

  const onDrop = (acceptedFiles: File[]) => {
    setUploads((current) => {
      const freeSlots = Math.max(MAX_FILES - current.length, 0)
      const nextUploads = acceptedFiles.slice(0, freeSlots).map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      }))

      return [...current, ...nextUploads]
    })
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
    clearHistory()
    setHistory([])
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

  const removeBackground = (session: HistorySession) => {
    const selectedGeneration = session.generations.find(
      (generation) => generation.id === session.activeGenerationId,
    )

    if (!selectedGeneration?.resultUrl) {
      setNotice('Сначала выберите готовую генерацию.')
      return
    }

    const generationId = crypto.randomUUID()

    setHistory((current) =>
      updateSession(current, session.id, (item) => ({
        ...item,
        activeGenerationId: generationId,
        generations: [
          {
            id: generationId,
            kind: 'cutout',
            label: `Cutout ${item.generations.filter((entry) => entry.kind === 'cutout').length + 1}`,
            status: 'queued',
            sourceGenerationId: selectedGeneration.id,
            jobId: '',
            createdAt: new Date().toISOString(),
          },
          ...item.generations,
        ],
      })),
    )

    startGenerating(async () => {
      try {
        setHistory((current) =>
          updateSession(current, session.id, (item) =>
            patchGeneration(item, generationId, (generation) => ({
              ...generation,
              status: 'processing',
            })),
          ),
        )

        const { removeBackground } = await import('@imgly/background-removal')
        const blob = await removeBackground(selectedGeneration.resultUrl!, {
          output: {
            format: 'image/png',
            quality: 1,
          },
        })
        const resultUrl = await blobToDataUrl(blob)

        setHistory((current) =>
          updateSession(current, session.id, (item) =>
            patchGeneration(item, generationId, (generation) => ({
              ...generation,
              status: 'completed',
              resultUrl,
            })),
          ),
        )
      } catch (error) {
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
    if (!isStylesUnlocked) {
      setPendingStyleAction(style ?? 'new')
      setIsPasswordDialogOpen(true)
      return
    }

    setEditingStyle(style ?? null)
    setIsEditorOpen(true)
  }

  const upsertStyle = (payload: EditableStylePayload) => {
    startStylesMutation(async () => {
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
    })
  }

  const removeStyle = (styleId: string) => {
    startStylesMutation(async () => {
      await api.deleteStyle(styleId)
      setStyles((current) => current.filter((style) => style.id !== styleId))
      setSelectedStyleId((current) =>
        current === styleId ? styles.find((style) => style.id !== styleId)?.id ?? '' : current,
      )
    })
  }

  const downloadPng = async (url: string, fileName: string) => {
    const response = await fetch(url)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = fileName
    link.click()
    URL.revokeObjectURL(objectUrl)
  }

  const downloadArchive = async (session: HistorySession) => {
    const completed = session.generations.filter(
      (generation) => generation.status === 'completed' && generation.resultUrl,
    )

    if (completed.length === 0) {
      setNotice('Для скачивания нет готовых файлов.')
      return
    }

    if (completed.length === 1) {
      await downloadPng(
        completed[0].resultUrl!,
        `${session.sourceName.replace(/\.[^.]+$/, '')}-${completed[0].label}.png`,
      )
      return
    }

    const entries = await Promise.all(
      completed.map(async (generation, index) => {
        const response = await fetch(generation.resultUrl!)
        const buffer = new Uint8Array(await response.arrayBuffer())
        const safeName = `${session.sourceName.replace(/\.[^.]+$/, '')}-${index + 1}.png`
        return [safeName, buffer] as const
      }),
    )

    const archiveEntries: Record<string, Uint8Array> = {
      'README.txt': strToU8('Generated by AI Icons Studio') as Uint8Array,
    }

    for (const [fileName, bytes] of entries) {
      archiveEntries[fileName] = bytes as Uint8Array
    }

    const archive = zipSync(archiveEntries)
    const blob = new Blob([archive as BlobPart], { type: 'application/zip' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = `${session.sourceName.replace(/\.[^.]+$/, '')}-pack.zip`
    link.click()
    URL.revokeObjectURL(objectUrl)
  }

  const completedCount = (session: HistorySession) =>
    session.generations.filter(
      (generation) => generation.status === 'completed' && generation.resultUrl,
    ).length

  return (
    <div className="mx-auto flex h-[100svh] w-full max-w-[1480px] flex-col overflow-hidden p-3 md:p-4">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)_minmax(540px,2fr)]">
        <Card className="h-full min-h-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">1</Badge>
              Стиль
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-3">
            <ScrollArea className="min-h-0 flex-1 pr-2">
              <div className="flex flex-col gap-2">
                {styles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedStyleId(style.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border border-border bg-background/80 p-2 text-left transition hover:bg-muted/70',
                      style.id === selectedStyleId && 'border-secondary bg-accent/70 ring-1 ring-secondary/40',
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
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Separator />
            <div className="flex justify-center">
              <Button size="icon-sm" variant="outline" onClick={() => openStyleCreator()}>
                <PlusIcon />
                <span className="sr-only">Добавить стиль</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full min-h-0 bg-card/85 backdrop-blur-sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">2</Badge>
              Загрузка
            </CardTitle>
            <CardDescription>До 10 файлов, лучше квадратный исходник на белом фоне.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <div
              {...getRootProps()}
              className={cn(
                'flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/70 px-4 py-6 text-center transition',
                isDragActive && 'border-secondary bg-accent/60',
              )}
            >
              <input {...getInputProps()} />
              <div className="text-sm font-semibold text-foreground">Перетащите файлы сюда</div>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPG или WebP</p>
            </div>

            <ScrollArea className="min-h-0 flex-1 pr-2">
              <div className="grid gap-2">
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
          <CardFooter className="mt-auto flex-col gap-2">
            <Button
              className="w-full"
              disabled={!isHydrated || isGenerating || uploads.length === 0}
              onClick={handleGenerate}
            >
              {isGenerating ? 'Генерация идет…' : 'Сгенерировать'}
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
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">3</Badge>
              Результат
            </CardTitle>
            <CardAction>
              <Button size="sm" variant="outline" onClick={clearHistoryState}>
                <Trash2Icon data-icon="inline-start" />
                Очистить
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 px-3">
            <ScrollArea className="h-full pr-2">
              <div className="flex flex-col gap-3">
                {history.map((session) => {
                  const activeGeneration =
                    session.generations.find(
                      (generation) => generation.id === session.activeGenerationId,
                    ) ?? session.generations[0]
                  const previewGeneration =
                    session.generations.find(
                      (generation) =>
                        generation.id === session.activeGenerationId && generation.resultUrl,
                    ) ??
                    session.generations.find((generation) => generation.resultUrl) ??
                    activeGeneration

                  return (
                    <Card key={session.id} size="sm" className="bg-background/85 py-3">
                      <CardHeader className="gap-3">
                        <div className="flex items-start gap-3">
                          <img
                            src={previewGeneration?.resultUrl ?? session.sourcePreviewUrl}
                            alt={session.sourceName}
                            className="size-24 rounded-lg object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {session.sourceName}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{session.styleName}</p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {activeGeneration?.error ?? statusLabel(activeGeneration?.status)}
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
                                  'border-secondary bg-accent/70 ring-1 ring-secondary/40',
                              )}
                            >
                              <div className="relative mb-2 overflow-hidden rounded-lg bg-background">
                                {generation.resultUrl ? (
                                  <Button
                                    size="icon-xs"
                                    variant="secondary"
                                    className="absolute top-1 right-1 z-10"
                                    onClick={() =>
                                      void downloadPng(
                                        generation.resultUrl!,
                                        `${session.sourceName.replace(/\.[^.]+$/, '')}-${generation.label}.png`,
                                      )
                                    }
                                  >
                                    <DownloadIcon />
                                    <span className="sr-only">Скачать PNG</span>
                                  </Button>
                                ) : null}
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
                                  {generation.resultUrl ? (
                                    <img
                                      src={generation.resultUrl}
                                      alt={generation.label}
                                      className="aspect-square w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex aspect-square items-center justify-center text-xs font-semibold text-muted-foreground">
                                      {shortStatus(generation.status)}
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
                            </div>
                          ))}
                        </div>
                      </CardContent>
                      <CardFooter className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => reroll(session)}>
                          <RefreshCcwIcon data-icon="inline-start" />
                          Новый seed
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => removeBackground(session)}>
                          <PaintBucketIcon data-icon="inline-start" />
                          Обтравить
                        </Button>
                        {completedCount(session) > 1 ? (
                          <Button size="sm" onClick={() => void downloadArchive(session)}>
                            <DownloadIcon data-icon="inline-start" />
                            Скачать архив
                          </Button>
                        ) : null}
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
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

      <PasswordDialog
        key={`${String(pendingStyleAction ?? 'none')}-${isPasswordDialogOpen ? 'open' : 'closed'}`}
        open={isPasswordDialogOpen}
        onClose={() => {
          setIsPasswordDialogOpen(false)
          setPendingStyleAction(null)
        }}
        onSuccess={() => {
          setIsStylesUnlocked(true)
          setIsPasswordDialogOpen(false)

          if (pendingStyleAction === 'new') {
            setEditingStyle(null)
            setIsEditorOpen(true)
          } else if (pendingStyleAction) {
            setEditingStyle(pendingStyleAction)
            setIsEditorOpen(true)
          }

          setPendingStyleAction(null)
        }}
      />
    </div>
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
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type PasswordDialogProps = {
  onClose: () => void
  onSuccess: () => void
  open: boolean
}

function PasswordDialog({ onClose, onSuccess, open }: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Доступ к стилям</DialogTitle>
          <DialogDescription>
            Для добавления и редактирования стилей введите пароль.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (error) {
                setError('')
              }
            }}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (password === STYLE_EDITOR_PASSWORD) {
                onSuccess()
                return
              }

              setError('Неверный пароль')
            }}
          >
            Войти
          </Button>
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

export default App
