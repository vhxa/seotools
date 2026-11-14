import { InfoIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Two crawls that looked at the site in different ways (served HTML, or a browser) cannot be
 * compared for what depends on the way: each page's content, which pages link to which, and every
 * JavaScript finding. Only findings about the server's answer are compared as usual.
 */
export function RenderingPairNote({ earlier, later }: { earlier: boolean; later: boolean }) {
  const t = useTranslations('RenderingSummary.pair')
  if (earlier === later) return null
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>{t(earlier ? 'renderedToHtml' : 'htmlToRendered')}</AlertTitle>
      <AlertDescription className="grid gap-1">
        <p>{t('cannotCompare')}</p>
        <p>{t('canCompare')}</p>
      </AlertDescription>
    </Alert>
  )
}
