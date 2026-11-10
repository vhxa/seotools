'use client'

import { ListIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { startListCrawlAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useFormActionState } from '@/hooks/use-form-action-state'

/** The form of the dialog: mounted only while it is open, so each opening starts clean. */
function ListCrawlForm({ host, onStarted }: { host: string; onStarted: () => void }) {
  const t = useTranslations('Crawls.list')
  const [state, onSubmit, pending] = useFormActionState<ActionState>(async (previous, form) => {
    const next = await startListCrawlAction(host, previous, form)
    if (next.saved) onStarted()
    return next
  }, {})
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Label htmlFor="list-urls">{t('label')}</Label>
      <Textarea id="list-urls" name="urls" required maxLength={2_048_000} className="min-h-40" />
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t('start')}
      </Button>
    </form>
  )
}

/** "Crawl a URL list": the form to crawl only the URLs of a list, in a dialog. */
export function ListCrawlDialog({ host, disabled }: { host: string; disabled?: boolean }) {
  const t = useTranslations('Crawls.list')
  const canEdit = useCanEdit()
  const [open, setOpen] = useState(false)
  if (!canEdit) return null
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <ListIcon />
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <ListCrawlForm host={host} onStarted={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
