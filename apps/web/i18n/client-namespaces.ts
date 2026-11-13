/**
 * The top-level namespaces of `messages/<locale>.json` that client code reads (`useTranslations('X')`
 * or `useTranslations('X.y')` in a `'use client'` file or anything it imports). The root layout sends
 * only these to the browser: a namespace used by client code and missing here shows a missing message
 * there, and `client-namespaces.test.ts` fails for it (and for one listed that nothing uses).
 */
export const CLIENT_NAMESPACES: readonly string[] = [
  'Account',
  'AppError',
  'AuditDialog',
  'AuditRules',
  'AuditState',
  'AuditStatements',
  'AuditTemplates',
  'BotTest',
  'Common',
  'Companies',
  'CompanyFields',
  'Crawl',
  'CrawlCompare',
  'CrawlFiles',
  'CrawlSettings',
  'Crawls',
  'CrawlsArea',
  'Dashboard',
  'DomainSettings',
  'DomainSwitcher',
  'Email',
  'Export',
  'FavouriteDomain',
  'FindingStates',
  'Header',
  'Help',
  'HttpStatus',
  'IssueCatalog',
  'LinkKinds',
  'LinkRegions',
  'Login',
  'NewDomain',
  'PageIssues',
  'Pages',
  'PagesDetails',
  'Pagination',
  'Parameters',
  'PasswordRecovery',
  'PrioritySettings',
  'ResultsTable',
  'Schedules',
  'SetPassword',
  'Setup',
  'Sidebar',
  'SystemNav',
  'Updates',
  'UrlDetail',
  'Vitals',
  'UrlLinks',
  'Users',
  'Verification',
]

/** The messages of `namespaces` only (top-level keys), in the order of the list. */
export function pickNamespaces<T extends Record<string, unknown>>(
  messages: T,
  namespaces: readonly string[],
): Partial<T> {
  return Object.fromEntries(
    namespaces.filter((namespace) => namespace in messages).map((n) => [n, messages[n]]),
  ) as Partial<T>
}
