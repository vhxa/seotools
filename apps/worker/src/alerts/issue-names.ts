import type { AlertLocale } from '@seotools/core'
import en from '../../../web/messages/en.json' with { type: 'json' }
import es from '../../../web/messages/es.json' with { type: 'json' }

/**
 * The names of the issues as the web app shows them. The worker has no message catalogs of its own;
 * these two files are the ones the interface reads, so an email never calls an issue anything the
 * person does not see in the app. An issue without a name is called by its id.
 */
const NAMES: Record<AlertLocale, Record<string, { name?: string } | undefined>> = {
  en: en.PageIssues,
  es: es.PageIssues,
}

export const issueName = (locale: AlertLocale, issue: string): string =>
  NAMES[locale][issue]?.name ?? issue
