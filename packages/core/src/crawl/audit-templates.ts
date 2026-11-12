/** Editor prefills only: template ids never become stored configuration. */
import type { AuditCondition, AuditValue, IndexIntent, Requirement } from './audit'

export const AUDIT_RULE_TEMPLATES = [
  {
    id: 'private-area',
    statements: {
      intent: 'not-indexable',
      conditions: {
        noindex: 'allowed',
        nofollow: 'allowed',
        robots: 'allowed',
        sitemap: 'forbidden',
      },
    },
  },
  {
    id: 'search-and-filters',
    statements: {
      intent: 'not-indexable',
      conditions: {
        noindex: 'allowed',
        canonical: 'allowed',
        robots: 'allowed',
        sitemap: 'forbidden',
      },
    },
  },
  {
    id: 'campaign-landing',
    statements: { conditions: { unlinked: 'allowed', sitemap: 'allowed' } },
  },
  {
    id: 'must-be-indexed',
    statements: {
      intent: 'indexable',
      conditions: {
        noindex: 'forbidden',
        robots: 'forbidden',
        canonical: 'forbidden',
        sitemap: 'required',
      },
    },
  },
  { id: 'leave-out', statements: { audit: 'exclude' } },
] as const satisfies readonly {
  id: string
  statements: {
    audit?: AuditValue
    intent?: IndexIntent
    conditions?: Partial<Record<AuditCondition, Requirement>>
  }
}[]
