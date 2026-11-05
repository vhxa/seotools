'use client'

import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

/** The submit button of the "check now" form: it says it is working while the request goes. */
export function CheckNowButton() {
  const t = useTranslations('Updates')
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
      <RefreshCwIcon className={pending ? 'animate-spin' : undefined} />
      {pending ? t('checking') : t('checkNow')}
    </Button>
  )
}
