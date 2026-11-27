import { readFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import type { WorkerEnv, Logger } from '@seotools/core'
import type { CapacityHardware } from '@seotools/core/capacity'

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
}

function availableMemory(): number {
  let memory = totalmem()
  for (const line of read('/proc/self/cgroup')?.split('\n') ?? []) {
    const [, controllers, group] = line.split(':')
    if (!group) continue
    const v2 = controllers === ''
    if (!v2 && !controllers?.split(',').includes('memory')) continue
    const root = v2 ? '/sys/fs/cgroup' : '/sys/fs/cgroup/memory'
    const filename = v2 ? 'memory.max' : 'memory.limit_in_bytes'
    // A limit on an ancestor applies too. Inside a container its group may be mounted as root.
    for (let path = join(root, group); ; path = dirname(path)) {
      const value = Number(read(join(path, filename)))
      if (Number.isSafeInteger(value) && value > 0) memory = Math.min(memory, value)
      if (path === root || !path.startsWith(root + '/')) break
    }
  }
  return memory
}

export function detectCapacity(env: WorkerEnv): CapacityHardware {
  return {
    processors: availableParallelism(),
    memory: availableMemory(),
    browserMemory: env.RENDER_BROWSER_MEMORY,
    browserShm: env.RENDER_BROWSER_SHM,
  }
}

export function warnLegacyCapacity(log: Pick<Logger, 'warn'>, variables: readonly string[]) {
  if (variables.length)
    log.warn(
      `Ignoring ${variables.join(' and ')}: set renders and crawls at the same time in Administration → Capacity`,
    )
}
