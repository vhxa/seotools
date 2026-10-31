import { parseWebEnv, type WebEnv } from '@seotools/core'

let cached: WebEnv | undefined

/** Validated lazily, so `next build` doesn't need runtime secrets. */
export function getEnv(): WebEnv {
  return (cached ??= parseWebEnv())
}
