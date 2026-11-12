'use client'

import { AUDIT_CONDITIONS, AUDIT_LIMITS } from '@seotools/core/crawl/audit'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { setUrlAuditAction } from '@/app/(protected)/domains/[host]/audit-actions'
import { AuditStatements } from '@/components/audit/audit-statements'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  inheritedOfUrl,
  picksOf,
  picksOfUrl,
  urlRequest,
  type InheritedPicks,
  type StatementPicks,
} from '@/lib/audit-editor'
import type { UrlAuditCurrent } from '@/lib/audit-rules'

const NOTHING_TO_INHERIT: InheritedPicks = {
  audit: { position: null, origin: { kind: 'default' } },
  intent: { position: null, origin: { kind: 'default' } },
  conditions: Object.fromEntries(
    AUDIT_CONDITIONS.map((condition) => [
      condition,
      { position: null, origin: { kind: 'default' } },
    ]),
  ) as InheritedPicks['conditions'],
}

function AuditForm({
  host,
  urls,
  current,
  onClose,
}: {
  host: string
  urls: string[]
  /** Set for one URL, which starts from what it has; absent for several. */
  current?: UrlAuditCurrent
  onClose: (applied: boolean) => void
}) {
  const t = useTranslations('AuditDialog')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const multiple = current === undefined

  // One URL starts from the exceptions it really has; several start from "no change".
  const initial = current ? picksOfUrl(current) : picksOf('keep')
  const [picks, setPicks] = useState<StatementPicks>(initial)
  const [reason, setReason] = useState(current?.reason ?? '')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Several URLs have nothing in common to inherit: their controls say "no change" instead.
  const inherited: InheritedPicks = current ? inheritedOfUrl(current) : NOTHING_TO_INHERIT

  const apply = () => {
    const { body, any } = urlRequest({ urls, picks, initial, multiple, reason, reasonTouched })
    if (!any) {
      setError(t('nothing'))
      return
    }
    setError(null)
    startTransition(async () => {
      // One request for every URL and every statement asked for, so they are all set, or none is.
      const result = await setUrlAuditAction(host, body)
      if (result.error) {
        setError(result.error)
        return
      }
      router.refresh()
      onClose(true)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {multiple ? t('description', { count: urls.length }) : t('descriptionOne')}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        {multiple && <p className="text-sm text-muted-foreground">{t('multipleHint')}</p>}

        <AuditStatements
          mode={multiple ? 'bulk' : 'single'}
          subject="url"
          picks={picks}
          onChange={setPicks}
          inherited={inherited}
          idBase="audit-dialog"
        />

        <div className="grid gap-2">
          <Label htmlFor="audit-dialog-reason">{t('reason')}</Label>
          <Textarea
            id="audit-dialog-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setReasonTouched(true)
            }}
            maxLength={AUDIT_LIMITS.reason}
            placeholder={t('reasonPlaceholder')}
            rows={2}
          />
          {multiple && <p className="text-xs text-muted-foreground">{t('reasonKept')}</p>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="button" onClick={apply} disabled={pending}>
          {pending ? t('applying') : t('apply')}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * The one way to configure the audit of exact URLs, from the table and from the detail of a URL:
 * whether they take part in the audit, what is required, allowed or forbidden of each condition,
 * and, as an advanced concept, what is expected of their indexing as a whole. It sets the exception
 * for each URL, with the same editor and the same model as the rules of the settings page.
 *
 * For one URL (`current`) each statement starts from the exception the URL really has, and shows what
 * the rules give if it goes; only what changes is sent. For several, "No change" is the start of every
 * statement and what is left alone is never touched, whatever each URL has. The form starts over each
 * time it opens.
 */
export function AuditDialog({
  host,
  urls,
  open,
  onOpenChange,
  current,
  onApplied,
}: {
  host: string
  urls: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  current?: UrlAuditCurrent
  /** After the change was saved, which closing without it is not. */
  onApplied?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {/* Mounted only while open, so that the form starts from what the URLs have right now. */}
        {open && (
          <AuditForm
            host={host}
            urls={urls}
            {...(current ? { current } : {})}
            onClose={(applied) => {
              onOpenChange(false)
              if (applied) onApplied?.()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
