import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()
  const db = await getDb()
  const [companies, faviconVersions, enabledFiles] = await Promise.all([
    db.companies.list(),
    db.favicons.versions(),
    db.crawls.enabledFiles(),
  ])
  // Nothing to switch between yet: finish the onboarding first.
  if (!companies.some((company) => company.domains.length > 0)) redirect('/onboarding')

  // The sidebar remembers whether it was collapsed in this cookie (written by the shadcn sidebar).
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar
          companies={companies.map((company) => ({
            id: company.id,
            name: company.name,
            domains: company.domains.map(({ id, host }) => ({
              id,
              host,
              faviconVersion: faviconVersions.get(id) ?? null,
              extraFiles: enabledFiles.get(id) ?? [],
            })),
          }))}
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          version={process.env.APP_VERSION}
        />
        {/* A plain div, not SidebarInset: that one renders a <main> and pages bring their own. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
          </header>
          {/* Readable width by default; a page that needs the whole screen marks its <main data-wide>. */}
          <div className="mx-auto w-full max-w-5xl flex-1 p-4 has-[>main[data-wide]]:max-w-none md:p-8">
            {children}
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
