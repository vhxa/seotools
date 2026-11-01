import { faviconResponse } from '@/lib/favicon-response'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** The icon the worker found on the domain's site, for the sidebar. */
export async function GET(request: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  return faviconResponse(await (await getDb()).favicons.get(domain.id), request)
}
