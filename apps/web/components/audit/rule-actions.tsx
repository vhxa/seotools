'use client'

import type { AuditRule } from '@seotools/core/crawl/audit'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useOptimistic, useState, useTransition } from 'react'
import {
  deleteAuditRuleAction,
  setAuditRuleEnabledAction,
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
import { Switch } from '@/components/ui/switch'

/** Turns a rule on or off. A rule that is off is kept, and decides nothing. */
export function RuleToggle({ host, rule }: { host: string; rule: AuditRule }) {
  const t = useTranslations('AuditRules')
  const text = useSelectorText()
  const [, startTransition] = useTransition()
  const [enabled, setEnabled] = useOptimistic(rule.enabled)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Switch
        size="sm"
        checked={enabled}
        aria-label={t('list.toggle', { rule: text(rule.selector) })}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setEnabled(next)
            const result = await setAuditRuleEnabledAction(host, rule.id, next)
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
export function RuleRowActions({
  host,
  rule,
  languagesDeclared,
}: {
  host: string
  rule: AuditRule
  languagesDeclared: boolean
}) {
  const t = useTranslations('AuditRules')
  const text = useSelectorText()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const label = text(rule.selector)

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
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('form.editTitle')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>
          <RuleForm
            host={host}
            dimension={rule.dimension}
            languagesDeclared={languagesDeclared}
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
                  const result = await deleteAuditRuleAction(host, rule.id)
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
