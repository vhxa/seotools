'use client'

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { deleteCompanyAction, renameCompanyAction } from '@/app/(protected)/companies/actions'
import { ActionDialog } from '@/components/companies/action-dialog'
import { UsageList, type UsageCounts } from '@/components/companies/usage-list'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface CompanyActionsProps {
  company: { id: string; name: string }
  hosts: string[]
  /** What deleting the company removes: everything of every one of its domains. */
  usage: UsageCounts
}

/** Rename, add a domain and delete, for one company of the companies page. */
export function CompanyActions({ company, hosts, usage }: CompanyActionsProps) {
  const t = useTranslations('Companies')
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const close = () => setDialog(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('actionsLabel', { name: company.name })}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDialog('rename')}>
            {t('company.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<Link href={`/domains/new?company=${encodeURIComponent(company.id)}`} />}
          >
            {t('company.addDomain')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
            {t('company.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'rename' && (
        <ActionDialog
          title={t('rename.title')}
          action={renameCompanyAction}
          fields={{ companyId: company.id }}
          submitLabel={t('rename.submit')}
          pendingLabel={t('rename.submitting')}
          onClose={close}
        >
          <div className="grid gap-2">
            <Label htmlFor="name">{t('rename.label')}</Label>
            <Input id="name" name="name" defaultValue={company.name} autoComplete="off" required />
          </div>
        </ActionDialog>
      )}
      {dialog === 'delete' && (
        <ActionDialog
          title={t('delete.companyTitle', { name: company.name })}
          description={
            <div className="grid gap-2">
              <p>
                {hosts.length === 0
                  ? t('delete.companyLeadEmpty')
                  : t('delete.companyLead', {
                      domains: t('domainCount', { count: hosts.length }),
                      hosts: hosts.join(', '),
                    })}
              </p>
              <UsageList usage={usage} />
              <p className="text-muted-foreground">{t('delete.keepHistory')}</p>
            </div>
          }
          action={deleteCompanyAction}
          fields={{ companyId: company.id }}
          confirm={{ value: company.name }}
          submitLabel={t('delete.companySubmit')}
          pendingLabel={t('delete.submitting')}
          destructive
          onClose={close}
        />
      )}
    </>
  )
}
