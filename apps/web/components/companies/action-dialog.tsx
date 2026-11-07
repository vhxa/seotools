'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState, type ReactNode } from 'react'
import type { ManageState } from '@/app/(protected)/system/companies/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFormActionState } from '@/hooks/use-form-action-state'

export interface ActionDialogProps {
  title: string
  description?: ReactNode
  /** The server action that does it. What it needs from the row goes in `fields`, never in the UI. */
  action: (previous: ManageState, formData: FormData) => Promise<ManageState>
  fields: Record<string, string>
  submitLabel: string
  pendingLabel: string
  destructive?: boolean
  /** Something the person must type to enable the button; the server checks it again. */
  confirm?: { value: string }
  /** Inputs of the dialog, inside its form. */
  children?: ReactNode
  onClose: () => void
}

/**
 * A dialog with one form: it closes itself when the action says it is `done`, and shows its error
 * otherwise. The content is only mounted while open, so each opening starts from a clean state.
 */
export function ActionDialog(props: ActionDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <Body {...props} />
      </DialogContent>
    </Dialog>
  )
}

function Body({
  title,
  description,
  action,
  fields,
  submitLabel,
  pendingLabel,
  destructive,
  confirm,
  children,
  onClose,
}: ActionDialogProps) {
  const t = useTranslations('Companies.delete')
  const [state, onSubmit, pending] = useFormActionState<ManageState>(action, {})
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (state.done) onClose()
  }, [state, onClose])

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription render={<div />}>{description}</DialogDescription>}
      </DialogHeader>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {confirm && (
        <div className="grid gap-2">
          <Label htmlFor="confirm">{t('confirmLabel', { value: confirm.value })}</Label>
          <Input
            id="confirm"
            name="confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={state.error ? true : undefined}
          />
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('close')}
        </Button>
        <Button
          type="submit"
          variant={destructive ? 'destructive' : 'default'}
          disabled={pending || (confirm !== undefined && typed.trim() === '')}
        >
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
