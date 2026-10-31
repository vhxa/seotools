import { type JobStatus } from '@seotools/core'
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
import { timeAgo } from '@/lib/format'
import { enqueueExampleJob } from './actions'

export const dynamic = 'force-dynamic'

const statusVariant: Record<JobStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
}

export default async function HomePage() {
  const db = await getDb()
  const [{ report }, counts, jobs] = await Promise.all([
    getHealth(async () => db),
    db.jobs.countByStatus(),
    db.jobs.list({ limit: 10 }),
  ])
  const workerAlive = report.worker.ok
  const lastSeen = report.worker.lastSeen ? new Date(report.worker.lastSeen) : null

  return (
    <main className="grid gap-6">
      <AutoRefresh />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Database</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Badge>connected</Badge>
              <span className="text-sm font-normal text-muted-foreground">{db.dialect}</span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Worker</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Badge variant={workerAlive ? 'default' : 'destructive'}>
                {workerAlive ? 'online' : 'offline'}
              </Badge>
              <span className="text-sm font-normal text-muted-foreground">
                seen {timeAgo(lastSeen)}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Jobs</CardDescription>
            <CardTitle className="text-sm font-normal">
              {counts.pending} pending · {counts.running} running · {counts.completed} done ·{' '}
              {counts.failed} failed
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>Job queue</CardTitle>
            <CardDescription>
              Jobs live in the database and are processed by the worker. No Redis needed.
            </CardDescription>
          </div>
          <form action={enqueueExampleJob}>
            <Button type="submit">Enqueue example job</Button>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No jobs yet. Enqueue one to see the worker in action.
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs">{job.id.slice(0, 8)}</TableCell>
                  <TableCell>{job.type}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[job.status]}>{job.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {job.attempts}/{job.maxAttempts}
                  </TableCell>
                  <TableCell>{timeAgo(job.createdAt)}</TableCell>
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
    </main>
  )
}
