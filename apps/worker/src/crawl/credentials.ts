import { domainRequestSettings, requestHeaders, requestSettingsSchema } from '@seotools/core'
import type { Database } from '@seotools/db'

export async function siteHeaders(db: Database, domainId: string, host: string, secret?: string) {
  if (!(await db.crawls.requestSecrets(domainId))) return undefined
  if (!secret) throw new Error('Request settings encryption key is unavailable')
  const saved = await domainRequestSettings(db.crawls, domainId, secret).getJson(
    'request',
    requestSettingsSchema,
  )
  return saved ? { host, headers: requestHeaders(saved) } : undefined
}
