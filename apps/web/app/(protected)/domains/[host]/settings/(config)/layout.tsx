import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

/**
 * The sections that change the domain: inert while it is archived. Who cannot change them (a
 * viewer) sees their values with the controls disabled or absent (`useCanEdit`); the actions refuse
 * either way. Alerts are not here: they are personal, and anyone who can see
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
  const { domain } = await requireDomain(host)
  const archived = domain.archivedAt !== null
  return (
    <div className={cn('grid min-w-0 gap-6', archived && 'opacity-60')} inert={archived}>
      {children}
    </div>
  )
}
