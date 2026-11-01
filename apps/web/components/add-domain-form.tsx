'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { addDomainAction, type AddDomainFormState } from '@/app/(protected)/companies/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function AddDomainForm({
  companies,
  defaultCompanyId,
  cancelHref,
}: {
  companies: { id: string; name: string }[]
  defaultCompanyId: string
  cancelHref: string
}) {
  const t = useTranslations('CompanyFields')
  const tNew = useTranslations('NewDomain')
  const tCommon = useTranslations('Common')
  const [state, formAction, pending] = useActionState<AddDomainFormState, FormData>(
    addDomainAction,
    {},
  )
  // Controlled, so the choice survives the form reset that follows a failed submit.
  const [companyId, setCompanyId] = useState(state.values?.companyId ?? defaultCompanyId)
  const items = companies.map((company) => ({ value: company.id, label: company.name }))

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="companyId">{tNew('companyLabel')}</Label>
        <Select
          name="companyId"
          items={items}
          value={companyId}
          onValueChange={(value) => value && setCompanyId(value)}
          required
        >
          <SelectTrigger id="companyId" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          autoFocus
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
          {pending ? tNew('submitting') : tNew('submit')}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  )
}
