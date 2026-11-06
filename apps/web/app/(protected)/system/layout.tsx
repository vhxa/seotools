import type { ReactNode } from 'react'
import { SystemNav } from '@/components/system-nav'
import { MailHealthNotice } from '@/components/email/mail-health-notice'
import { requireAdmin } from '@/lib/session'

/**
 * The pages of System, with a warning above them while email is not working. A layout does not
 * protect what it wraps: each page still calls `requireAdmin()` itself.
 */
export default async function SystemLayout({ children }: { children: ReactNode }) {
  await requireAdmin()
  return (
    <div className="grid gap-6">
      <SystemNav />
      <MailHealthNotice />
      {children}
    </div>
  )
}
