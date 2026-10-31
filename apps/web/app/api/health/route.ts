import { getDb } from '@/lib/db'
import { getHealth } from '@/lib/health'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const requireWorker = new URL(request.url).searchParams.get('require') === 'worker'
  const { httpStatus, report } = await getHealth(getDb, { requireWorker })
  return Response.json(report, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } })
}
