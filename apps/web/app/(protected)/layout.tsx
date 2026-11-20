import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { AppShell } from '@/components/app-shell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getDb } from '@/lib/db'
import { canEditDomain, domainRoleOf } from '@seotools/core/access'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer()
  const { session } = viewer
  const isAdmin = viewer.role === 'admin'
  const t = await getTranslations('ProtectedShell')
  const db = await getDb()
  const [companies, faviconVersions, enabledFiles, favouriteDomainId] = await Promise.all([
    visibleCompanies(viewer),
    db.favicons.versions(),
    db.crawls.enabledFiles(),
    db.userPreferences.favouriteDomainId(session.user.id),
  ])
  // Nothing to manage yet: finish the onboarding first. A company left without domains is still
  // something to manage, so it does not send anyone back to the onboarding.
  if (isAdmin && companies.length === 0) redirect('/onboarding')

  const switcherCompanies = companies.map((company) => ({
    id: company.id,
    name: company.name,
    domains: company.domains.map((domain) => ({
      id: domain.id,
      host: domain.host,
      archived: domain.archivedAt !== null,
      canCrawl: domain.archivedAt === null && canEditDomain(domainRoleOf(viewer, domain)),
      faviconVersion: faviconVersions.get(domain.id) ?? null,
      extraFiles: enabledFiles.get(domain.id) ?? [],
    })),
  }))
  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  }

  // The sidebar remembers whether it was folded (the provider writes this cookie).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <TooltipProvider>
      <AppShell
        favouriteDomainId={favouriteDomainId}
        isAdmin={isAdmin}
        companies={switcherCompanies}
        user={user}
        defaultOpen={defaultOpen}
        skipLabel={t('skipToContent')}
      >
        {children}
      </AppShell>
    </TooltipProvider>
  )
}
