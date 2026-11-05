'use client'

import type { AccessRole, UserRole } from '@seotools/core/access'
import { ACCESS_ROLES } from '@seotools/core/access'
import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState, useTransition } from 'react'
import {
  createAccessLinkAction,
  inviteUserAction,
  setUserDisabledAction,
  updateUserAccessAction,
  type UserActionState,
} from '@/app/(protected)/system/users/actions'
import { CopyLink } from '@/components/users/copy-link'
import { Button } from '@/components/ui/button'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GrantRow } from '@/lib/user-forms'

export interface AccessTarget {
  value: string
  label: string
}

function Choice({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string
  label: string
  value: string
  items: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-0">
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
  )
}

/** The role of an account and, for a member, what it can reach. Sent as `role` and `grants`. */
function AccessFields({
  initialRole,
  initialGrants,
  targets,
}: {
  initialRole: UserRole
  initialGrants: GrantRow[]
  targets: AccessTarget[]
}) {
  const t = useTranslations('Users')
  const [role, setRole] = useState<UserRole>(initialRole)
  const [grants, setGrants] = useState<GrantRow[]>(initialGrants)
  const roles = (['member', 'admin'] as const).map((value) => ({
    value,
    label: t(`roles.${value}`),
  }))
  const accessRoles = ACCESS_ROLES.map((value) => ({ value, label: t(`roles.${value}`) }))
  const free = targets.filter((target) => !grants.some((grant) => grant.target === target.value))

  return (
    <div className="grid gap-4">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="grants" value={JSON.stringify(grants)} />
      <div className="grid gap-2">
        <Label htmlFor="user-role">{t('columns.role')}</Label>
        <Choice
          id="user-role"
          label={t('columns.role')}
          value={role}
          items={roles}
          onChange={(next) => setRole(next as UserRole)}
        />
        <p className="text-xs text-muted-foreground">{t(`roleHelp.${role}`)}</p>
      </div>
      {role === 'member' && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t('columns.access')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={free.length === 0}
              onClick={() => {
                const next = free[0]
                if (next) setGrants([...grants, { target: next.value, role: 'viewer' }])
              }}
            >
              <PlusIcon />
              {t('access.add')}
            </Button>
          </div>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('access.nothing')}</p>
          ) : (
            <ul className="grid gap-2">
              {grants.map((grant, index) => {
                const options = targets.filter(
                  (target) =>
                    target.value === grant.target ||
                    !grants.some((other) => other.target === target.value),
                )
                return (
                  <li
                    key={grant.target}
                    className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-center gap-2"
                  >
                    <Choice
                      id={`grant-target-${index}`}
                      label={t('access.target')}
                      value={grant.target}
                      items={options}
                      onChange={(target) =>
                        setGrants(grants.map((g, i) => (i === index ? { ...g, target } : g)))
                      }
                    />
                    <Choice
                      id={`grant-role-${index}`}
                      label={t('columns.role')}
                      value={grant.role}
                      items={accessRoles}
                      onChange={(next) =>
                        setGrants(
                          grants.map((g, i) =>
                            i === index ? { ...g, role: next as AccessRole } : g,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('access.remove')}
                      title={t('access.remove')}
                      onClick={() => setGrants(grants.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('access.help')}</p>
        </div>
      )}
    </div>
  )
}

function ErrorLine({ error }: { error?: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null
}

/** A link that cannot be shown again, and how it travels. */
function LinkResult({ state, onClose }: { state: UserActionState; onClose: () => void }) {
  const t = useTranslations('Users')
  return (
    <>
      <div className="grid gap-2">
        <p className="text-sm">{t(state.emailed ? 'link.emailed' : 'link.handOver')}</p>
        {state.link && <CopyLink link={state.link} />}
        <p className="text-xs text-muted-foreground">{t('link.once')}</p>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          {t('close')}
        </Button>
      </DialogFooter>
    </>
  )
}

export function InviteUserButton({ targets }: { targets: AccessTarget[] }) {
  const t = useTranslations('Users')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t('invite.button')}
      </Button>
      {open && <InviteDialog targets={targets} onClose={() => setOpen(false)} />}
    </>
  )
}

function InviteDialog({ targets, onClose }: { targets: AccessTarget[]; onClose: () => void }) {
  const t = useTranslations('Users')
  const [state, action, pending] = useActionState(inviteUserAction, {})
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('invite.title')}</DialogTitle>
          <DialogDescription>{t('invite.description')}</DialogDescription>
        </DialogHeader>
        {state.link ? (
          <LinkResult state={state} onClose={onClose} />
        ) : (
          <form action={action} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="invite-name">{t('invite.name')}</Label>
              <Input id="invite-name" name="name" required autoFocus maxLength={100} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-email">{t('invite.email')}</Label>
              <Input id="invite-email" name="email" type="email" required />
            </div>
            <AccessFields initialRole="member" initialGrants={[]} targets={targets} />
            <ErrorLine error={state.error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('close')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('invite.submitting') : t('invite.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AccessDialog({
  user,
  grants,
  targets,
  onClose,
}: {
  user: UserSummary
  grants: GrantRow[]
  targets: AccessTarget[]
  onClose: () => void
}) {
  const t = useTranslations('Users')
  const [state, action, pending] = useActionState(
    async (previous: UserActionState, formData: FormData) => {
      const next = await updateUserAccessAction(previous, formData)
      if (next.done) onClose()
      return next
    },
    {},
  )
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('edit.title', { name: user.name })}</DialogTitle>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="userId" value={user.id} />
          <AccessFields initialRole={user.role} initialGrants={grants} targets={targets} />
          <ErrorLine error={state.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('close')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('edit.submitting') : t('edit.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface UserSummary {
  id: string
  name: string
  role: UserRole
  disabled: boolean
  invited: boolean
}

export function UserActions({
  user,
  grants,
  targets,
}: {
  user: UserSummary
  grants: GrantRow[]
  targets: AccessTarget[]
}) {
  const t = useTranslations('Users')
  const [editing, setEditing] = useState(false)
  const [result, setResult] = useState<UserActionState | null>(null)
  const [pending, startTransition] = useTransition()
  const run = (action: () => Promise<UserActionState>) =>
    startTransition(async () => {
      const state = await action()
      if (state.error || state.link) setResult(state)
    })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={t('actions', { name: user.name })}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onClick={() => setEditing(true)}>{t('edit.menu')}</DropdownMenuItem>
          {!user.disabled && (
            <DropdownMenuItem onClick={() => run(() => createAccessLinkAction(user.id))}>
              {t(user.invited ? 'link.inviteMenu' : 'link.recoveryMenu')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => run(() => setUserDisabledAction(user.id, !user.disabled))}
          >
            {t(user.disabled ? 'enable' : 'disable')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && (
        <AccessDialog
          user={user}
          grants={grants}
          targets={targets}
          onClose={() => setEditing(false)}
        />
      )}
      {result && (
        <Dialog open onOpenChange={(next) => !next && setResult(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{user.name}</DialogTitle>
            </DialogHeader>
            {result.link ? (
              <LinkResult state={result} onClose={() => setResult(null)} />
            ) : (
              <>
                <ErrorLine error={result.error} />
                <DialogFooter>
                  <Button type="button" onClick={() => setResult(null)}>
                    {t('close')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
