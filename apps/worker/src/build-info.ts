import { readBuildInfo, type BuildInfo } from '@seotools/core'
import pkg from '../package.json' with { type: 'json' }

let cached: BuildInfo | undefined

export function getWorkerBuildInfo(): BuildInfo {
  return (cached ??= readBuildInfo(pkg.version))
}
