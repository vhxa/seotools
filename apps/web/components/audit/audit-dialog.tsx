'use client'

import {
  AUDIT_LIMITS,
  AUDIT_VALUES,
  INDEX_INTENTS,
  type AuditValue,
  type IndexIntent,
} from '@seotools/core/crawl/audit'
import { cn } from 'cn'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition, type ReactNode } from 'react'
import { setUrlAuditAction } from '@/app/(protected)/domains/[host]/audit-actions'
import { EffectiveNote } from '@/components/audit/effective-note'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { outcomeAfter, type AuditOutcome, type UrlAuditCurrent } from '@/lib/audit-rules'

/** The three choices of the audit, and of the expected indexing: the rules, or an exception. */
export type AuditPick = 'rules' | AuditValue
export type IntentPick = 'rules' | IndexIntent

/** What to start from when several URLs are being changed. Nothing is chosen unless it is here. */
export interface AuditDialogPreset {
  audit?: AuditPick
}

function Choice({ value, label, locked }: { value: string; label: string; locked: boolean }) {
  return (
    <Label className={cn('flex items-center gap-2 font-normal', locked && 'text-muted-foreground')}>
      <RadioGroupItem value={value} className="data-disabled:cursor-not-allowed" />
      {label}
    </Label>
  )
}

/**
 * A group of choices that, for several URLs, is only edited if its box is checked. Whatever is not
 * being edited is disabled for real, not just dimmed (`disabled` on the controls, so they report
 * `aria-disabled` and ignore the keyboard too), as the request already leaves it out.
 */
function Dimension({
  label,
  changeLabel,
  multiple,
  changing,
  onChanging,
  children,
  note,
}: {
  label: string
  changeLabel: string
  multiple: boolean
  changing: boolean
  onChanging: (value: boolean) => void
  children: (locked: boolean) => ReactNode
  note?: ReactNode
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {multiple && (
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={changing} onCheckedChange={onChanging} />
          {changeLabel}
        </Label>
      )}
      <div>{children(multiple && !changing)}</div>
      {note}
    </fieldset>
  )
}

/**
 * Under a group, for one URL: what it is now, and, once the choice differs from what is saved, what
 * it will be after saving. Both are the effective result with the rule that says so, so choosing
 * "according to the rules" shows what the rules give and not the exception that is going away.
 */
function Notes({
  kind,
  now,
  after,
  changed,
}: {
  kind: 'audit' | 'intent' | 'nofollow'
  now: AuditOutcome
  after: AuditOutcome
  changed: boolean
}) {
  if (!changed) return <EffectiveNote kind={kind} outcome={now} />
  return (
    <div className="grid gap-0.5" aria-live="polite">
      <EffectiveNote kind={kind} outcome={now} prefix="now" />
      <EffectiveNote kind={kind} outcome={after} prefix="afterSave" />
    </div>
  )
}

