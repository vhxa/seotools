import { getMailConfig } from '@seotools/core'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { getDb } from '@/lib/db'
import { mailHealth } from '@/lib/mail-status'
import { getSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

/**
 * A compact, persistent warning for the pages of System while email is not working: the latest
 * attempt failed, or something wanted to send and there is no provider. Nothing when it is fine.
 */
export async function MailHealthNotice() {
  const db = await getDb()
  const [[latest], config] = await Promise.all([
    db.mail.recent({ limit: 1 }),
    getSettings().then(getMailConfig),
  ])
  const health = mailHealth({ configured: config !== null, latest: latest ?? null })
  if (health.state === 'ok') return null
  const t = await getTranslations('Email.health')
  return (
    <Alert variant="destructive" className="grid-cols-[auto_1fr_auto] items-center">
      <TriangleAlertIcon />
      <div className="grid gap-0.5">
        <AlertTitle>{t(`${health.state}.title`)}</AlertTitle>
        <AlertDescription>{t(`${health.state}.description`)}</AlertDescription>
      </div>
      <Link
        href="/system/email"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'row-span-2')}
      >
        {t(`${health.state}.open`)}
      </Link>
    </Alert>
  )
}
