import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'

import { defaultStylePreviews } from './default-style-previews'

type HttpEvent = {
  httpMethod?: string
  path?: string
  body?: string | null
  headers?: Record<string, string | undefined>
  isBase64Encoded?: boolean
  queryStringParameters?: Record<string, string | undefined>
}

type StylePreset = {
  id: string
  name: string
  prompt: string
  shortPrompt: string
  previewUrl: string
  createdAt: string
  updatedAt: string
}

const isDefaultPreviewPath = (value: string) => value.startsWith('/previews/')

const getEmbeddedDefaultPreview = (styleId: string) => {
  switch (styleId) {
    case 'frosted-glow':
      return defaultStylePreviews.frostedGlow
    case 'soft-silicone':
      return defaultStylePreviews.softSilicone
    case 'frosted-vibrant':
      return defaultStylePreviews.frostedVibrant
    case 'gel-silicone':
      return defaultStylePreviews.gelSilicone
    case 'embossed-rubber':
      return defaultStylePreviews.embossedRubber
    default:
      return defaultStylePreviews.frostedGlow
  }
}

const defaultStyles: StylePreset[] = [
  {
    id: 'frosted-glow',
    name: 'Frosted Glow',
    prompt:
      'translucent colored frosted glass material, subtle subsurface scattering, soft edge glow, smooth gradient lighting, minimal studio render, soft volumetric illumination, clean CGI aesthetic, black background, bright color from reference',
    shortPrompt: 'Glass, glow, black backdrop',
    previewUrl: defaultStylePreviews.frostedGlow,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'soft-silicone',
    name: 'Soft Silicone',
    prompt:
      'soft matte silicone rubber material, smooth tactile surface, minimal industrial design, colors from reference bright, clear white background without shadows',
    shortPrompt: 'Matte silicone on white',
    previewUrl: defaultStylePreviews.softSilicone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'frosted-vibrant',
    name: 'Frosted Vibrant',
    prompt:
      'translucent frosted glass material, diffusion, elegant minimal object aesthetic, same colors from reference, vibrant',
    shortPrompt: 'Minimal vibrant glass',
    previewUrl: defaultStylePreviews.frostedVibrant,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'gel-silicone',
    name: 'Gel Silicone',
    prompt:
      'transparent gel silicone material, thick soft gel texture, internal light reflections, flat white background, frontal view, studio lightning',
    shortPrompt: 'Transparent gel texture',
    previewUrl: defaultStylePreviews.gelSilicone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'embossed-rubber',
    name: 'Embossed Rubber',
    prompt:
      'minimal embossed rubber icon style, matte black silicone material, subtle micro texture, deep debossed logo engraving, soft diffused studio lighting, industrial product photography, monochrome palette, tactile rubber surface, centered composition on neutral background, premium minimal tech aesthetic, high-detail 3D render',
    shortPrompt: 'Premium matte black rubber',
    previewUrl: defaultStylePreviews.embossedRubber,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

const stylesManifestKey = 'config/styles.json'

const generationSchema = z.object({
  imageUrl: z.url(),
  styleId: z.string().min(1),
  seed: z.number().int().nonnegative(),
})

const envSchema = z.object({
  KREA_API_TOKEN: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_REGION: z.string().default('ru-central1'),
  STORAGE_ENDPOINT: z.string().default('https://storage.yandexcloud.net'),
  STORAGE_PUBLIC_BASE_URL: z.string().default(''),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
}

const getEnv = () =>
  envSchema.parse({
    KREA_API_TOKEN: process.env.KREA_API_TOKEN,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET,
    STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY,
    STORAGE_REGION: process.env.STORAGE_REGION,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
    STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
  })

const getStorageClient = () => {
  const env = getEnv()

  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY,
      secretAccessKey: env.STORAGE_SECRET_KEY,
    },
  })
}

const response = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const binaryResponse = (
  statusCode: number,
  body: Buffer,
  options: {
    contentType: string
    fileName?: string
  },
) => ({
  statusCode,
  headers: {
    ...corsHeaders,
    'Content-Type': options.contentType,
    ...(options.fileName
      ? {
          'Content-Disposition': `attachment; filename="${options.fileName.replace(/"/g, '')}"`,
        }
      : {}),
  },
  body: body.toString('base64'),
  isBase64Encoded: true,
})

