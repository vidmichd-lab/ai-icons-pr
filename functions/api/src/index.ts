import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
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

type AuthorizerEvent = {
  resource?: string
  path?: string
  httpMethod?: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  pathParameters?: Record<string, string | undefined>
  requestContext?: {
    authorizer?: Record<string, unknown>
  }
  cookies?: Record<string, string | undefined>
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

type AuthRole = 'admin' | 'manager'

type StoredUser = {
  id: string
  login: string
  name: string
  role: AuthRole
  passwordHash: string
  passwordSalt: string
  disabled: boolean
  createdAt: string
  updatedAt: string
}

type SessionRecord = {
  id: string
  userId: string
  login: string
  role: AuthRole
  createdAt: string
  expiresAt: string
}

type UsageManifest = {
  period: string
  users: Record<string, number>
}

type GenerationQuota = {
  limit: number
  used: number
  remaining: number
  period: string
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
const usersManifestKey = 'auth/users.json'
const sessionsPrefix = 'auth/sessions'
const usagePrefix = 'auth/usage'
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7
const monthlyGenerationLimit = 100
const rootAdminLogin = 'vidmich'

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
  APP_ORIGIN: z.string().url(),
  AUTH_SESSION_COOKIE: z.string().default('ai_icons_session'),
  AUTH_BOOTSTRAP_LOGIN: z.string().min(1),
  AUTH_BOOTSTRAP_PASSWORD: z.string().min(8),
})

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
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
    APP_ORIGIN: process.env.APP_ORIGIN,
    AUTH_SESSION_COOKIE: process.env.AUTH_SESSION_COOKIE,
    AUTH_BOOTSTRAP_LOGIN: process.env.AUTH_BOOTSTRAP_LOGIN,
    AUTH_BOOTSTRAP_PASSWORD: process.env.AUTH_BOOTSTRAP_PASSWORD,
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

const getCorsHeaders = () => ({
  'Access-Control-Allow-Origin': getEnv().APP_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true',
})

