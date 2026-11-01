'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { createCompanyAction, type CompanyFormState } from '@/app/(protected)/companies/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Company name + first domain. Shared by the first-run onboarding and "Add company". */
export function CompanyForm({
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  submitLabel: string
  pendingLabel: string
  /** Shows a cancel link when there is somewhere to go back to (not during onboarding). */
  cancelHref?: string
}) {
  const t = useTranslations('CompanyFields')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState<CompanyFormState, FormData>(
    createCompanyAction,
    {},
  )

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="company">{t('companyLabel')}</Label>
        <Input
          id="company"
          name="company"
          placeholder={t('companyPlaceholder')}
          autoComplete="organization"
          defaultValue={state.values?.company}
          aria-describedby="company-hint"
          required
          autoFocus
        />
        <p id="company-hint" className="text-xs text-muted-foreground">
          {t('companyHint')}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="domain">{t('domainLabel')}</Label>
        <Input
          id="domain"
          name="domain"
          placeholder={t('domainPlaceholder')}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.values?.domain}
          aria-describedby="domain-hint"
          required
        />
        <p id="domain-hint" className="text-xs text-muted-foreground">
          {t('domainHint')}
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {cancelHref && (
          <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
            {tCommon('cancel')}
          </Link>
        )}
      </div>
    </form>
  )
}