const streamToString = async (
  stream: NodeJS.ReadableStream | ReadableStream<Uint8Array> | Blob | undefined,
) => {
  if (!stream) {
    return ''
  }

  if ('transformToString' in stream && typeof stream.transformToString === 'function') {
    return stream.transformToString()
  }

  if ('text' in stream && typeof stream.text === 'function') {
    return stream.text()
  }

  const chunks: Uint8Array[] = []

  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf-8')
}

const readStyles = async (): Promise<StylePreset[]> => {
  const env = getEnv()
  const client = getStorageClient()

  try {
    const data = await client.send(
      new GetObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: stylesManifestKey,
      }),
    )

    const text = await streamToString(data.Body)
    const styles = z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        prompt: z.string(),
        shortPrompt: z.string(),
        previewUrl: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ).parse(JSON.parse(text))

    const migratedStyles = styles.map((style) =>
      isDefaultPreviewPath(style.previewUrl)
        ? {
            ...style,
            previewUrl: getEmbeddedDefaultPreview(style.id),
          }
        : style,
    )

    if (migratedStyles.some((style, index) => style.previewUrl !== styles[index]?.previewUrl)) {
      await writeStyles(migratedStyles)
    }

    return migratedStyles
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode !== 404) {
      console.error(error)
    }

    await writeStyles(defaultStyles)
    return defaultStyles
  }
}

const writeStyles = async (styles: StylePreset[]) => {
  const env = getEnv()
  const client = getStorageClient()

  await client.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: stylesManifestKey,
      Body: JSON.stringify(styles, null, 2),
      ContentType: 'application/json',
    }),
  )
}

const uploadPreview = async (file: File) => {
  const env = getEnv()
  const client = getStorageClient()
  const extension = file.name.split('.').pop() || 'png'
  const objectKey = `style-previews/${crypto.randomUUID()}.${extension}`

  await client.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type || 'image/png',
    }),
  )

  const base = env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')
  return base
    ? `${base}/${objectKey}`
    : `https://storage.yandexcloud.net/${env.STORAGE_BUCKET}/${objectKey}`
}

const buildRequest = (event: HttpEvent) => {
  const headers = new Headers()

  Object.entries(event.headers ?? {}).forEach(([key, value]) => {
    if (value) {
      headers.set(key, value)
    }
  })

  const searchParams = new URLSearchParams()

  Object.entries(event.queryStringParameters ?? {}).forEach(([key, value]) => {
    if (typeof value === 'string') {
      searchParams.set(key, value)
    }
  })

  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body
    : undefined

  const query = searchParams.toString()

  return new Request(`https://internal${event.path ?? '/'}${query ? `?${query}` : ''}`, {
    method: event.httpMethod,
    headers,
    body: body as BodyInit | undefined,
  })
}

const uploadAssetToKrea = async (file: File) => {
  const env = getEnv()
  const formData = new FormData()
  formData.set('file', file)

  const result = await fetch('https://api.krea.ai/assets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.KREA_API_TOKEN}`,
    },
    body: formData,
  })

  if (!result.ok) {
    throw new Error(`Krea asset upload failed with ${result.status}`)
  }

  const payload = (await result.json()) as { image_url: string }
  return payload.image_url
}

const requestKreaJob = async (path: string, payload: Record<string, unknown>) => {
  const env = getEnv()

  const result = await fetch(`https://api.krea.ai${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.KREA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!result.ok) {
    const text = await result.text()
    throw new Error(text || `Krea request failed with ${result.status}`)
  }

  const data = (await result.json()) as {
    job_id: string
    status: string
  }

  return {
    jobId: data.job_id,
    status: data.status,
  }
}

const getJob = async (jobId: string) => {
  const env = getEnv()

  const result = await fetch(`https://api.krea.ai/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${env.KREA_API_TOKEN}`,
    },
  })

  if (!result.ok) {
    throw new Error(`Krea job lookup failed with ${result.status}`)
  }

  const data = (await result.json()) as {
    status: string
    error?: string
    result?: { urls?: string[] }
  }

  return {
    status: data.status,
    error: data.error,
    resultUrl: data.result?.urls?.[0],
  }
}

const downloadRemoteAsset = async (assetUrl: string) => {
  const target = new URL(assetUrl)

  if (target.protocol !== 'https:') {
    throw new Error('Only https download URLs are allowed')
  }

  const result = await fetch(target)

  if (!result.ok) {
    throw new Error(`Asset download failed with ${result.status}`)
  }

  const arrayBuffer = await result.arrayBuffer()

  return {
    body: Buffer.from(arrayBuffer),
    contentType: result.headers.get('content-type') || 'application/octet-stream',
  }
}

