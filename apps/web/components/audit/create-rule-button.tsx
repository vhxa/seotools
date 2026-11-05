'use client'

import { PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { RuleForm } from '@/components/audit/rule-form'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** "Create rule": opens the editor in a dialog, with the preview inside it. */
export function CreateRuleButton({
  host,
  languagesDeclared,
  variant = 'default',
}: {
  host: string
  languagesDeclared: boolean
  variant?: 'default' | 'outline'
}) {
  const t = useTranslations('AuditRules')
  const canEdit = useCanEdit()
  const [open, setOpen] = useState(false)
  if (!canEdit) return null
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon />
        {t('create')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('form.addTitle')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>
          <RuleForm
            host={host}
            languagesDeclared={languagesDeclared}
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
