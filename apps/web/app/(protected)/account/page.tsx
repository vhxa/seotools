import { getTranslations } from 'next-intl/server'
import { AlertsForm } from '@/components/alerts/alerts-form'
import { PasswordForm } from '@/components/users/password-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getTranslations('Account'))('title') }
}

/** One's own account: who it is, what it can reach, and its password. */
export default async function AccountPage() {
  const viewer = await requireViewer()
  const [t, tUsers] = await Promise.all([getTranslations('Account'), getTranslations('Users')])
  const db = await getDb()
  const companies = await db.companies.list()
  const [visible, subscriptions] = await Promise.all([
    visibleCompanies(viewer),
    db.alerts.forUser(viewer.session.user.id),
  ])
  const chosen = new Map(subscriptions.map((s) => [s.domainId, s.kinds]))
  // Nothing is sent for an archived domain, so there is nothing to choose for it.
  const alertGroups = visible
    .map((company) => ({
      id: company.id,
      name: company.name,
      domains: company.domains
        .filter((domain) => domain.archivedAt === null)
        .map((domain) => ({
          id: domain.id,
          host: domain.host,
          kinds: chosen.get(domain.id) ?? [],
        })),
    }))
    .filter((group) => group.domains.length > 0)
  const nameOf = (grant: (typeof viewer.grants)[number]) =>
    grant.domainId
      ? companies.flatMap((c) => c.domains).find((d) => d.id === grant.domainId)?.host
      : companies.find((c) => c.id === grant.companyId)?.name

  return (
    <main className="grid max-w-2xl gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{viewer.session.user.name}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p className="text-muted-foreground">{viewer.session.user.email}</p>
          <p>{tUsers(`roles.${viewer.role}`)}</p>
          {viewer.role === 'admin' ? (
            <p className="text-muted-foreground">{tUsers('access.everything')}</p>
          ) : viewer.grants.length === 0 ? (
            <p className="text-muted-foreground">{tUsers('access.nothing')}</p>
          ) : (
            <ul className="grid gap-0.5">
              {viewer.grants.map((grant) => (
                <li key={grant.domainId ?? grant.companyId}>
                  {tUsers('access.row', {
                    target: nameOf(grant) ?? '',
                    role: tUsers(`roles.${grant.role}`),
                  })}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card id="alerts" className="scroll-mt-16">
        <CardHeader>
          <CardTitle>{t('alerts.title')}</CardTitle>
          <CardDescription>{t('alerts.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertsForm groups={alertGroups} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('password')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
    </main>
  )
}