const response = (
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) => ({
  statusCode,
  headers: {
    ...getCorsHeaders(),
    ...noStoreHeaders,
    'Content-Type': 'application/json',
    ...extraHeaders,
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
    ...getCorsHeaders(),
    ...noStoreHeaders,
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

const readStorageText = async (key: string) => {
  const env = getEnv()
  const client = getStorageClient()

  const data = await client.send(
    new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
    }),
  )

  return streamToString(data.Body)
}

const writeStorageText = async (key: string, body: string, contentType = 'application/json') => {
  const env = getEnv()
  const client = getStorageClient()

  await client.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

const hashPassword = (password: string, salt: string) =>
  scryptSync(password, salt, 64).toString('hex')

const verifyPassword = (password: string, salt: string, expectedHash: string) => {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  if (actual.length !== expected.length) {
    return false
  }

  return timingSafeEqual(actual, expected)
}

const currentUsagePeriod = () => new Date().toISOString().slice(0, 7)

const usageObjectKey = (period: string) => `${usagePrefix}/${period}.json`

const buildQuota = (used: number, period = currentUsagePeriod()): GenerationQuota => ({
  limit: monthlyGenerationLimit,
  used,
  remaining: Math.max(monthlyGenerationLimit - used, 0),
  period,
})

const isRootAdmin = (user: StoredUser) => user.login === rootAdminLogin

const randomPassword = (length = 24) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(length)

  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

const normalizeLogin = (value: string) => value.trim().toLowerCase()

const createSessionCookie = (token: string, expiresAt: string) => {
  const env = getEnv()
  return `${env.AUTH_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Expires=${new Date(expiresAt).toUTCString()}`
}

const clearSessionCookie = () => {
  const env = getEnv()
  return `${env.AUTH_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

const getCookieValue = (headers?: Record<string, string | undefined>, cookieName?: string) => {
  const name = cookieName ?? getEnv().AUTH_SESSION_COOKIE
  const cookieHeader = headers?.cookie ?? headers?.Cookie

  if (!cookieHeader) {
    return null
  }

  const parts = cookieHeader.split(';').map((part) => part.trim())
  const match = parts.find((part) => part.startsWith(`${name}=`))

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

const sessionObjectKey = (sessionId: string) => `${sessionsPrefix}/${sessionId}.json`

const readUsers = async (): Promise<StoredUser[]> => {
  try {
    const raw = await readStorageText(usersManifestKey)

    return z.array(
      z.object({
        id: z.string(),
        login: z.string(),
        name: z.string(),
        role: z.enum(['admin', 'manager']),
        passwordHash: z.string(),
        passwordSalt: z.string(),
        disabled: z.boolean(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ).parse(JSON.parse(raw))
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode

    if (statusCode === 404) {
      const now = new Date().toISOString()
      const salt = randomBytes(16).toString('hex')
      const env = getEnv()
      const bootstrapUser: StoredUser = {
        id: crypto.randomUUID(),
        login: env.AUTH_BOOTSTRAP_LOGIN,
        name: 'Admin',
        role: 'admin',
        passwordHash: hashPassword(env.AUTH_BOOTSTRAP_PASSWORD, salt),
        passwordSalt: salt,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      }

      await writeUsers([bootstrapUser])
      return [bootstrapUser]
    }

    throw error
  }
}

const writeUsers = async (users: StoredUser[]) => {
  await writeStorageText(usersManifestKey, JSON.stringify(users, null, 2))
}

const readUsage = async (period = currentUsagePeriod()): Promise<UsageManifest> => {
  try {
    const raw = await readStorageText(usageObjectKey(period))

    return z.object({
      period: z.string(),
      users: z.record(z.string(), z.number().int().nonnegative()),
    }).parse(JSON.parse(raw))
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
    if (statusCode === 404) {
      return { period, users: {} }
    }

    throw error
  }
}

const writeUsage = async (usage: UsageManifest) => {
  await writeStorageText(usageObjectKey(usage.period), JSON.stringify(usage, null, 2))
}

const getUserQuota = async (user: StoredUser) => {
  const usage = await readUsage()
  return buildQuota(usage.users[user.login] ?? 0, usage.period)
}

const reserveGenerationQuota = async (user: StoredUser) => {
  const usage = await readUsage()
  const used = usage.users[user.login] ?? 0

  if (used >= monthlyGenerationLimit) {
    return {
      ok: false as const,
      quota: buildQuota(used, usage.period),
    }
  }

  const nextUsage: UsageManifest = {
    ...usage,
    users: {
      ...usage.users,
      [user.login]: used + 1,
    },
  }

  await writeUsage(nextUsage)

  return {
    ok: true as const,
    quota: buildQuota(used + 1, usage.period),
  }
}

const toPublicUser = async (user: StoredUser) => ({
  id: user.id,
  login: user.login,
  name: user.name,
  role: user.role,
  quota: await getUserQuota(user),
})

const toManagedUser = async (user: StoredUser) => ({
  id: user.id,
  login: user.login,
  name: user.name,
  role: user.role,
  disabled: user.disabled,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  quota: await getUserQuota(user),
})

const readSession = async (sessionId: string): Promise<SessionRecord | null> => {
  try {
    const raw = await readStorageText(sessionObjectKey(sessionId))
    const session = z.object({
      id: z.string(),
      userId: z.string(),
      login: z.string(),
      role: z.enum(['admin', 'manager']),
      createdAt: z.string(),
      expiresAt: z.string(),
    }).parse(JSON.parse(raw))

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      const env = getEnv()
      const client = getStorageClient()

      await client.send(
        new DeleteObjectCommand({
          Bucket: env.STORAGE_BUCKET,
          Key: sessionObjectKey(sessionId),
        }),
      )

      return null
    }

    return session
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
    if (statusCode === 404) {
      return null
    }

    throw error
  }
}

const writeSession = async (session: SessionRecord) => {
  await writeStorageText(sessionObjectKey(session.id), JSON.stringify(session, null, 2))
}

const deleteSession = async (sessionId: string) => {
  const env = getEnv()
  const client = getStorageClient()

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: sessionObjectKey(sessionId),
    }),
  )
}

const getCurrentUser = async (headers?: Record<string, string | undefined>) => {
  const sessionId = getCookieValue(headers)
  if (!sessionId) {
    return null
  }

  const session = await readSession(sessionId)
  if (!session) {
    return null
  }

  const users = await readUsers()
  const user = users.find((entry) => entry.id === session.userId && !entry.disabled)

  if (!user) {
    return null
  }

  return {
    sessionId,
    session,
    user,
  }
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
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode

    if (statusCode === 404) {
      await writeStyles(defaultStyles)
      return defaultStyles
    }

    console.error('Failed to read styles manifest without resetting defaults', error)
    throw error
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

  if (target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('Only safe https download URLs are allowed')
  }

  const hostname = target.hostname.toLowerCase()

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Local download URLs are not allowed')
  }

  const privateRanges = [
    /^10\./,
    /^127\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^192\.168\./,
  ]

  const isBlockedAddress = (value: string) => {
    if (value === '::1' || value.toLowerCase().startsWith('fe80:') || value.toLowerCase().startsWith('fc') || value.toLowerCase().startsWith('fd')) {
      return true
    }

    if (isIP(value) !== 4) {
      return false
    }

    return privateRanges.some((pattern) => pattern.test(value))
  }

  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw new Error('Private download URLs are not allowed')
  }

  const resolved = await lookup(hostname, { all: true })

  if (resolved.length === 0 || resolved.some((entry) => isBlockedAddress(entry.address))) {
    throw new Error('Resolved download host is not allowed')
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

const isAuthorizerEvent = (event: HttpEvent | AuthorizerEvent): event is AuthorizerEvent =>
  'resource' in event && !('body' in event)

const authorizerHandler = async (event: AuthorizerEvent) => {
  const sessionId =
    event.cookies?.[getEnv().AUTH_SESSION_COOKIE] ??
    getCookieValue(event.headers)

  if (!sessionId) {
    return { isAuthorized: false }
  }

  const session = await readSession(sessionId)
  if (!session) {
    return { isAuthorized: false }
  }

  const users = await readUsers()
  const user = users.find((entry) => entry.id === session.userId && !entry.disabled)

  if (!user) {
    return { isAuthorized: false }
  }

  return {
    isAuthorized: true,
    context: {
      userId: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
    },
  }
}

const appHandler = async (event: HttpEvent) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          ...getCorsHeaders(),
          ...noStoreHeaders,
        },
        body: '',
      }
    }

    const path = event.path ?? '/'
    const request = buildRequest(event)
    const currentUser = await getCurrentUser(event.headers)
    const isProtectedRoute =
      path === '/styles' ||
      path.startsWith('/styles/') ||
      path === '/assets' ||
      path === '/generations' ||
      path.startsWith('/jobs/') ||
      path === '/download' ||
      path === '/admin/users'

    if (isProtectedRoute && !currentUser) {
      return response(
        401,
        { error: 'Не авторизован' },
        { 'Set-Cookie': clearSessionCookie() },
      )
    }

    if (event.httpMethod === 'POST' && path === '/auth/login') {
      const payload = z.object({
        login: z.string().min(1),
        password: z.string().min(1),
      }).parse(await request.json())

      const users = await readUsers()
      const user = users.find(
        (entry) => entry.login === normalizeLogin(payload.login) && !entry.disabled,
      )

      if (!user || !verifyPassword(payload.password, user.passwordSalt, user.passwordHash)) {
        return response(401, { error: 'Неверный логин или пароль' })
      }

      const now = Date.now()
      const session: SessionRecord = {
        id: randomBytes(32).toString('hex'),
        userId: user.id,
        login: user.login,
        role: user.role,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + sessionTtlMs).toISOString(),
      }

      await writeSession(session)

      return response(
        200,
        {
          user: await toPublicUser(user),
        },
        {
          'Set-Cookie': createSessionCookie(session.id, session.expiresAt),
        },
      )
    }

    if (event.httpMethod === 'GET' && path === '/auth/me') {
      if (!currentUser) {
        return response(
          401,
          { error: 'Не авторизован' },
          { 'Set-Cookie': clearSessionCookie() },
        )
      }

      return response(200, {
        user: await toPublicUser(currentUser.user),
      })
    }

    if (event.httpMethod === 'POST' && path === '/auth/logout') {
      if (currentUser?.sessionId) {
        await deleteSession(currentUser.sessionId).catch(() => undefined)
      }

      return response(
        200,
        { ok: true },
        { 'Set-Cookie': clearSessionCookie() },
      )
    }

    if (event.httpMethod === 'GET' && path === '/styles') {
      const styles = await readStyles()
      return response(200, { styles })
    }

    if (event.httpMethod === 'POST' && path === '/styles') {
      if (!currentUser || !isRootAdmin(currentUser.user)) {
        return response(403, { error: 'Недостаточно прав' })
      }

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
      if (!currentUser || !isRootAdmin(currentUser.user)) {
        return response(403, { error: 'Недостаточно прав' })
      }

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
      if (!currentUser || !isRootAdmin(currentUser.user)) {
        return response(403, { error: 'Недостаточно прав' })
      }

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

    if (event.httpMethod === 'GET' && path === '/admin/users') {
      if (!currentUser || !isRootAdmin(currentUser.user)) {
        return response(403, { error: 'Недостаточно прав' })
      }

      const users = await readUsers()
      const visibleUsers = await Promise.all(
        users
          .filter((user) => !user.disabled)
          .sort((left, right) => left.login.localeCompare(right.login))
          .map((user) => toManagedUser(user)),
      )

      return response(200, { users: visibleUsers })
    }

    if (event.httpMethod === 'POST' && path === '/admin/users') {
      if (!currentUser || !isRootAdmin(currentUser.user)) {
        return response(403, { error: 'Недостаточно прав' })
      }

      const payload = z.object({
        login: z.string().min(3).max(64).regex(/^[a-z0-9._-]+$/),
        name: z.string().min(1).max(120),
      }).parse(await request.json())

      const login = normalizeLogin(payload.login)
      const users = await readUsers()

      if (users.some((user) => user.login === login && !user.disabled)) {
        return response(409, { error: 'Пользователь с таким логином уже существует' })
      }

      const now = new Date().toISOString()
      const password = randomPassword()
      const salt = randomBytes(16).toString('hex')
      const nextUser: StoredUser = {
        id: crypto.randomUUID(),
        login,
        name: payload.name.trim(),
        role: 'manager',
        passwordHash: hashPassword(password, salt),
        passwordSalt: salt,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      }

      await writeUsers([...users.filter((user) => user.login !== login), nextUser])

      return response(200, {
        user: await toManagedUser(nextUser),
        password,
      })
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
      if (!currentUser) {
        return response(401, { error: 'Не авторизован' })
      }

      const quotaReservation = await reserveGenerationQuota(currentUser.user)

      if (!quotaReservation.ok) {
        return response(429, {
          error: 'Лимит генераций на этот месяц исчерпан',
          quota: quotaReservation.quota,
        })
      }

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

      return response(200, {
        ...job,
        quota: quotaReservation.quota,
      })
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

export const handler = async (event: HttpEvent | AuthorizerEvent) =>
  isAuthorizerEvent(event) ? authorizerHandler(event) : appHandler(event)
