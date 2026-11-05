import type { Database } from './types'

/** Thrown when something is started or changed for a domain that is archived. */
export class DomainArchivedError extends Error {
  constructor(readonly domainId: string) {
    super(`Domain ${domainId} is archived`)
    this.name = 'DomainArchivedError'
  }
}

async function assertActive(db: Database, domainId: string) {
  const domain = await db.domains.get(domainId)
  if (domain?.archivedAt) throw new DomainArchivedError(domainId)
}

type Method = (...args: never[]) => Promise<unknown>

/** The domain a call is about: the first argument, or the `domainId` of an input object. */
function domainOf(args: unknown[]): string | null {
  const [first] = args
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && 'domainId' in first) {
    return typeof first.domainId === 'string' ? first.domainId : null
  }
  return null
}

function guard<R extends object>(db: Database, repository: R, names: readonly (keyof R)[]): R {
  const guarded = { ...repository }
  for (const name of names) {
    const original = repository[name] as unknown as Method
    ;(guarded as Record<keyof R, unknown>)[name] = async (...args: unknown[]) => {
      const domainId = domainOf(args)
      if (domainId) await assertActive(db, domainId)
      return (original as (...a: unknown[]) => Promise<unknown>).apply(repository, args)
    }
  }
  return guarded
}

/**
 * Makes the repositories refuse what changes the settings of an archived domain with
 * `DomainArchivedError`: crawl settings, schedules, priority URLs, audit rules and languages, and a
 * request to refresh crawl files. It is the one place that lists them, so no caller can bypass it.
 *
 * Starting a crawl or a recheck is refused where it is created, inside the transaction that
 * creates it (`crawls.start`, `verifications.start`), because there a refusal has to be atomic with
 * archiving. Everything here is a plain check before a write: archiving between the two lets one
 * settings write through, which no job reads for an archived domain.
 */
export function withArchiveGuard(db: Database): Database {
  return {
    ...db,
    crawls: guard(db, db.crawls, ['saveSettings']),
    crawlSchedules: guard(db, db.crawlSchedules, ['save']),
    priorityUrls: guard(db, db.priorityUrls, ['add', 'remove']),
    crawlFiles: guard(db, db.crawlFiles, ['requestCheck']),
    audit: guard(db, db.audit, [
      'saveRule',
      'setRuleEnabled',
      'deleteRule',
      'setUrlConfig',
      'saveRuleSet',
      'setRulesEnabled',
      'deleteRules',
      'setLanguages',
    ]),
  }
}
