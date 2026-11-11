import {
  enabledExtraFiles,
  isExtraCrawlFile,
  parseAdsTxt,
  type ExtraCrawlFileKind,
} from '@seotools/core'
import type { CrawlFile } from '@seotools/db'
import { SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlFilesHeader } from '@/components/crawl-files/page-header'
import { FileRequestsTable, Finding } from '@/components/crawl-files/parts'
import { RawFile } from '@/components/crawl-files/raw-file'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  SEVERE_FINDINGS,
  indexNowKeyMatches,
  presentFiles,
  primaryFile,
  securityView,
} from '@/lib/crawl-files'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** Kinds found at guessed URLs: what is not there says nothing, so it is not listed one by one. */
const GUESSED: ReadonlySet<ExtraCrawlFileKind> = new Set(['feed', 'opensearch'])

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string; kind: string }>
}) {
  const { host, kind } = await params
  if (!isExtraCrawlFile(kind)) return {}
  const t = await getTranslations('CrawlFiles.extra')
  return { title: t('metaTitle', { name: t(`kinds.${kind}.name`), host }) }
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

async function AdsSummary({ file }: { file: CrawlFile }) {
  const [t, format] = await Promise.all([getTranslations('CrawlFiles.extra.ads'), getFormatter()])
  const parsed = parseAdsTxt(file.body ?? '')
  return (
    <>
      <Facts
        items={[
          { label: t('records'), value: format.number(parsed.records) },
          { label: t('direct'), value: format.number(parsed.direct) },
          { label: t('reseller'), value: format.number(parsed.reseller) },
          { label: t('systems'), value: format.number(parsed.systems) },
          ...parsed.variables.map(({ name, value }) => ({ label: name, value })),
        ]}
      />
      {parsed.invalidLines.length > 0 && (
        <Finding
          title={t('invalid.title')}
          description={t('invalid.description', {
            count: parsed.invalidLines.length,
            lines: parsed.invalidLines.slice(0, 20).join(', '),
          })}
        />
      )}
    </>
  )
}

async function SecuritySummary({ file }: { file: CrawlFile }) {
  const t = await getTranslations('CrawlFiles.extra.security')
  const { parsed, findings } = securityView(file, new Date())
  return (
    <>
      <Facts items={parsed.fields.map(({ name, value }) => ({ label: name, value }))} />
      {findings.map((finding) => (
        <Finding
          key={finding}
          severe={SEVERE_FINDINGS.security.has(finding)}
          title={t(`findings.${finding}.title`)}
          description={t(`findings.${finding}.description`)}
        />
      ))}
    </>
  )
}

async function FeedSummary({ file }: { file: CrawlFile }) {
  const [t, format] = await Promise.all([getTranslations('CrawlFiles.extra.feed'), getFormatter()])
  const feed = file.data?.feed
  if (!feed) return null
  return (
    <Facts
      items={[
        { label: t('url'), value: file.url },
        { label: t('format'), value: t(`formats.${feed.format}`) },
        { label: t('feedTitle'), value: feed.title ?? '—' },
        { label: t('items'), value: format.number(feed.items) },
        {
          label: t('lastModified'),
          value: feed.lastModified
            ? format.dateTime(new Date(feed.lastModified), { dateStyle: 'medium' })
            : '—',
        },
      ]}
    />
  )
}

async function OpenSearchSummary({ file }: { file: CrawlFile }) {
  const t = await getTranslations('CrawlFiles.extra.opensearch')
  const description = file.data?.opensearch
  if (!description) return null
  return (
    <Facts
      items={[
        { label: t('url'), value: file.url },
        { label: t('shortName'), value: description.shortName ?? '—' },
        { label: t('searchDescription'), value: description.description ?? '—' },
        ...description.templates.map((template) => ({ label: t('template'), value: template })),
      ]}
    />
  )
}

async function FileResults({
  kind,
  files,
  indexNowKey,
}: {
  kind: ExtraCrawlFileKind
  files: CrawlFile[]
  indexNowKey: string | null
}) {
  const t = await getTranslations('CrawlFiles.extra')
  const present = presentFiles(files)
  const primary = primaryFile(files)
  const shownRequests = GUESSED.has(kind) ? present : files

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('result')}
          <Badge variant={present.length > 0 ? 'outline' : 'secondary'}>
            {t(present.length > 0 ? 'found' : 'notFound')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('notRequestedYet')}</p>
        )}
        {primary && (kind === 'ads' || kind === 'app-ads') && <AdsSummary file={primary} />}
        {primary && kind === 'security' && <SecuritySummary file={primary} />}
        {GUESSED.has(kind) &&
          present.map((file) =>
            kind === 'feed' ? (
              <FeedSummary key={file.url} file={file} />
            ) : (
              <OpenSearchSummary key={file.url} file={file} />
            ),
          )}
        {primary && kind === 'indexnow' && indexNowKey && (
          <Finding
            severe={!indexNowKeyMatches(primary, indexNowKey)}
            title={t(
              indexNowKeyMatches(primary, indexNowKey)
                ? 'indexnow.matches.title'
                : 'indexnow.differs.title',
            )}
            description={t(
              indexNowKeyMatches(primary, indexNowKey)
                ? 'indexnow.matches.description'
                : 'indexnow.differs.description',
            )}
          />
        )}
        {GUESSED.has(kind) && present.length === 0 && files.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('guessedNotFound', { count: files.length })}
          </p>
        )}
        {shownRequests.length > 0 && <FileRequestsTable files={shownRequests} />}
        {primary?.body != null && <RawFile body={primary.body} truncated={primary.truncated} />}
      </CardContent>
    </Card>
  )
}

export default async function ExtraFilePage({
  params,
}: {
  params: Promise<{ host: string; kind: string }>
}) {
  const { host, kind } = await params
  // The session and the domain first: whether a kind exists is nobody's business without them.
  const { domain } = await requireDomain(host)
  if (!isExtraCrawlFile(kind)) notFound()
  const t = await getTranslations('CrawlFiles.extra')
  const db = await getDb()
  const [settings, files, check, active] = await Promise.all([
    db.crawls.settings(domain.id),
    db.crawlFiles.list(domain.id, [kind]),
    db.crawlFiles.getCheck(domain.id),
    db.crawls.active(domain.id),
  ])
  const enabled = enabledExtraFiles(settings).includes(kind)
  const name = t(`kinds.${kind}.name`)
  const settingsHref = `/domains/${domain.host}/settings/crawl`

  return (
    <main className="grid gap-6">
      <CrawlFilesHeader
        host={domain.host}
        title={name}
        description={t(`kinds.${kind}.description`)}
        files={enabled ? files : []}
        check={check}
        active={active}
      />

      {enabled ? (
        <FileResults kind={kind} files={files} indexNowKey={settings.indexNowKey} />
      ) : (
        // Reached through a bookmark or a link from before it was turned off.
        <Card>
          <CardHeader>
            <CardTitle>{t('disabled.title', { name })}</CardTitle>
            <CardDescription>{t('disabled.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={settingsHref} className={buttonVariants({ variant: 'outline' })}>
              <SettingsIcon />
              {t('settings')}
            </Link>
          </CardContent>
        </Card>
      )}

      {enabled && (
        <p className="text-sm text-muted-foreground">
          {t('manage')}{' '}
          <Link href={settingsHref} className="underline">
            {t('settings')}
          </Link>
        </p>
      )}
    </main>
  )
}
