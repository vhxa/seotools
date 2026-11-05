import { crawlFileState, type CrawlFileState } from '@seotools/core'
import type { CrawlFile } from '@seotools/db'
import { TriangleAlertIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const STATE_VARIANTS: Record<CrawlFileState, 'outline' | 'secondary' | 'destructive'> = {
  ok: 'outline',
  redirect: 'secondary',
  missing: 'secondary',
  invalid: 'destructive',
  'access-denied': 'destructive',
  'http-error': 'destructive',
  'unexpected-response': 'secondary',
  'server-error': 'destructive',
  unreachable: 'destructive',
}

export async function FileStateBadge({
  state,
  statusCode,
}: {
  state: CrawlFileState
  statusCode: number | null
}) {
  const t = await getTranslations('CrawlFiles.states')
  if (state === 'ok') {
    return (
      <span className="text-sm tabular-nums">
        {t(state)} {statusCode}
      </span>
    )
  }
  return (
    <Badge variant={STATE_VARIANTS[state]}>
      {t(state)}
      {statusCode !== null && <span className="tabular-nums opacity-70">{statusCode}</span>}
    </Badge>
  )
}

/** Only ever given URLs that went through `normalizeCrawlUrl`, so never a `javascript:` one. */
export function FileLink({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className={`block max-w-md truncate font-mono text-xs hover:underline ${className ?? ''}`}
    >
      {url}
    </a>
  )
}

export async function FileSize({ file }: { file: Pick<CrawlFile, 'bytes' | 'truncated'> }) {
  const [t, format] = await Promise.all([getTranslations('CrawlFiles'), getFormatter()])
  if (file.bytes === null) return <span className="text-muted-foreground">—</span>
  const kib = format.number(file.bytes / 1024, { maximumFractionDigits: 1 })
  return <>{t(file.truncated ? 'sizeOver' : 'size', { kib })}</>
}

/** Every URL a file was asked for at, and what each one answered. */
export async function FileRequestsTable({ files }: { files: CrawlFile[] }) {
  const t = await getTranslations('CrawlFiles.requests')
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('url')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('size')}</TableHead>
          <TableHead>{t('detail')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const state = crawlFileState(file)
          const detail =
            file.error ??
            (file.redirectTo && `→ ${file.redirectTo}`) ??
            (state === 'invalid' ? t('invalidDetail') : null) ??
            file.contentType ??
            '—'
          return (
            <TableRow key={file.url}>
              <TableCell>
                <FileLink url={file.url} />
              </TableCell>
              <TableCell>
                <FileStateBadge state={state} statusCode={file.statusCode} />
              </TableCell>
              <TableCell className="tabular-nums">
                {/* An error page or a redirect has a size too, but it says nothing of the file. */}
                {state === 'ok' ? <FileSize file={file} /> : '—'}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={detail}>
                {detail}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function Finding({
  title,
  description,
  severe = false,
}: {
  title: string
  description: string
  severe?: boolean
}) {
  return (
    <Alert variant={severe ? 'destructive' : 'default'}>
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
      </AlertDescription>
    </Alert>
  )
}