export const handler = async (event: HttpEvent) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: '',
      }
    }

    const path = event.path ?? '/'
    const request = buildRequest(event)

    if (event.httpMethod === 'GET' && path === '/styles') {
      const styles = await readStyles()
      return response(200, { styles })
    }

    if (event.httpMethod === 'POST' && path === '/styles') {
      const formData = await request.formData()
      const styles = await readStyles()
      const file = formData.get('previewFile')
      const name = String(formData.get('name') ?? '').trim()
      const prompt = String(formData.get('prompt') ?? '').trim()

      if (!name || !prompt) {
        return response(400, { error: 'name and prompt are required' })
      }

      const previewUrl =
        file instanceof File ? await uploadPreview(file) : defaultStylePreviews.frostedGlow
      const now = new Date().toISOString()

      const style: StylePreset = {
        id: crypto.randomUUID(),
        name,
        prompt,
        shortPrompt: prompt.slice(0, 42),
        previewUrl,
        createdAt: now,
        updatedAt: now,
      }

      await writeStyles([style, ...styles])
      return response(200, style)
    }

    if (event.httpMethod === 'PUT' && path.startsWith('/styles/')) {
      const styleId = path.split('/').pop() ?? ''
      const formData = await request.formData()
      const styles = await readStyles()
      const file = formData.get('previewFile')
      const previewUrlField = String(formData.get('previewUrl') ?? '')
      const name = String(formData.get('name') ?? '').trim()
      const prompt = String(formData.get('prompt') ?? '').trim()

      const current = styles.find((style) => style.id === styleId)
      if (!current) {
        return response(404, { error: 'Style not found' })
      }

      const nextStyle: StylePreset = {
        ...current,
        name,
        prompt,
        shortPrompt: prompt.slice(0, 42),
        previewUrl:
          file instanceof File
            ? await uploadPreview(file)
            : previewUrlField || current.previewUrl,
        updatedAt: new Date().toISOString(),
      }

      await writeStyles(styles.map((style) => (style.id === styleId ? nextStyle : style)))
      return response(200, nextStyle)
    }

    if (event.httpMethod === 'DELETE' && path.startsWith('/styles/')) {
      const styleId = path.split('/').pop() ?? ''
      const styles = await readStyles()
      const current = styles.find((style) => style.id === styleId)

      if (!current) {
        return response(404, { error: 'Style not found' })
      }

      await writeStyles(styles.filter((style) => style.id !== styleId))

      if (current.previewUrl.includes('/style-previews/')) {
        const env = getEnv()
        const client = getStorageClient()
        const objectKey = current.previewUrl.split(`${env.STORAGE_BUCKET}/`).pop()

        if (objectKey) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: env.STORAGE_BUCKET,
              Key: objectKey,
            }),
          )
        }
      }

      return response(200, { ok: true })
    }

    if (event.httpMethod === 'POST' && path === '/assets') {
      const formData = await request.formData()
      const file = formData.get('file')

      if (!(file instanceof File)) {
        return response(400, { error: 'file is required' })
      }

      const imageUrl = await uploadAssetToKrea(file)
      return response(200, { imageUrl })
    }

    if (event.httpMethod === 'POST' && path === '/generations') {
      const styles = await readStyles()
      const payload = generationSchema.parse(await request.json())
      const style = styles.find((entry) => entry.id === payload.styleId)

      if (!style) {
        return response(404, { error: 'Style not found' })
      }

      const job = await requestKreaJob('/generate/image/bytedance/seededit', {
        prompt: style.prompt,
        imageUrl: payload.imageUrl,
        seed: payload.seed,
        batchSize: 1,
      })

      return response(200, job)
    }

    if (event.httpMethod === 'GET' && path.startsWith('/jobs/')) {
      const jobId = path.split('/').pop() ?? ''
      const job = await getJob(jobId)
      return response(200, job)
    }

    if (event.httpMethod === 'GET' && path === '/download') {
      const url = request.url ? new URL(request.url).searchParams.get('url') : null
      const fileName = request.url ? new URL(request.url).searchParams.get('fileName') : null

      if (!url) {
        return response(400, { error: 'url is required' })
      }

      const asset = await downloadRemoteAsset(url)
      return binaryResponse(200, asset.body, {
        contentType: asset.contentType,
        fileName: fileName ?? undefined,
      })
    }

    return response(404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return response(500, {
      error: error instanceof Error ? error.message : 'Internal error',
    })
  }
}
