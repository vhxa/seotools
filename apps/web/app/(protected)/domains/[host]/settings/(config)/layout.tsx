import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

/**
 * The sections that change the domain: inert for who cannot change them, or while it is archived
 * (the actions refuse either way). Alerts are not here: they are personal, and anyone who can see
 * the domain can choose them. A layout does not protect what it wraps: each section still calls
 * `requireDomain` itself.
 */
export default async function DomainConfigLayout({
  params,
  children,
}: {
  params: Promise<{ host: string }>
  children: ReactNode
}) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const readOnly = domain.archivedAt !== null || !canEdit
  return (
    <div className={cn('grid min-w-0 gap-6', readOnly && 'opacity-60')} inert={readOnly}>
      {children}
    </div>
  )
}
