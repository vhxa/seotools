'use client'

import type { AuditDimension } from '@seotools/core/crawl/audit'
import { PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { RuleForm } from '@/components/audit/rule-form'
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
  dimension,
  languagesDeclared,
  variant = 'default',
}: {
  host: string
  dimension: AuditDimension
  languagesDeclared: boolean
  variant?: 'default' | 'outline'
}) {
  const t = useTranslations('AuditRules')
  const [open, setOpen] = useState(false)
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
            dimension={dimension}
            languagesDeclared={languagesDeclared}
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
