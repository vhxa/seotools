'use client'

import { useTranslations } from 'next-intl'
import { saveLanguageAction, updateNameAction } from '@/app/(protected)/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useFormActionState } from '@/hooks/use-form-action-state'
import { LANGUAGE_CHOICES, MAX_NAME_LENGTH, type LanguageChoice } from '@/lib/account-forms'

/** Edits one's own name; the email below it is not editable. */
export function NameForm({ name }: { name: string }) {
  const t = useTranslations('Account.name')
  const [state, onSubmit, pending] = useFormActionState(updateNameAction, {})
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="account-name">{t('label')}</Label>
        <Input
          id="account-name"
          name="name"
          defaultValue={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          required
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('saved')}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )
}

/** The interface language: follow the browser, or one of the shipped languages. */
export function LanguageForm({ value }: { value: LanguageChoice }) {
  const t = useTranslations('Account.language')
  const [state, onSubmit, pending] = useFormActionState(saveLanguageAction, {})
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t('label')}</legend>
        <RadioGroup name="language" defaultValue={value}>
          {LANGUAGE_CHOICES.map((choice) => (
            <div key={choice} className="flex items-center gap-2">
              <RadioGroupItem id={`language-${choice}`} value={choice} />
              <Label htmlFor={`language-${choice}`} className="font-normal">
                {t(choice)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('saved')}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )
}
