import type { ReactNode } from 'react'
import { ArchivedNotice } from '@/components/archived-notice'
import { DomainAccessProvider } from '@/components/domain-access'
import { SidebarCrawlActions } from '@/components/crawl/sidebar-crawl-actions'
import { DataFreshness } from '@/components/data-freshness'
import { crawlActivity, IDLE } from '@/lib/crawl-activity'
import { dataStamp } from '@/lib/data-stamp'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

/**
 * Says on every page of the domain that it is archived. A layout does not protect what it wraps:
 * each page and action still calls `requireDomain` itself. The pages stay direct children, since
 * the shell looks for a wide `<main>` among them.
 */
export default async function DomainLayout({
  params,
  children,
}: {
  params: Promise<{ host: string }>
  children: ReactNode
}) {
  const { host } = await params
  const { domain, canEdit, role } = await requireDomain(host)
  // Only an editor sees the sidebar's crawl buttons, so only then is the state worth reading.
  const db = await getDb()
  const [activity, stamp] = await Promise.all([
    canEdit ? crawlActivity(db, domain.id) : IDLE,
    dataStamp(db, domain.id),
  ])
  return (
    <DomainAccessProvider canEdit={canEdit}>
      <DataFreshness host={domain.host} initial={stamp} />
      {canEdit && !domain.archivedAt && (
        <SidebarCrawlActions host={domain.host} initial={activity} />
      )}
      {domain.archivedAt && <ArchivedNotice canManage={role === 'admin'} />}
      {children}
    </DomainAccessProvider>
  )
}
