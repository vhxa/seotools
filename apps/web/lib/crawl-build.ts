import { buildIdentity, type BuildInfo } from '@seotools/core/version'
import type { Crawl } from '@seotools/db'

/** The keys of `Crawls.build` that say which builds ran and analysed a crawl. */
export type BuildMessage =
  | 'development'
  | 'unrecorded'
  | 'multiple'
  | 'version'
  | 'withUnrecordedRun'
  | 'withDifferentAnalysis'
  | 'withAnalysis'

/**
 * One line saying which build ran a crawl and, when another one analysed it, which: the crawl list and
 * the comparison say it the same way. `t` reads `Crawls.build`. What was not recorded (crawls before
 * 0.8.0) is said as such, never guessed.
 */
export function crawlBuildLine(
  crawl: Pick<Crawl, 'runBuilds' | 'analysisBuild'>,
  t: (key: BuildMessage, values?: Record<string, string>) => string,
): string {
  const buildLabel = (build: BuildInfo | null | undefined) =>
    build?.channel === 'development' ? t('development') : (build?.version ?? t('unrecorded'))
  const run = crawl.runBuilds?.builds ?? []
  const analysis = crawl.analysisBuild
  const ranOnMultiple = run.length > 1 || crawl.runBuilds?.overflow
  const first = run[0]
  const label = ranOnMultiple ? t('multiple') : buildLabel(first)
  const version = crawl.runBuilds?.earlierRunUnrecorded
    ? t('withUnrecordedRun', { version: label })
    : label
  if (!analysis || (first && !ranOnMultiple && buildIdentity(analysis) === buildIdentity(first))) {
    return t('version', { version })
  }
  const different =
    first &&
    !crawl.runBuilds?.overflow &&
    !crawl.runBuilds?.earlierRunUnrecorded &&
    run.every((build) => buildIdentity(analysis) !== buildIdentity(build))
  return t(different ? 'withDifferentAnalysis' : 'withAnalysis', {
    version,
    analysis: buildLabel(analysis),
  })
}
