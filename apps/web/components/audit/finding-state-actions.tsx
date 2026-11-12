'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { PAGE_ISSUES, isPageIssueId } from '@seotools/core/crawl/issues'
import { setFindingStateAction } from '@/app/(protected)/domains/[host]/finding-actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

/** A compact editor, shared by individual findings, Issues and table selection. */
export function FindingStateActions({
  host,
  issue,
  hashes = ['*'],
  restoreOnly = false,
}: {
  host: string
  issue: string
  hashes?: string[]
  restoreOnly?: boolean
}) {
  const t = useTranslations('FindingStates')
  const canEdit = useCanEdit()
  const [result, action, busy] = useActionState(setFindingStateAction.bind(null, host), {})
  if (!canEdit) return null
  const high =
    hashes.includes('*') &&
    isPageIssueId(issue) &&
    PAGE_ISSUES[issue].type === 'issue' &&
    PAGE_ISSUES[issue].importance === 'high'
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {t(restoreOnly ? 'restore' : 'actions')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('actions')}</DialogTitle>
        </DialogHeader>
        <form
          action={action}
          className="grid max-w-sm gap-2 py-2"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null
            if (high && submitter?.value === 'dismissed' && !window.confirm(t('confirmDomain')))
              event.preventDefault()
          }}
        >
          <input type="hidden" name="issue" value={issue} />
          {hashes.map((hash) => (
            <input key={hash} type="hidden" name="urlHash" value={hash} />
          ))}
          <label className="grid gap-1">
            {t('note')}
            <Textarea name="note" maxLength={1000} disabled={busy} />
          </label>
          <div className="flex flex-wrap gap-2">
            {!restoreOnly && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="state"
                value="in-progress"
                disabled={busy}
              >
                {t('in-progress')}
              </Button>
            )}
            {!restoreOnly && !issue.startsWith('expected-') && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="state"
                value="dismissed"
                disabled={busy}
              >
                {t(hashes.includes('*') ? 'dismissDomain' : 'dismiss')}
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="state"
              value="pending"
              disabled={busy}
            >
              {t('restore')}
            </Button>
          </div>
          {result.error && <p role="alert">{result.error}</p>}
          {result.saved && <p role="status">{t('saved')}</p>}
        </form>
      </DialogContent>
    </Dialog>
  )
}
