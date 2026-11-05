import type { ReactNode } from 'react'
import { ArchivedNotice } from '@/components/archived-notice'
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
  const { domain } = await requireDomain(host)
  return (
    <>
      {domain.archivedAt && <ArchivedNotice />}
      {children}
    </>
  )
}
