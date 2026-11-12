import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getDb } from '@/lib/db'
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
    domains: company.domains.map(({ id, host, archivedAt }) => ({
      id,
      host,
      archived: archivedAt !== null,
      faviconVersion: faviconVersions.get(id) ?? null,
      extraFiles: enabledFiles.get(id) ?? [],
    })),
  }))
  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  }

  return (
    <TooltipProvider>
      {/* On wide screens the sidebar is always open: it has no button, rail or shortcut to fold it.
          On narrow ones it is a sheet, which the header's button opens. */}
      <SidebarProvider open className="flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
        >
          {t('skipToContent')}
        </a>
        <AppHeader
          favouriteDomainId={favouriteDomainId}
          isAdmin={isAdmin}
          companies={switcherCompanies}
          user={user}
        />
        <div className="flex min-h-0 flex-1">
          <AppSidebar isAdmin={isAdmin} companies={switcherCompanies} />
          {/* A plain div, not SidebarInset: that one renders a <main> and pages bring their own. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Readable width by default; a page that needs the whole screen marks its <main data-wide>. */}
            <div
              id="main-content"
              tabIndex={-1}
              className="mx-auto w-full max-w-5xl flex-1 scroll-mt-14 p-4 outline-none has-[>main[data-wide]]:max-w-none md:p-8 md:pt-4"
            >
              {children}
            </div>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
