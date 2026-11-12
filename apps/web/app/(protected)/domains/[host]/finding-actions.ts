'use server'

import { AUDIT_LIMITS } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { isUrlHash } from '@/lib/pages-query'
import { archivedMessage, requireDomainEditor } from '@/lib/workspace'

export async function setFindingStateAction(
  host: string,
  _previous: { error?: string; saved?: boolean },
  form: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const { domain, session } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('FindingStates')
  const issue = form.get('issue')
  const state = form.get('state')
  const note = form.get('note')
  const hashes = form.getAll('urlHash')
  if (
    typeof issue !== 'string' ||
    !isPageIssueId(issue) ||
    !['pending', 'in-progress', 'dismissed'].includes(String(state)) ||
    typeof note !== 'string' ||
    note.trim().length > 1000 ||
    !hashes.length ||
    hashes.length > AUDIT_LIMITS.bulkUrls ||
    hashes.some((hash) => typeof hash !== 'string' || (hash !== '*' && !isUrlHash(hash))) ||
    (state === 'dismissed' && issue.startsWith('expected-'))
  )
    return { error: t('invalid') }
  const saved = await (
    await getDb()
  ).audit.setFindingStates({
    domainId: domain.id,
    issue,
    state: state as 'pending' | 'in-progress' | 'dismissed',
    urlHashes: hashes.map((hash) => (hash === '*' ? null : String(hash))),
    note,
    setBy: session.user.id,
  })
  if (!saved.ok) return { error: t('limit') }
  revalidatePath(`/domains/${host}`, 'layout')
  return { saved: true }
}
