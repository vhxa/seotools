import { type JobStatus } from '@seotools/core'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ChevronRightIcon, PauseIcon } from 'lucide-react'
import { AutoRefresh } from '@/components/auto-refresh'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { getHealth } from '@/lib/health'
import { summarizeJobResult } from '@/lib/job-summary'
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
  const workerAlive = report.worker.ok
  const lastSeen = report.worker.lastSeen ? new Date(report.worker.lastSeen) : null
  const ago = (date: Date | null) => (date ? format.relativeTime(date) : t('never'))

  return (
    <main className="grid min-w-0 gap-8">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {getEnv().SEOTOOLS_PAUSE_AUTOMATION && (
        <Alert>
          <PauseIcon />
          <AlertTitle>{t('paused.title')}</AlertTitle>
          <AlertDescription>{t('paused.description')}</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="health" className="grid gap-3">
        <h2 id="health" className="text-lg font-medium">
          {t('health')}
        </h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{t('database')}</dt>
            <dd className="text-sm font-medium">{t('databaseOk', { dialect: db.dialect })}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-sm text-muted-foreground">{t('worker')}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm">
              {workerAlive ? (
                <span className="font-medium">{t('workerOk')}</span>
              ) : (
                <Badge variant="destructive">{t('workerDown')}</Badge>
              )}
              <span className="text-muted-foreground">
                {t('heartbeat', { when: ago(lastSeen) })}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="jobs" className="grid gap-3">
        <h2 id="jobs" className="text-lg font-medium">
          {t('jobs')}
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(['pending', 'running', 'completed', 'failed'] as const).map((state) => (
            <div key={state} className="grid gap-0.5">
              <dt className="text-sm text-muted-foreground">{t(`jobStates.${state}`)}</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {format.number(counts[state])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Collapsible className="grid min-w-0 gap-3">
        <CollapsibleTrigger
          render={<Button variant="ghost" className="group justify-start px-2" />}
        >
          <ChevronRightIcon className="transition-transform group-data-[panel-open]:rotate-90" />
          {t('technical.title')}
        </CollapsibleTrigger>
        <CollapsibleContent className="grid min-w-0 gap-4">
          <p className="text-sm text-muted-foreground">{t('technical.description')}</p>
          <div className="overflow-x-auto">
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
                {jobs.map((job) => {
                  const summary = summarizeJobResult(job.type, job.result)
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.id.slice(0, 8)}</TableCell>
                      <TableCell>{job.type}</TableCell>
                      <TableCell>
                        {job.status === 'completed' ? (
                          <span>{t('status.completed')}</span>
                        ) : (
                          <Badge variant={statusVariant[job.status]}>
                            {t(`status.${job.status}`)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.attempts}/{job.maxAttempts}
                      </TableCell>
                      <TableCell>{ago(job.createdAt)}</TableCell>
                      <TableCell className="grid max-w-64 gap-1">
                        {job.lastError && job.status !== 'completed' ? (
                          <span className="truncate font-mono text-xs">{job.lastError}</span>
                        ) : (
                          <>
                            {summary && (
                              <span className="text-sm">
                                {t(`summary.${summary.key}`, summary.values)}
                              </span>
                            )}
                            {job.result ? (
                              <span className="truncate font-mono text-xs text-muted-foreground">
                                {JSON.stringify(job.result)}
                              </span>
                            ) : (
                              !summary && '—'
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <form action={enqueueExampleJob}>
            <Button type="submit" variant="outline">
              {t('enqueue')}
            </Button>
          </form>
        </CollapsibleContent>
      </Collapsible>
    </main>
  )
}
