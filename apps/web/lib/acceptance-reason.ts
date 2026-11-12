import type { FindingAcceptance } from '@seotools/core/crawl/acceptance'

/** Why a rule accepts a finding, in words, wherever that is said. Takes full message keys. */
export function describeAcceptance(
  acceptance: FindingAcceptance,
  translate: (key: string, values?: Record<string, string | number>) => string,
): string {
  switch (acceptance.kind) {
    case 'dismissal':
      return translate('FindingStates.dismissedByPerson')
    case 'condition':
      return translate('UrlDetail.accepted.condition', {
        condition: translate(`AuditStatements.conditions.${acceptance.condition}.label`),
        requirement: translate(`AuditStatements.requirement.${acceptance.requirement}`),
      })
    case 'expectation':
      return translate('UrlDetail.accepted.expectation')
    case 'relation':
      return acceptance.end === 'origin'
        ? translate('UrlDetail.accepted.origin')
        : translate('UrlDetail.accepted.destination', {
            blockers: acceptance.blockers
              .map((blocker) => translate(`AuditState.blockers.${blocker}`))
              .join(', '),
          })
  }
}
