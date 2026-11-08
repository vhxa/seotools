import { ALERT_KINDS } from '@seotools/core/alerts'
import { BellIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('AlertsSettings')
  return { title: t('metaTitle', { host }) }
}

/**
 * Alerts are personal, so they are chosen in the account: this section says what the person gets for
 * this domain and links there. Anyone who can see the domain can choose, whatever their role.
 */
export default async function AlertsSettingsPage({
  params,
}: {
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const { domain, session } = await requireDomain(host)
  const [t, tAlerts] = await Promise.all([
    getTranslations('AlertsSettings'),
    getTranslations('Account.alerts.kinds'),
  ])
  const own = (await (await getDb()).alerts.forUser(session.user.id)).find(
    (subscription) => subscription.domainId === domain.id,
  )
  const kinds = ALERT_KINDS.filter((kind) => own?.kinds.includes(kind)).map((kind) =>
    tAlerts(`${kind}.label`),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { host: domain.host })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">
          {kinds.length > 0 ? t('current', { kinds: kinds.join(', ') }) : t('none')}
        </p>
        {domain.archivedAt !== null && (
          <p className="text-sm text-muted-foreground">{t('archived')}</p>
        )}
        <div>
          <Link href="/account?tab=alerts" className={cn(buttonVariants({ variant: 'outline' }))}>
            <BellIcon />
            {t('manage')}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
