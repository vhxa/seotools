import { readBuildInfo, type BuildInfo } from '@seotools/core'

let cached: BuildInfo | undefined

/**
 * Which version this is, and whether it is a release or a development build. The version is in
 * the code and Next inlines it when building, hence the literal `process.env.APP_VERSION`; the
 * channel comes from the image (`docker/` and the Dockerfile).
 */
export function getBuildInfo(): BuildInfo {
  return (cached ??= readBuildInfo(process.env.APP_VERSION))
}
