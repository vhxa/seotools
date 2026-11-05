import { buildKind } from '@seotools/core'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getBuildInfo } from '@/lib/build-info'
import { getDb } from '@/lib/db'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer()
  const { session } = viewer
  const isAdmin = viewer.role === 'admin'
  const t = await getTranslations('ProtectedShell')
  const build = getBuildInfo()
  const db = await getDb()
  const [companies, faviconVersions, enabledFiles] = await Promise.all([
    visibleCompanies(viewer),
    db.favicons.versions(),
    db.crawls.enabledFiles(),
  ])
  // Nothing to manage yet: finish the onboarding first. A company left without domains is still
  // something to manage, so it does not send anyone back to the onboarding.
  if (isAdmin && companies.length === 0) redirect('/onboarding')

  // The sidebar remembers whether it was collapsed in this cookie (written by the shadcn sidebar).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
        >
          {t('skipToContent')}
        </a>
        <AppSidebar
          isAdmin={isAdmin}
          companies={companies.map((company) => ({
            id: company.id,
            name: company.name,
            domains: company.domains.map(({ id, host, archivedAt }) => ({
              id,
              host,
              archived: archivedAt !== null,
              faviconVersion: faviconVersions.get(id) ?? null,
              extraFiles: enabledFiles.get(id) ?? [],
            })),
          }))}
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          version={build.version}
          development={buildKind(build) === 'development'}
        />
        {/* A plain div, not SidebarInset: that one renders a <main> and pages bring their own. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
          </header>
          {/* Readable width by default; a page that needs the whole screen marks its <main data-wide>. */}
          <div
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-5xl flex-1 scroll-mt-14 p-4 outline-none has-[>main[data-wide]]:max-w-none md:p-8"
          >
            {children}
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
