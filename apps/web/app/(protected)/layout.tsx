import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { DomainSwitcher } from '@/components/domain-switcher'
import { SignOutButton } from '@/components/sign-out-button'
import { buttonVariants } from '@/components/ui/button'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()
  const t = await getTranslations('Header')
  const companies = await (await getDb()).companies.list()
  // Nothing to switch between yet: finish the onboarding first.
  if (!companies.some((company) => company.domains.length > 0)) redirect('/onboarding')

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">seotools</span>
            <span className="text-xs text-muted-foreground">v{process.env.APP_VERSION}</span>
          </Link>
          <DomainSwitcher
            companies={companies.map((company) => ({
              id: company.id,
              name: company.name,
              domains: company.domains.map(({ id, host }) => ({ id, host })),
            }))}
          />
        </div>
        <div className="flex items-center gap-3">
          <Link href="/system" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('system')}
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {session.user.email}
          </span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  )
}
