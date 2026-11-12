'use server'

import { DomainArchivedError } from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { archivedMessage, requireDomainEditor } from '@/lib/workspace'

export async function startBotTestAction(
  host: string,
  _state: { error?: string },
  _form: FormData,
): Promise<{ error?: string }> {
  const { domain, session } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  try {
    await (await getDb()).botTests.start({ domainId: domain.id, requestedBy: session.user.id })
  } catch (error) {
    if (error instanceof DomainArchivedError) return { error: await archivedMessage() }
    return { error: (await getTranslations('BotTest'))('startFailed') }
  }
  revalidatePath(`/domains/${domain.host}/crawl-files/robots`)
  return {}
}
