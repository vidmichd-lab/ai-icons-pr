import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useDropzone } from 'react-dropzone'
import { clsx } from 'clsx'
import { zipSync, strToU8 } from 'fflate'

import './App.css'
import { api } from './lib/api'
import { clearHistory, loadHistory, saveHistory } from './lib/history'
import type {
  EditableStylePayload,
  GeneratedAsset,
  HistorySession,
  SourceUpload,
  StylePreset,
} from './types'

const MAX_FILES = 10

const newSeed = () => Math.floor(Math.random() * 4_294_967_295)

const ensureErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Что-то пошло не так'

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
      const alreadySelected = current.length
      const freeSlots = Math.max(MAX_FILES - alreadySelected, 0)
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
        const response = await api.createCutout({
          imageUrl: selectedGeneration.resultUrl!,
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

  const clearHistoryState = () => {
    clearHistory()
    setHistory([])
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

  const openStyleCreator = (style?: StylePreset) => {
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

  return (
    <div className="app-shell">
      <section className="workspace-grid workspace-grid--triple">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="panel column-panel column-panel--styles"
        >
          <div className="panel-head">
            <div>
              <span className="panel-kicker">1. Пресеты</span>
            </div>
            <button
              className="ghost-button"
              onClick={() => openStyleCreator()}
              type="button"
            >
              Добавить
            </button>
          </div>

          <div className="style-grid style-grid--column">
            {styles.map((style) => (
              <button
                key={style.id}
                className={clsx(
                  'style-card',
                  style.id === selectedStyleId && 'style-card--selected',
                )}
                type="button"
                onClick={() => setSelectedStyleId(style.id)}
              >
                <img src={style.previewUrl} alt={style.name} />
                <div className="style-card__meta">
                  <strong>{style.name}</strong>
                  <span>{style.shortPrompt}</span>
                </div>
                <div className="style-card__actions">
                  <span>{style.id === selectedStyleId ? 'Выбран' : 'Выбрать'}</span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation()
                      openStyleCreator(style)
                    }}
                  >
                    Редактировать
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="style-footer">
            <div>
              <strong>{selectedStyle?.name ?? 'Стиль не выбран'}</strong>
              <p>{selectedStyle?.prompt}</p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.04 }}
          className="panel column-panel"
        >
          <div className="panel-head">
            <div>
              <span className="panel-kicker">2. Drag and Drop</span>
            </div>
            <button className="ghost-button" onClick={clearUploads} type="button">
              Очистить
            </button>
          </div>

          <div
            {...getRootProps()}
            className={clsx('dropzone', isDragActive && 'dropzone--active')}
          >
            <input {...getInputProps()} />
            <strong>Перетащите PNG, JPG или WebP</strong>
            <span>до 10 файлов, квадратный исходник на белом фоне</span>
          </div>

          <div className="upload-grid upload-grid--column">
            {uploads.map((upload) => (
              <article key={upload.id} className="upload-card">
                <img src={upload.previewUrl} alt={upload.name} />
                <div>
                  <strong>{upload.name}</strong>
                  <span>готов к отправке</span>
                </div>
              </article>
            ))}
          </div>

          <div className="upload-actions">
            <button
              className="primary-button primary-button--wide"
              disabled={!isHydrated || isGenerating || uploads.length === 0}
              onClick={handleGenerate}
              type="button"
            >
              {isGenerating ? 'Генерация идет…' : 'Сгенерировать'}
            </button>
          </div>
        </motion.div>

        <motion.aside
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="panel column-panel column-panel--results sticky-panel"
        >
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Результат</span>
            </div>
            <button className="ghost-button" onClick={clearHistoryState} type="button">
              Очистить
            </button>
          </div>

          <div className="history-stack">
            {history.map((session) => {
              const activeGeneration =
                session.generations.find(
                  (generation) => generation.id === session.activeGenerationId,
                ) ?? session.generations[0]

              return (
                <article key={session.id} className="history-card">
                  <div className="history-card__top">
                    <img
                      src={activeGeneration?.resultUrl ?? session.sourcePreviewUrl}
                      alt={session.sourceName}
                    />
                    <div>
                      <strong>{session.sourceName}</strong>
                      <span>{session.styleName}</span>
                      <p>{activeGeneration?.error ?? statusLabel(activeGeneration?.status)}</p>
                    </div>
                  </div>

                  <div className="history-thumbs">
                    {session.generations.map((generation) => (
                      <button
                        key={generation.id}
                        type="button"
                        className={clsx(
                          'thumb-button',
                          generation.id === session.activeGenerationId &&
                            'thumb-button--active',
                        )}
                        onClick={() =>
                          setHistory((current) =>
                            updateSession(current, session.id, (item) => ({
                              ...item,
                              activeGenerationId: generation.id,
                            })),
                          )
                        }
                      >
                        <div className="thumb-button__image">
                          {generation.resultUrl ? (
                            <img src={generation.resultUrl} alt={generation.label} />
                          ) : (
                            <span>{shortStatus(generation.status)}</span>
                          )}
                        </div>
                        <small>{generation.label}</small>
                      </button>
                    ))}
                  </div>

                  <div className="history-actions">
                    <button
                      className="ghost-button"
                      onClick={() => reroll(session)}
                      type="button"
                    >
                      Новый seed
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => removeBackground(session)}
                      type="button"
                    >
                      Обтравить
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void downloadArchive(session)}
                      type="button"
                    >
                      Скачать
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </motion.aside>
      </section>

      <AnimatePresence>
        {notice ? (
          <motion.div
            className="notice"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isEditorOpen ? (
          <StyleEditor
            busy={isStylesBusy}
            onClose={() => {
              setIsEditorOpen(false)
              setEditingStyle(null)
            }}
            onDelete={editingStyle ? removeStyle : undefined}
            onSubmit={upsertStyle}
            style={editingStyle}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

type StyleEditorProps = {
  busy: boolean
  onClose: () => void
  onDelete?: (styleId: string) => void
  onSubmit: (payload: EditableStylePayload) => void
  style: StylePreset | null
}

function StyleEditor({
  busy,
  onClose,
  onDelete,
  onSubmit,
  style,
}: StyleEditorProps) {
  const [name, setName] = useState(style?.name ?? '')
  const [prompt, setPrompt] = useState(style?.prompt ?? '')
  const [previewFile, setPreviewFile] = useState<File | null>(null)

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="modal"
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 32 }}
      >
        <div className="panel-head">
          <div>
            <span className="panel-kicker">Style editor</span>
            <h2>{style ? 'Редактировать стиль' : 'Новый стиль'}</h2>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Закрыть
          </button>
        </div>

        <label className="field">
          <span>Название</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="field">
          <span>Prompt</span>
          <textarea
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Preview PNG</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => setPreviewFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>

        <div className="history-actions">
          {style && onDelete ? (
            <button
              className="ghost-button ghost-button--danger"
              disabled={busy}
              onClick={() => onDelete(style.id)}
              type="button"
            >
              Удалить
            </button>
          ) : null}
          <button
            className="primary-button"
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
            type="button"
          >
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
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
