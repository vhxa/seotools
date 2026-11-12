import { AI_CRAWLERS, robotsAccess, type ParsedRobots } from '@seotools/core'
import { BOT_USER_AGENTS, ROBOTS_ONLY_TOKENS, UNTESTED_BOT_TOKENS } from '@seotools/core/bot-access'
import { getFormatter, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { AutoRefresh } from '@/components/auto-refresh'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BotTestButton } from './bot-test-button'

export async function BotTest({
  domainId,
  host,
  archived,
  parsed,
  robotsUnknown,
}: {
  domainId: string
  host: string
  archived: boolean
  parsed: ParsedRobots | null
  robotsUnknown: boolean
}) {
  const db = await getDb()
  const runs = await db.botTests.list(domainId)
  const run = runs.find((item) => item.activeKey) ?? runs[0]
  const results = run ? await db.botTests.results(run.id) : []
  const baseline = results.find((item) => item.botToken === 'baseline')
  const busy = !!run?.activeKey
  const t = await getTranslations('BotTest')
  const robots = await getTranslations('CrawlFiles.robots.aiBots.accessLevels')
  const format = await getFormatter()
  const bots = [
    ...BOT_USER_AGENTS,
    ...[...ROBOTS_ONLY_TOKENS, ...UNTESTED_BOT_TOKENS].map((token) => ({
      token,
      company: AI_CRAWLERS.find((bot) => bot.token === token)?.company ?? '',
    })),
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('caveat')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <BotTestButton host={host} busy={busy} archived={archived} />
        {busy && <AutoRefresh intervalMs={2000} />}
        {run && (
          <p className="text-sm text-muted-foreground">
            {t('run', {
              date: format.dateTime(run.createdAt, { dateStyle: 'medium', timeStyle: 'short' }),
              state: t(`states.${run.status}`),
            })}
          </p>
        )}
        {baseline && (
          <p className="text-sm">
            {t('baseline', {
              status: baseline.errorCode ?? baseline.statusCode ?? t('unknown'),
              address: baseline.finalUrl ?? '—',
            })}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              {(['bot', 'company', 'robots', 'status', 'address', 'verdict'] as const).map(
                (key) => (
                  <TableHead key={key}>{t(key)}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bots.map((bot) => {
              const result = results.find((item) => item.botToken === bot.token)
              const tokenOnly = (ROBOTS_ONLY_TOKENS as readonly string[]).includes(bot.token)
              const unsupported = (UNTESTED_BOT_TOKENS as readonly string[]).includes(bot.token)
              return (
                <TableRow key={bot.token}>
                  <TableCell className="font-mono text-xs">{bot.token}</TableCell>
                  <TableCell>{bot.company}</TableCell>
                  <TableCell>
                    {robotsUnknown
                      ? t('unknown')
                      : robots(parsed ? robotsAccess(parsed, bot.token).access : 'allowed')}
                  </TableCell>
                  <TableCell>
                    {result ? (result.errorCode ?? result.statusCode ?? t('unknown')) : '—'}
                  </TableCell>
                  <TableCell className="max-w-64 break-all">
                    {result?.finalUrl && result.finalUrl !== baseline?.finalUrl
                      ? result.finalUrl
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {tokenOnly ? (
                      t('tokenOnly')
                    ) : unsupported ? (
                      t('unpublished')
                    ) : result ? (
                      <>
                        {t(`verdicts.${result.verdict}`)}
                        {result.reasons.map((reason) => (
                          <span key={reason} className="block text-xs text-muted-foreground">
                            {t(`reasons.${reason}`)}
                          </span>
                        ))}
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
