'use client'

import { DownloadIcon, ListChecksIcon, TableIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { exportHref, type DetailQuery } from '@/lib/pages-query'

/**
 * Downloads what the table lists as a CSV: the pages, or their findings. The links carry the
 * address of the table, so the file holds every row its filters leave and not the page on screen.
 * They are plain links: the server answers with a download, or with the reason there is none.
 */
export function ExportMenu({
  host,
  query,
  analysed,
}: {
  host: string
  query: DetailQuery
  /** Whether the crawl was checked for findings: without it there are none to export. */
  analysed: boolean
}) {
  const t = useTranslations('Export.menu')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <DownloadIcon />
        {t('label')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('heading')}
            <span className="block font-normal">{t('scope')}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem
            render={<a href={exportHref(host, query, 'pages')} />}
            className="items-start"
          >
            <TableIcon className="mt-0.5" />
            <span className="grid gap-0.5">
              {t('pages')}
              <span className="text-xs text-muted-foreground">{t('pagesHint')}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<a href={exportHref(host, query, 'findings')} />}
            disabled={!analysed}
            className="items-start"
          >
            <ListChecksIcon className="mt-0.5" />
            <span className="grid gap-0.5">
              {t('findings')}
              <span className="text-xs text-muted-foreground">
                {analysed ? t('findingsHint') : t('notAnalysed')}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
