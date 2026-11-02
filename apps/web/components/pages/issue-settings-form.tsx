'use client'

import { ISSUE_TYPES, type IssueType } from '@seotools/core/crawl/issues'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { saveIssueSettingsAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useFormActionState } from '@/hooks/use-form-action-state'

export function IssueSettingsForm({ host, threshold }: { host: string; threshold: IssueType }) {
  const t = useTranslations('IssueSettings')
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    saveIssueSettingsAction.bind(null, host),
    {},
  )
  const [value, setValue] = useState<string>(threshold)
  const options = ISSUE_TYPES.map((type) => ({
    value: type,
    label: t(`threshold.options.${type}`),
  }))

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor="issueThreshold">{t('threshold.label')}</Label>
        <Select
          name="issueThreshold"
          items={options}
          value={value}
          onValueChange={(next) => next && setValue(next)}
        >
          <SelectTrigger id="issueThreshold" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {options.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('threshold.hint')}</p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
        {state.saved && !pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  )
}
