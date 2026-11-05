'use client'

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import {
  archiveDomainAction,
  deleteDomainAction,
  moveDomainAction,
  unarchiveDomainAction,
} from '@/app/(protected)/companies/actions'
import { ActionDialog } from '@/components/companies/action-dialog'
import { UsageList, type UsageCounts } from '@/components/companies/usage-list'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { accessAfterMove } from '@/lib/domain-move'

export interface DomainActionsProps {
  domain: { id: string; host: string; archived: boolean }
  company: { id: string; name: string }
  /** Every company, for the one to move to. */
  companies: { id: string; name: string }[]
  usage: UsageCounts
}

type Dialogs = 'archive' | 'move' | 'changeSite' | 'delete'

/** Archive or restore, move, change site and delete, for one domain of the companies page. */
export function DomainActions({ domain, company, companies, usage }: DomainActionsProps) {
  const t = useTranslations('Companies')
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const [restoring, startRestore] = useTransition()
  const close = () => setDialog(null)
  const others = companies.filter((other) => other.id !== company.id)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('actionsLabel', { name: domain.host })}
              disabled={restoring}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link href={`/domains/${domain.host}`} />}>
            {t('domain.open')}
          </DropdownMenuItem>
          {domain.archived ? (
            <DropdownMenuItem
              onClick={() =>
                startRestore(async () => void (await unarchiveDomainAction(domain.id)))
              }
            >
              {t('domain.restore')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setDialog('archive')}>
              {t('domain.archive')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={others.length === 0} onClick={() => setDialog('move')}>
            {t('domain.move')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('changeSite')}>
            {t('domain.changeSite')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
            {t('domain.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'archive' && (
        <ActionDialog
          title={t('archive.title', { host: domain.host })}
          description={t('archive.description')}
          action={archiveDomainAction}
          fields={{ domainId: domain.id }}
          submitLabel={t('archive.submit')}
          pendingLabel={t('archive.submitting')}
          onClose={close}
        />
      )}
      {dialog === 'move' && (
        <MoveDialog domain={domain} from={company} targets={others} onClose={close} />
      )}
      {dialog === 'changeSite' && <ChangeSiteDialog companyId={company.id} onClose={close} />}
      {dialog === 'delete' && (
        <ActionDialog
          title={t('delete.domainTitle', { host: domain.host })}
          description={
            <div className="grid gap-2">
              <p>{t('delete.domainLead', { host: domain.host })}</p>
              <UsageList usage={usage} />
              {!domain.archived && (
                <p className="text-muted-foreground">{t('delete.keepHistory')}</p>
              )}
            </div>
          }
          action={deleteDomainAction}
          fields={{ domainId: domain.id }}
          confirm={{ value: domain.host }}
          submitLabel={t('delete.domainSubmit')}
          pendingLabel={t('delete.submitting')}
          destructive
          onClose={close}
        />
      )}
    </>
  )
}

function MoveDialog({
  domain,
  from,
  targets,
  onClose,
}: {
  domain: { id: string; host: string }
  from: { id: string; name: string }
  targets: { id: string; name: string }[]
  onClose: () => void
}) {
  const t = useTranslations('Companies')
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '')
  const target = targets.find((other) => other.id === targetId)
  const items = targets.map((other) => ({ value: other.id, label: other.name }))
  const access = target ? accessAfterMove({ from, to: target }) : null

  return (
    <ActionDialog
      title={t('move.title', { host: domain.host })}
      description={
        <div className="grid gap-2">
          <p>{t('move.results')}</p>
          {access && <p>{t(`move.access.${access.kind}`)}</p>}
        </div>
      }
      action={moveDomainAction}
      fields={{ domainId: domain.id, companyId: targetId }}
      submitLabel={t('move.submit')}
      pendingLabel={t('move.submitting')}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="move-company">{t('move.label')}</Label>
        <Select
          items={items}
          value={targetId}
          onValueChange={(value) => value && setTargetId(value)}
        >
          <SelectTrigger id="move-company" className="w-full">
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
    </ActionDialog>
  )
}

/** There is no editing a domain's host: one line says what to do instead. */
function ChangeSiteDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const t = useTranslations('Companies')
  const tDelete = useTranslations('Companies.delete')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('changeSite.title')}</DialogTitle>
          <DialogDescription>{t('changeSite.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tDelete('close')}
          </Button>
          <Link
            href={`/domains/new?company=${encodeURIComponent(companyId)}`}
            className={buttonVariants()}
          >
            {t('changeSite.addDomain')}
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
