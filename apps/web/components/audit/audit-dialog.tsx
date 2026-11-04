'use client'

import { AUDIT_CONDITIONS, AUDIT_LIMITS, type AuditCondition } from '@seotools/core/crawl/audit'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { setUrlAuditAction } from '@/app/(protected)/domains/[host]/audit-actions'
import {
  AuditStatements,
  picksOf,
  touchedConditions,
  type StatementPicks,
} from '@/components/audit/audit-statements'
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
import { outcomeAfter, type AuditPicks, type UrlAuditCurrent } from '@/lib/audit-rules'

/** What one URL starts from: the exceptions it really has, and "according to the rules" for the rest. */
function picksFromCurrent(current: UrlAuditCurrent): StatementPicks {
  return {
    audit: current.explicit.audit ?? 'inherit',
    intent: current.explicit.intent ?? 'inherit',
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [
        condition,
        current.explicit.conditions[condition] ?? 'inherit',
      ]),
    ) as StatementPicks['conditions'],
  }
}

/** The picks of a single URL as the outcome calculation wants them: `rules` for "according to the rules". */
function asOutcomePicks(picks: StatementPicks): AuditPicks {
  const rules = <V extends string>(pick: 'keep' | 'inherit' | V) =>
    pick === 'keep' || pick === 'inherit' ? ('rules' as const) : pick
  return {
    audit: rules(picks.audit),
    intent: rules(picks.intent),
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [condition, rules(picks.conditions[condition])]),
    ) as AuditPicks['conditions'],
  }
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
  const initial = current ? picksFromCurrent(current) : picksOf('keep')
  const neutral = multiple ? 'keep' : 'inherit'
  const [picks, setPicks] = useState<StatementPicks>(initial)
  const [shown, setShown] = useState<AuditCondition[]>(touchedConditions(initial, neutral))
  const [reason, setReason] = useState(current?.reason ?? '')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** What the URL will be once saved, worked out as saving does. One URL only. */
  const after = current ? outcomeAfter(current, asOutcomePicks(picks)) : null

  /**
   * What to send: only what the user chose to change, so nothing else can be reset by saving. "No
   * change" is a statement left out; "according to the rules" is `inherit`, which removes the
   * exception. A reason written for one URL with nothing else changed re-saves its exceptions.
   */
  function request() {
    const body: Record<string, unknown> = { urls }
    const conditions: Record<string, string> = {}
    let any = false
    const send = (pick: string, was: string, set: (value: string) => void) => {
      if (pick === 'keep') return
      if (pick !== was || (reasonTouched && !multiple && was !== 'inherit')) {
        set(pick)
        any = true
      }
    }
    send(picks.audit, initial.audit, (value) => (body.audit = value))
    send(picks.intent, initial.intent, (value) => (body.intent = value))
    for (const condition of AUDIT_CONDITIONS) {
      send(picks.conditions[condition], initial.conditions[condition], (value) => {
        conditions[condition] = value
      })
    }
    if (Object.keys(conditions).length > 0) body.conditions = conditions
    // Only a reason that was written is sent; otherwise each exception keeps its own.
    if (reasonTouched) body.reason = reason
    return { body, any }
  }

  const apply = () => {
    const { body, any } = request()
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
          shown={shown}
          onShown={setShown}
          idBase="audit-dialog"
          {...(current && after ? { current, after } : {})}
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
        <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button onClick={apply} disabled={pending}>
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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
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
