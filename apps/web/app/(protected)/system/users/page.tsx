import { getFormatter, getTranslations } from 'next-intl/server'
import { InviteUserButton, UserActions } from '@/components/users/user-dialogs'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import { grantTarget } from '@/lib/user-forms'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getTranslations('Users'))('title') }
}

/** Who can use this instance and what each can reach. Only administrators see it. */
export default async function UsersPage() {
  await requireAdmin()
  const [t, format] = await Promise.all([getTranslations('Users'), getFormatter()])
  const db = await getDb()
  const [users, grants, companies] = await Promise.all([
    db.users.list(),
    db.users.allGrants(),
    db.companies.list(),
  ])

  const targets = companies.flatMap((company) => [
    { value: `company:${company.id}`, label: t('access.companyTarget', { name: company.name }) },
    ...company.domains.map((domain) => ({ value: `domain:${domain.id}`, label: domain.host })),
  ])
  const labelOf = (target: string) =>
    targets.find((option) => option.value === target)?.label ?? target

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <InviteUserButton targets={targets} />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.user')}</TableHead>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.access')}</TableHead>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const own = (grants.get(user.id) ?? []).map((grant) => ({
                target: grantTarget(grant),
                role: grant.role,
              }))
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="block font-medium">{user.name}</span>
                    <span className="block text-xs text-muted-foreground">{user.email}</span>
                  </TableCell>
                  <TableCell>{t(`roles.${user.role}`)}</TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    {user.role === 'admin' ? (
                      <span className="text-muted-foreground">{t('access.everything')}</span>
                    ) : own.length === 0 ? (
                      <span className="text-muted-foreground">{t('access.nothing')}</span>
                    ) : (
                      <ul className="grid gap-0.5 text-sm">
                        {own.map(({ target, role }) => (
                          <li key={target}>
                            {t('access.row', { target: labelOf(target), role: t(`roles.${role}`) })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.disabledAt ? (
                      <Badge variant="secondary">
                        {t('state.disabled', { when: format.dateTime(user.disabledAt) })}
                      </Badge>
                    ) : user.hasPassword ? (
                      <Badge variant="outline">{t('state.active')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('state.invited')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <UserActions
                      user={{
                        id: user.id,
                        name: user.name,
                        role: user.role,
                        disabled: user.disabledAt !== null,
                        invited: !user.hasPassword,
                      }}
                      grants={own}
                      targets={targets}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </main>
  )
}
