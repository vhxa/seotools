'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { RenderStatus } from '@seotools/core/render-status'
import { checkRenderBrowserAction } from '@/app/(protected)/system/integrations/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFormStatus } from 'react-dom'

function CheckButton() {
  const t = useTranslations('RenderBrowser')
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {t(pending ? 'checking' : 'check')}
    </Button>
  )
}

export function RenderBrowserCard({ status }: { status: RenderStatus | null }) {
  const t = useTranslations('RenderBrowser')
  const format = useFormatter()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p role="status">{t(status?.state ?? 'unknown')}</p>
        {status?.version && <p>{t('version', { version: status.version })}</p>}
        {status && (
          <p className="text-sm text-muted-foreground">
            {t('checked', {
              when: format.dateTime(new Date(status.checkedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        )}
        <a
          className="text-sm underline"
          href="https://github.com/vhxa/seotools/blob/main/docs/rendering.md"
          target="_blank"
          rel="noreferrer"
        >
          {t('guide')}
        </a>
        <form action={checkRenderBrowserAction}>
          <CheckButton />
        </form>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      </CardContent>
    </Card>
  )
}
