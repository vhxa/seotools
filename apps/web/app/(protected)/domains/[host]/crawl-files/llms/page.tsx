import { crawlFileState, normalizeCrawlUrl } from '@seotools/core'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlFilesHeader } from '@/components/crawl-files/page-header'
import { FileRequestsTable, FileSize, Finding } from '@/components/crawl-files/parts'
import { RawFile } from '@/components/crawl-files/raw-file'
import { Stat } from '@/components/stat'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SEVERE_FINDINGS, llmsFullView, llmsView } from '@/lib/crawl-files'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlFiles.llms')
  return { title: t('metaTitle', { host }) }
}

export default async function LlmsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('CrawlFiles.llms'), getFormatter()])
  const db = await getDb()
  const [files, check, active] = await Promise.all([
    db.crawlFiles.list(domain.id, ['llms', 'llms-full']),
    db.crawlFiles.getCheck(domain.id),
    db.crawls.active(domain.id),
  ])
  const llmsFiles = files.filter((file) => file.kind === 'llms')
  const fullFiles = files.filter((file) => file.kind === 'llms-full')
  const view = llmsView(llmsFiles)
  const full = llmsFullView(fullFiles)
  const { parsed, file } = view

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
          severe={SEVERE_FINDINGS.llms.has(finding)}
          title={t(`findings.${finding}.title`)}
          description={t(`findings.${finding}.description`)}
        />
      ))}

      {parsed && file && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t('stats.sections')} value={format.number(parsed.sections.length)} />
            <Stat label={t('stats.links')} value={format.number(parsed.linkCount)} />
            <Card>
              <CardHeader>
                <CardDescription>{t('stats.size')}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  <FileSize file={file} />
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{parsed.title ?? t('untitled')}</CardTitle>
              {parsed.summary && <CardDescription>{parsed.summary}</CardDescription>}
            </CardHeader>
            {parsed.sections.length > 0 && (
              <CardContent className="grid gap-6">
                {parsed.sections.map((section, index) => (
                  <section key={index} className="grid gap-2">
                    <h2 className="text-sm font-medium">{section.title ?? t('noSection')}</h2>
                    <ul className="grid gap-1 text-sm">
                      {section.links.map((link, linkIndex) => {
                        // What the file calls a link can be anything, `javascript:` included.
                        const url = normalizeCrawlUrl(link.url, file.url)
                        return (
                          <li key={linkIndex} className="break-words">
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="underline underline-offset-2"
                              >
                                {link.title}
                              </a>
                            ) : (
                              link.title
                            )}
                            {link.notes && (
                              <span className="text-muted-foreground"> — {link.notes}</span>
                            )}
                          </li>
                        )
                      })}
                      {section.links.length === 0 && (
                        <li className="text-muted-foreground">{t('noLinks')}</li>
                      )}
                    </ul>
                  </section>
                ))}
              </CardContent>
            )}
          </Card>
        </>
      )}

      {llmsFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.llms')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FileRequestsTable files={llmsFiles} />
            {file?.body != null && <RawFile body={file.body} truncated={file.truncated} />}
          </CardContent>
        </Card>
      )}

      {fullFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('requests.llmsFull')}</CardTitle>
            <CardDescription>
              {full
                ? t('full.found', {
                    title: full.title ?? t('untitled'),
                    headings: full.headingCount,
                  })
                : t(
                    fullFiles.every((file) => crawlFileState(file) === 'missing')
                      ? 'full.missing'
                      : 'full.unavailable',
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FileRequestsTable files={fullFiles} />
            {full?.file.body != null && (
              <RawFile body={full.file.body} truncated={full.file.truncated} />
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
