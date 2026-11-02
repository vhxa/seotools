'use client'

import type { LanguageConfig } from '@seotools/core/crawl/audit'
import { useTranslations } from 'next-intl'
import {
  saveAuditLanguagesAction,
  type LanguagesFormState,
} from '@/app/(protected)/domains/[host]/audit-actions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useFormActionState } from '@/hooks/use-form-action-state'
import { useState } from 'react'

/**
 * The language directories of the domain, and whether its default language also has pages without
 * one. Nothing is deduced: only what is declared here is recognised by the rules shared between
 * languages. It has a switch, so it submits without letting React reset the form.
 */
export function LanguagesForm({ host, languages }: { host: string; languages: LanguageConfig }) {
  const t = useTranslations('AuditRules.languages')
  const [state, onSubmit, saving] = useFormActionState<LanguagesFormState>(
    saveAuditLanguagesAction.bind(null, host),
    {},
  )
  const [unprefixed, setUnprefixed] = useState(languages.unprefixed)
  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {unprefixed && <input type="hidden" name="unprefixed" value="on" />}
      <div className="grid gap-2">
        <Label htmlFor="language-prefixes">{t('prefixes')}</Label>
        <Textarea
          id="language-prefixes"
          name="prefixes"
          defaultValue={languages.prefixes.join('\n')}
          placeholder={t('prefixesPlaceholder')}
          rows={5}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="max-w-sm font-mono"
          aria-describedby="language-prefixes-help"
        />
        <p id="language-prefixes-help" className="text-xs text-muted-foreground">
          {t('prefixesHelp')}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Switch
          id="language-unprefixed"
          checked={unprefixed}
          onCheckedChange={setUnprefixed}
          aria-describedby="language-unprefixed-help"
        />
        <div className="grid gap-0.5">
          <Label htmlFor="language-unprefixed">{t('unprefixed')}</Label>
          <p id="language-unprefixed-help" className="text-xs text-muted-foreground">
            {t('unprefixedHelp')}
          </p>
        </div>
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
        <Button type="submit" disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )
}
