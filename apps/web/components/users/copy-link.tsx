'use client'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** A link to hand over, which cannot be shown again. */
export function CopyLink({ link }: { link: string }) {
  const t = useTranslations('Users.link')
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={link} aria-label={t('label')} onFocus={(e) => e.target.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={copied ? t('copied') : t('copy')}
        title={copied ? t('copied') : t('copy')}
        onClick={async () => {
          await navigator.clipboard.writeText(link)
          setCopied(true)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
