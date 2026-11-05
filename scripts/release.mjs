#!/usr/bin/env node
// Release tooling (docs/releases.md). The logic lives in packages/core/src/release, where it is
// type-checked and tested; this file only gives it the real files and Git. It needs Node 24+,
// which runs TypeScript as it is, and nothing installed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../packages/core/src/release/cli.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const workspaces = ['apps', 'packages']
  .flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/package.json`),
  )
  .filter((path) => existsSync(join(root, path)))

let code
try {
  code = await run(process.argv.slice(2), {
    read(path) {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    write: (path, text) => writeFileSync(join(root, path), text),
    packageFiles: () => ['package.json', ...workspaces].sort(),
    tags: () =>
      execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    today: () => new Date().toISOString().slice(0, 10),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  })
} catch (error) {
  // Git missing, a file unreadable: say it plainly instead of printing a stack.
  console.error(`✗ ${error instanceof Error ? error.message : error}`)
  code = 1
}
process.exitCode = code
