import type { PairAssessment, PairNote } from '@seotools/core/crawl/compare'
import { CircleAlertIcon, InfoIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const sidesOf = (note: PairNote) => (note.sides.length === 2 ? 'both' : (note.sides[0] ?? 'both'))

/**
 * Why what two crawls show may not be what changed on the site: a pruned side, a crawl that stopped
 * at its URL limit, a different audit configuration or issue catalog. Each one is said out loud, next
 * to the results it affects, and the labels of the page are chosen to match (see `classifyFinding`).
 */
export function PairNotes({ assessment }: { assessment: PairAssessment }) {
  const t = useTranslations('CrawlCompare.notes')
  if (assessment.notes.length === 0) return null

  const title = (note: PairNote) => {
    const sides = sidesOf(note)
    switch (note.code) {
      case 'pruned':
        return t(`pruned.title.${sides}`)
      case 'unanalysed':
        return t(`unanalysed.title.${sides}`)
      case 'legacy':
        return t(`legacy.title.${sides}`)
      case 'incomplete':
        return t(`incomplete.title.${sides}`)
      case 'basis':
        return t('basis.title')
      case 'catalog':
        return t('catalog.title')
      case 'ignoredParameters':
        return t('ignoredParameters.title')
      case 'audit':
        return t('audit.title')
    }
  }

  return (
    <div className="grid gap-2">
      {assessment.notes.map((note) => {
        // A crawl without results or findings leaves less to compare; the rest only qualify it.
        const blocking = note.code === 'pruned' || note.code === 'unanalysed'
        const Icon = blocking ? CircleAlertIcon : InfoIcon
        return (
          <Alert key={note.code} variant={blocking ? 'destructive' : 'default'}>
            <Icon />
            <AlertTitle>{title(note)}</AlertTitle>
            <AlertDescription>{t(`${note.code}.description`)}</AlertDescription>
          </Alert>
        )
      })}
    </div>
  )
}
