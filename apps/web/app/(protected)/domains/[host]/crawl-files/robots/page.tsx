import { AI_CRAWLERS, robotsAccess, type RobotsAccess } from '@seotools/core'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlFilesHeader } from '@/components/crawl-files/page-header'
import { FileRequestsTable, Finding } from '@/components/crawl-files/parts'
import { RawFile } from '@/components/crawl-files/raw-file'
import { Stat } from '@/components/stat'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { robotsView, type RobotsFinding } from '@/lib/crawl-files'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** The rules of a group shown in the page. The whole file is one click away. */
const MAX_RULES_SHOWN = 50
const MAX_ISSUES_SHOWN = 50

const SEVERE: ReadonlySet<RobotsFinding> = new Set(['unavailable', 'invalid', 'site-blocked'])

const ACCESS_VARIANTS: Record<RobotsAccess['access'], 'outline' | 'secondary' | 'destructive'> = {
  allowed: 'outline',
  partial: 'secondary',
  blocked: 'destructive',
}

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlFiles.robots')
  return { title: t('metaTitle', { host }) }
}

export default async function RobotsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('CrawlFiles.robots'), getFormatter()])
  const db = await getDb()
  const [files, check, active] = await Promise.all([
    db.crawlFiles.list(domain.id, ['robots']),
    db.crawlFiles.getCheck(domain.id),
    db.crawls.active(domain.id),
  ])
  const view = robotsView(files)
  const { parsed, file } = view
  const ruleCount = parsed?.groups.reduce((sum, group) => sum + group.rules.length, 0) ?? 0

  return (
    <main className="grid gap-6">
      <CrawlFilesHeader
        host={domain.host}
        title={t('title')}
        description={t('description')}
        files={files}
        check={check}
        active={active}
      />

      {view.findings.map((finding) => (
        <Finding
          key={finding}
          severe={SEVERE.has(finding)}
          title={t(`findings.${finding}.title`)}
          description={t(`findings.${finding}.description`)}
        />
      ))}

      {parsed && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={t('stats.groups')} value={format.number(parsed.groups.length)} />
          <Stat label={t('stats.rules')} value={format.number(ruleCount)} />
          <Stat label={t('stats.sitemaps')} value={format.number(parsed.sitemaps.length)} />
        </div>
      )}

      {files.length > 0 && !view.unknown && (
        <Card>
          <CardHeader>
            <CardTitle>{t('aiBots.title')}</CardTitle>
            <CardDescription>{t('aiBots.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('aiBots.bot')}</TableHead>
                  <TableHead>{t('aiBots.company')}</TableHead>
                  <TableHead>{t('aiBots.purpose')}</TableHead>
                  <TableHead>{t('aiBots.access')}</TableHead>
                  <TableHead>{t('aiBots.matchedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AI_CRAWLERS.map((bot) => {
                  // No file at all means everything is allowed, and nothing names the bot.
                  const access = parsed
                    ? robotsAccess(parsed, bot.token)
                    : { access: 'allowed' as const, matchedBy: 'none' as const }
                  return (
                    <TableRow key={bot.token}>
                      <TableCell className="font-mono text-xs">{bot.token}</TableCell>
                      <TableCell>{bot.company}</TableCell>
                      <TableCell>{t(`aiBots.purposes.${bot.purpose}`)}</TableCell>
                      <TableCell>
                        <Badge variant={ACCESS_VARIANTS[access.access]}>
                          {t(`aiBots.accessLevels.${access.access}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`aiBots.matches.${access.matchedBy}`)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {parsed && parsed.groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('groups.title')}</CardTitle>
            <CardDescription>{t('groups.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {parsed.groups.map((group, index) => (
              <div key={index} className="grid gap-2 rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {group.userAgents.map((agent, agentIndex) => (
                    <Badge key={agentIndex} variant="secondary" className="font-mono">
                      {agent || t('groups.emptyAgent')}
                    </Badge>
                  ))}
                  {group.crawlDelay !== null && (
                    <span className="text-xs text-muted-foreground">
                      {t('groups.crawlDelay', { seconds: group.crawlDelay })}
                    </span>
                  )}
                </div>
                {group.rules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('groups.noRules')}</p>
                ) : (
                  <ul className="grid gap-1 font-mono text-xs">
                    {group.rules.slice(0, MAX_RULES_SHOWN).map((rule, ruleIndex) => (
                      <li key={ruleIndex} className="break-all">
                        <span
                          className={
                            rule.type === 'allow' ? 'text-muted-foreground' : 'font-semibold'
                          }
                        >
                          {t(`groups.ruleTypes.${rule.type}`)}:
                        </span>{' '}
                        {rule.path || t('groups.emptyPath')}
                      </li>
                    ))}
                  </ul>
                )}
                {group.rules.length > MAX_RULES_SHOWN && (
                  <p className="text-xs text-muted-foreground">
                    {t('groups.moreRules', { count: group.rules.length - MAX_RULES_SHOWN })}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {parsed && parsed.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('issues.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('issues.line')}</TableHead>
                  <TableHead>{t('issues.content')}</TableHead>
                  <TableHead>{t('issues.problem')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => (
                  <TableRow key={issue.line}>
                    <TableCell className="tabular-nums">{issue.line}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs" title={issue.text}>
                      {issue.text}
                    </TableCell>
                    <TableCell>{t(`issues.types.${issue.type}`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('origins.title')}</CardTitle>
            <CardDescription>{t('origins.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FileRequestsTable files={files} />
            {file?.body != null && <RawFile body={file.body} truncated={file.truncated} />}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
