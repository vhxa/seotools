#!/usr/bin/env node
// Container entrypoint: runs migrations, then starts the web app and/or the worker.
//
//   SEOTOOLS_MODE=all      (default) migrate, then web + worker in this one container
//   SEOTOOLS_MODE=web      migrate, then web only
//   SEOTOOLS_MODE=worker   worker only (does not migrate; start it after `web`)
//   SEOTOOLS_MODE=migrate  run migrations and exit
//
// If any process exits, the others are stopped and the container exits, so the orchestrator
// restarts it instead of leaving a half-working app (e.g. a UI whose jobs never run).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const programs = {
  bootstrap: here('./worker/dist/bootstrap.mjs'),
  worker: here('./worker/dist/index.mjs'),
  web: here('./web/apps/web/server.js'),
}

const mode = process.argv[2] ?? process.env.SEOTOOLS_MODE ?? 'all'
const MODES = ['all', 'web', 'worker', 'migrate']
if (!MODES.includes(mode)) {
  console.error(`Unknown SEOTOOLS_MODE "${mode}". Use one of: ${MODES.join(', ')}`)
  process.exit(2)
}

const log = (msg) => console.log(`[entrypoint] ${msg}`)
const STOP_TIMEOUT_MS = 30_000
const children = new Map() // name → ChildProcess
let shuttingDown = false
let exitCode = 0

function start(name, file, env = {}) {
  const child = spawn(process.execPath, [file], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  children.set(name, child)
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (!shuttingDown) {
      log(`${name} exited (${signal ?? code}), stopping`)
      exitCode = code || 1
      shutdown()
    } else if (children.size === 0) {
      process.exit(exitCode)
    }
  })
  return child
}

function shutdown() {
  if (children.size === 0) return process.exit(exitCode)
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children.values()) child.kill('SIGTERM')
  setTimeout(() => {
    log('forcing shutdown')
    for (const child of children.values()) child.kill('SIGKILL')
  }, STOP_TIMEOUT_MS).unref()
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received`)
    shutdown()
  })
}

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

if (mode !== 'worker') {
  const code = await run(programs.bootstrap)
  if (code !== 0) {
    log('bootstrap failed')
    process.exit(code)
  }
}
if (mode === 'migrate') process.exit(0)

if (mode === 'all' || mode === 'web') {
  start('web', programs.web, {
    PORT: process.env.PORT || '3000',
    // Docker sets HOSTNAME to the container id, which Next would try to bind to.
    HOSTNAME: process.env.WEB_HOST || '0.0.0.0',
  })
}
if (mode === 'all' || mode === 'worker') start('worker', programs.worker)
log(`started in "${mode}" mode`)
