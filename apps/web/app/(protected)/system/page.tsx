import { type JobStatus } from '@seotools/core'
import { getFormatter, getTranslations } from 'next-intl/server'
import { HelpDisclosure } from '@/components/help'
import { AutoRefresh } from '@/components/auto-refresh'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { getHealth } from '@/lib/health'
import { requireAdmin } from '@/lib/session'
import { enqueueExampleJob } from './actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('System')
  return { title: t('metaTitle') }
}

const statusVariant: Record<JobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
}

/** Instance-wide status (database, worker, job queue): it does not belong to any domain. */
export default async function SystemPage() {
  await requireAdmin()
  const [t, format] = await Promise.all([getTranslations('System'), getFormatter()])
  const db = await getDb()
  const [{ report }, counts, jobs] = await Promise.all([
    getHealth(async () => db),
    db.jobs.countByStatus(),
    db.jobs.list({ limit: 10 }),
  ])
  const tHelp = await getTranslations('Help')
  const workerAlive = report.worker.ok
  const lastSeen = report.worker.lastSeen ? new Date(report.worker.lastSeen) : null
  const ago = (date: Date | null) => (date ? format.relativeTime(date) : t('never'))

  return (
    <main className="grid gap-6">
      <AutoRefresh />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>{t('database')}</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <span className="text-sm">{t('connected')}</span>
              <span className="text-sm font-normal text-muted-foreground">{db.dialect}</span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('worker')}</CardDescription>
            <CardTitle className="flex items-center gap-2">
              {workerAlive ? (
                <span className="text-sm">{t('online')}</span>
              ) : (
                <Badge variant="destructive">{t('offline')}</Badge>
              )}
              <span className="text-sm font-normal text-muted-foreground">
                {t('seen', { when: ago(lastSeen) })}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('jobs')}</CardDescription>
            <CardTitle className="text-sm font-normal">
              {t('jobCounts', {
                pending: counts.pending,
                running: counts.running,
                completed: counts.completed,
                failed: counts.failed,
              })}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>{t('queueTitle')}</CardTitle>
            <CardDescription>{t('queueDescription')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.job')}</TableHead>
                <TableHead>{t('columns.type')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.attempts')}</TableHead>
                <TableHead>{t('columns.created')}</TableHead>
                <TableHead>{t('columns.result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs">{job.id.slice(0, 8)}</TableCell>
                  <TableCell>{job.type}</TableCell>
                  <TableCell>
                    {job.status === 'completed' ? (
                      <span>{t('status.completed')}</span>
                    ) : (
                      <Badge variant={statusVariant[job.status]}>{t(`status.${job.status}`)}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.attempts}/{job.maxAttempts}
                  </TableCell>
                  <TableCell>{ago(job.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs">
                    {job.lastError && job.status !== 'completed'
                      ? job.lastError
                      : job.result
                        ? JSON.stringify(job.result)
                        : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <HelpDisclosure title={tHelp('diagnostics')}>
        <form action={enqueueExampleJob}>
          <Button type="submit" variant="outline">
            {t('enqueue')}
          </Button>
        </form>
      </HelpDisclosure>
    </main>
  )
}
