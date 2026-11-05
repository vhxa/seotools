'use client'

import { useCanEdit } from '@/components/domain-access'
import { SlidersHorizontalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AuditDialog } from '@/components/audit/audit-dialog'
import { Button } from '@/components/ui/button'
import type { UrlAuditCurrent } from '@/lib/audit-rules'

/**
 * The one action on a URL for its audit and expected indexing: a button that opens the dialog with
 * the three choices per dimension, which sets the exception for this exact URL, as the table does
 * for a selection. Excluding from the audit is one of those choices, not a button of its own.
 */
export function UrlAuditActions({
  host,
  url,
  current,
}: {
  host: string
  url: string
  /** What the URL is under the rules in force now, and what exceptions it has. */
  current: UrlAuditCurrent
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('UrlDetail.audit')
  const [open, setOpen] = useState(false)
  if (!canEdit) return null
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontalIcon />
        {t('configure')}
      </Button>
      {/* Mounted only while open, so that the form starts from what the URL has right now. */}
      {open && (
        <AuditDialog
          host={host}
          urls={[url]}
          open
          onOpenChange={(value) => !value && setOpen(false)}
          current={current}
        />
      )}
    </>
  )
}