function AuditForm({
  host,
  urls,
  current,
  preset,
  onClose,
}: {
  host: string
  urls: string[]
  /** Set for one URL, which starts from what it has; absent for several. */
  current?: UrlAuditCurrent
  preset: AuditDialogPreset
  onClose: (applied: boolean) => void
}) {
  const t = useTranslations('AuditDialog')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const multiple = current === undefined

  // One URL starts from the exceptions it really has; several start from nothing chosen.
  const initialAudit: AuditPick = current?.explicit.audit ?? 'rules'
  const initialIntent: IntentPick = current?.explicit.intent ?? 'rules'
  const initialAccept = current?.intent.acceptNofollow ?? false
  const [audit, setAudit] = useState<AuditPick>(preset.audit ?? initialAudit)
  const [intent, setIntent] = useState<IntentPick>(initialIntent)
  const [accept, setAccept] = useState(initialAccept)
  const [changeAudit, setChangeAudit] = useState(preset.audit !== undefined)
  const [changeIntent, setChangeIntent] = useState(false)
  const [changeAccept, setChangeAccept] = useState(false)
  const [reason, setReason] = useState(current?.reason ?? '')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** What the URL will be once saved, worked out as saving does. One URL only. */
  const after = current ? outcomeAfter(current, { audit, intent, accept }) : null

  /** What to send: only what the user chose to change, so nothing else can be reset by saving. */
  function request() {
    const body: Record<string, unknown> = { urls }
    const sendAudit = multiple ? changeAudit : audit !== initialAudit
    const sendIntent = multiple ? changeIntent : intent !== initialIntent
    const sendAccept = multiple ? changeAccept : accept !== initialAccept
    // Only a reason that was written is sent; otherwise each exception keeps its own.
    const sendReason = reasonTouched
    // A reason changed with nothing else changed re-saves the exceptions the URL has.
    const keepAudit = !multiple && sendReason && !sendAudit && initialAudit !== 'rules'
    const keepIntent =
      !multiple && sendReason && !sendIntent && !sendAccept && current.explicit.hasIntentException
    if (sendAudit) body.audit = audit === 'rules' ? 'inherit' : audit
    else if (keepAudit) body.audit = initialAudit
    // The expectation and nofollow are independent: going back to the rules for one leaves the other.
    if (sendIntent) body.intent = intent === 'rules' ? 'inherit' : intent
    else if (keepIntent && initialIntent !== 'rules') body.intent = initialIntent
    if (sendAccept || (keepIntent && initialIntent === 'rules')) body.acceptNofollow = accept
    if (sendReason) body.reason = reason
    return { body, any: sendAudit || sendIntent || sendAccept || keepAudit || keepIntent }
  }

  const apply = () => {
    const { body, any } = request()
    if (!any) {
      setError(t('nothing'))
      return
    }
    setError(null)
    startTransition(async () => {
      // One request for every URL and every dimension asked for, so they are all set, or none is.
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

        <Dimension
          label={t('auditLabel')}
          changeLabel={t('changeAudit')}
          multiple={multiple}
          changing={changeAudit}
          onChanging={setChangeAudit}
          note={
            current &&
            after && (
              <Notes kind="audit" now={current} after={after} changed={audit !== initialAudit} />
            )
          }
        >
          {(locked) => (
            <RadioGroup
              value={audit}
              onValueChange={(value) => setAudit(value as AuditPick)}
              disabled={locked}
            >
              <Choice value="rules" label={t('rules')} locked={locked} />
              {[...AUDIT_VALUES].reverse().map((value) => (
                <Choice key={value} value={value} label={t(value)} locked={locked} />
              ))}
            </RadioGroup>
          )}
        </Dimension>

        <Dimension
          label={t('intentLabel')}
          changeLabel={t('changeIntent')}
          multiple={multiple}
          changing={changeIntent}
          onChanging={setChangeIntent}
          note={
            current &&
            after && (
              <Notes kind="intent" now={current} after={after} changed={intent !== initialIntent} />
            )
          }
        >
          {(locked) => (
            <RadioGroup
              value={intent}
              onValueChange={(value) => setIntent(value as IntentPick)}
              disabled={locked}
            >
              <Choice value="rules" label={t('rules')} locked={locked} />
              {INDEX_INTENTS.map((value) => (
                <Choice key={value} value={value} label={t(value)} locked={locked} />
              ))}
            </RadioGroup>
          )}
        </Dimension>

        <Dimension
          label={t('directivesLabel')}
          changeLabel={t('changeNofollow')}
          multiple={multiple}
          changing={changeAccept}
          onChanging={setChangeAccept}
          note={
            current &&
            after && (
              <Notes
                kind="nofollow"
                now={current}
                after={after}
                changed={
                  accept !== initialAccept ||
                  (after.intent.acceptRule?.exception ?? false) !==
                    (current.intent.acceptRule?.exception ?? false)
                }
              />
            )
          }
        >
          {(locked) => (
            <Label
              className={cn(
                'flex items-start gap-2 font-normal',
                locked && 'text-muted-foreground',
              )}
            >
              <Checkbox
                checked={accept}
                onCheckedChange={(value) => setAccept(value === true)}
                disabled={locked}
                className="data-disabled:cursor-not-allowed"
              />
              <span className="grid gap-0.5">
                {t('acceptNofollow')}
                <span className="text-xs text-muted-foreground">{t('acceptNofollowHelp')}</span>
              </span>
            </Label>
          )}
        </Dimension>

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
 * Sets, for exact URLs, whether they are audited and what is expected of their indexing: the one
 * way to do it from the table and from the detail of a URL. Both have the same three choices per
 * dimension, "according to the rules" first, which removes the exception.
 *
 * For one URL (`current`) the choices start from the exceptions it really has, with what the rules
 * give under each; only what changes is sent. For several, nothing is chosen until its box is
 * checked, and what is left unchecked is never touched, whatever each URL has. The form starts over
 * each time it opens.
 */
export function AuditDialog({
  host,
  urls,
  open,
  onOpenChange,
  current,
  preset = {},
  onApplied,
}: {
  host: string
  urls: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  current?: UrlAuditCurrent
  preset?: AuditDialogPreset
  /** After the change was saved, which closing without it is not. */
  onApplied?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <AuditForm
          host={host}
          urls={urls}
          {...(current ? { current } : {})}
          preset={preset}
          onClose={(applied) => {
            onOpenChange(false)
            if (applied) onApplied?.()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
