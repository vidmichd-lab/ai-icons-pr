#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'

const [, , command, bucket, ...args] = process.argv

const usersKey = 'auth/users.json'

const usage = () => {
  console.log(`Usage:
  node scripts/auth-users.mjs list <bucket>
  node scripts/auth-users.mjs upsert <bucket> <login> <password> [name] [role]
  node scripts/auth-users.mjs disable <bucket> <login>
  node scripts/auth-users.mjs delete <bucket> <login>`)
}

if (!command || !bucket) {
  usage()
  process.exit(1)
}

const workdir = mkdtempSync(join(tmpdir(), 'ai-icons-auth-'))
const usersPath = join(workdir, 'users.json')

const runYc = (commandArgs) =>
  execFileSync('yc', commandArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })

const loadUsers = () => {
  try {
    runYc(['storage', 's3', 'cp', `s3://${bucket}/${usersKey}`, usersPath])
    return JSON.parse(readFileSync(usersPath, 'utf8'))
  } catch {
    return []
  }
}

const saveUsers = (users) => {
  writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`)
  runYc(['storage', 's3', 'cp', usersPath, `s3://${bucket}/${usersKey}`])
}

const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex')

try {
  const users = loadUsers()

  if (command === 'list') {
    console.log(JSON.stringify(users.map(({ passwordHash, passwordSalt, ...user }) => user), null, 2))
    process.exit(0)
  }

  if (command === 'upsert') {
    const [login, password, nameArg, roleArg] = args

    if (!login || !password) {
      usage()
      process.exit(1)
    }

    const now = new Date().toISOString()
    const role = roleArg === 'admin' ? 'admin' : 'manager'
    const name = nameArg || login
    const current = users.find((user) => user.login === login)
    const salt = randomBytes(16).toString('hex')

    const nextUser = {
      id: current?.id ?? randomUUID(),
      login,
      name,
      role,
      passwordHash: hashPassword(password, salt),
      passwordSalt: salt,
      disabled: false,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }

    const nextUsers = current
      ? users.map((user) => (user.login === login ? nextUser : user))
      : [...users, nextUser]

    saveUsers(nextUsers)
    console.log(`User ${login} saved in bucket ${bucket}`)
    process.exit(0)
  }

  if (command === 'disable') {
    const [login] = args

    if (!login) {
      usage()
      process.exit(1)
    }

    const nextUsers = users.map((user) =>
      user.login === login ? { ...user, disabled: true, updatedAt: new Date().toISOString() } : user,
    )

    saveUsers(nextUsers)
    console.log(`User ${login} disabled`)
    process.exit(0)
  }

  if (command === 'delete') {
    const [login] = args

    if (!login) {
      usage()
      process.exit(1)
    }

    saveUsers(users.filter((user) => user.login !== login))
    console.log(`User ${login} deleted`)
    process.exit(0)
  }

  usage()
  process.exit(1)
} finally {
  rmSync(workdir, { recursive: true, force: true })
}
