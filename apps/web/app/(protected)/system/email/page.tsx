import { readMailConfig } from '@seotools/core'
import { TriangleAlertIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { MailConfigForm } from '@/components/email/mail-config-form'
import { TestEmailForm } from '@/components/email/test-email-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { getDb } from '@/lib/db'
import { viewOf } from '@/lib/mail-config'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const RECENT = 10

export async function generateMetadata() {
  const t = await getTranslations('Email')
  return { title: t('metaTitle') }
}

/** How the instance sends email, a test, and what happened to the latest attempts. */
export default async function EmailPage() {
  const session = await requireAdmin()
  const [t, format] = await Promise.all([getTranslations('Email'), getFormatter()])
  const db = await getDb()
  const [read, problems, sends] = await Promise.all([
    getSettings().then(readMailConfig),
    db.mail.recent({ limit: RECENT, outcome: 'problems' }),
    db.mail.recent({ limit: RECENT, outcome: 'sent' }),
  ])
  const config = read.state === 'ready' ? read.value : null
  const when = (date: Date) => format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })

  const deliveries = (rows: typeof problems, empty: string) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('recent.columns.when')}</TableHead>
          <TableHead>{t('recent.columns.kind')}</TableHead>
          <TableHead>{t('recent.columns.recipient')}</TableHead>
          <TableHead>{t('recent.columns.status')}</TableHead>
          <TableHead>{t('recent.columns.error')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap">{when(row.createdAt)}</TableCell>
            <TableCell>{t(`kinds.${row.kind}`)}</TableCell>
            <TableCell className="max-w-48 truncate">{row.recipient}</TableCell>
            <TableCell>
              {row.status === 'sent' ? (
                t('status.sent')
              ) : (
                <Badge variant="destructive">{t(`status.${row.status}`)}</Badge>
              )}
            </TableCell>
            <TableCell className="max-w-72 text-xs break-words whitespace-normal">
              {row.error ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('provider.title')}</CardTitle>
          <CardDescription>{t('provider.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {read.state === 'undecryptable' && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{t('provider.undecryptable')}</AlertDescription>
            </Alert>
          )}
          <MailConfigForm view={viewOf(config)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('test.title')}</CardTitle>
          <CardDescription>{t('test.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TestEmailForm defaultTo={session.user.email} configured={config !== null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('recent.problemsTitle')}</CardTitle>
          <CardDescription>{t('recent.problemsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>{deliveries(problems, t('recent.problemsEmpty'))}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('recent.sentTitle')}</CardTitle>
          <CardDescription>{t('recent.sentDescription')}</CardDescription>
        </CardHeader>
        <CardContent>{deliveries(sends, t('recent.sentEmpty'))}</CardContent>
      </Card>
    </main>
  )
}
