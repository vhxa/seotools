'use client'

import type { AuditSelector } from '@seotools/core/crawl/audit'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useOptimistic, useState, useTransition } from 'react'
import {
  deleteAuditRulesAction,
  setAuditRulesEnabledAction,
} from '@/app/(protected)/domains/[host]/audit-actions'
import { RuleForm } from '@/components/audit/rule-form'
import { useSelectorText } from '@/components/audit/selector-label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCanEdit } from '@/components/domain-access'
import { Switch } from '@/components/ui/switch'
import type { RuleGroup } from '@/lib/audit-rules'

/**
 * Turns a rule on or off, every statement it makes together. A rule that is off is kept, and decides
 * nothing.
 */
export function RuleToggle({
  host,
  ids,
  enabled: saved,
  selector,
}: {
  host: string
  /** Every row of the rule. */
  ids: string[]
  enabled: boolean
  selector: AuditSelector
}) {
  const t = useTranslations('AuditRules')
  const canEdit = useCanEdit()
  const text = useSelectorText()
  const [, startTransition] = useTransition()
  const [enabled, setEnabled] = useOptimistic(saved)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Switch
        size="sm"
        checked={enabled}
        disabled={!canEdit}
        aria-label={t('list.toggle', { rule: text(selector) })}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setEnabled(next)
            const result = await setAuditRulesEnabledAction(host, ids, next)
            setError(result.error ?? null)
          })
        }
      />
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </>
  )
}

/** The buttons to edit and delete a rule, each in a dialog of its own. */
export function RuleRowActions({ host, rule }: { host: string; rule: RuleGroup }) {
  const t = useTranslations('AuditRules')
  const canEdit = useCanEdit()
  const text = useSelectorText()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const label = text(rule.selector)

  if (!canEdit) return null
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${t('list.edit')}: ${label}`}
        title={t('list.edit')}
        onClick={() => setEditing(true)}
      >
        <PencilIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${t('list.delete')}: ${label}`}
        title={t('list.delete')}
        onClick={() => setDeleting(true)}
      >
        <Trash2Icon />
      </Button>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t('form.editTitle')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>
          <RuleForm
            rule={rule}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('list.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-2 block font-mono text-xs break-all">{label}</span>
              {t('list.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('form.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAuditRulesAction(host, rule.ids)
                  setError(result.error ?? null)
                })
              }
            >
              {t('list.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
