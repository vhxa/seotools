import { readCapacitySettings } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CapacityForm } from '@/components/capacity-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import { dismissCapacityUpgradeAction } from './actions'

export default async function CapacityPage() {
  await requireAdmin()
  const db = await getDb()
  const [t, format, { capacity, recommended, hardware, upgrade }, metrics] = await Promise.all([
    getTranslations('Capacity'),
    getFormatter(),
    readCapacitySettings(db),
    db.crawls.latestMeasuredRender(),
  ])
  const memory = (bytes: number | null | undefined) =>
    bytes == null
      ? t('unknown')
      : t('gib', { amount: format.number(bytes / 1024 ** 3, { maximumFractionDigits: 2 }) })

  return (
    <main className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      {upgrade && (
        <Card role="region" aria-label={t('upgradeTitle')}>
          <CardContent className="grid gap-3 text-sm">
            <h2 className="text-base font-medium">{t('upgradeTitle')}</h2>
            <p>
              {upgrade.from
                ? t('upgradeFrom', {
                    oldRenders: upgrade.from.renders,
                    oldCrawls: upgrade.from.crawls,
                    ...upgrade.to,
                  })
                : t('upgradeFromEnv', upgrade.to)}
            </p>
            {upgrade.domains.length > 0 && (
              <>
                <p>{t('upgradeComparison')}</p>
                <details>
                  <summary className="cursor-pointer">
                    {t('upgradeDomains', { count: upgrade.domains.length })}
                  </summary>
                  <div className="mt-2 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('domain')}</TableHead>
                          <TableHead className="text-right">{t('before')}</TableHead>
                          <TableHead className="text-right">{t('after')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {upgrade.domains.map(({ host, from, to }) => (
                          <TableRow key={host}>
                            <TableCell>{host}</TableCell>
                            <TableCell className="text-right tabular-nums">{from}</TableCell>
                            <TableCell className="text-right tabular-nums">{to}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              </>
            )}
            <form action={dismissCapacityUpgradeAction}>
              <Button type="submit" variant="outline" size="sm">
                {t('dismiss')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <CapacityForm
        key={capacity ? 'ready' : 'waiting'}
        capacity={capacity}
        recommended={recommended}
        hardware={hardware}
        metrics={metrics}
      />
      <section className="grid gap-2">
        <h2 className="text-base font-medium">{t('detected')}</h2>
        <Card size="sm">
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt>{t('processors')}</dt>
              <dd className="text-right tabular-nums">
                {hardware ? format.number(hardware.processors) : t('unknown')}
              </dd>
              <dt>{t('ram')}</dt>
              <dd className="text-right tabular-nums">{memory(hardware?.memory)}</dd>
              <dt>{t('ceiling')}</dt>
              <dd className="text-right tabular-nums">{memory(hardware?.browserMemory)}</dd>
              <dt>{t('shared')}</dt>
              <dd className="text-right tabular-nums">{memory(hardware?.browserShm)}</dd>
            </dl>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
