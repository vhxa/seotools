import type { ReactNode } from 'react'
import { SignOutButton } from '@/components/sign-out-button'
import { requireSession } from '@/lib/session'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-4 md:p-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">seotools</h1>
          <span className="text-xs text-muted-foreground">v{process.env.APP_VERSION}</span>
        </div>
        <div className="flex items-center gap-3">
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
