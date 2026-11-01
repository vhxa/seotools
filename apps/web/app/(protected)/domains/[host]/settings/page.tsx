import { redirect } from 'next/navigation'
import { requireDomain } from '@/lib/workspace'

/** The sidebar links here: settings open on their first section. */
export default async function DomainSettingsPage({
  params,
}: {
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  redirect(`/domains/${domain.host}/settings/crawl`)
}
