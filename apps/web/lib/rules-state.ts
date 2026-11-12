/**
 * Which rules a crawl was analysed with, told as a user would: the audit keeps a configuration
 * number for each change of the rules, but it is internal, so people only see whether the crawl
 * reflects the rules in force now.
 */
export type RulesState = 'notAnalysed' | 'current' | 'changed'

/** `version` is the one the crawl was analysed with (`null`: it never was). */
export const rulesStateOf = (version: number | null, currentVersion: number): RulesState =>
  version === null ? 'notAnalysed' : version === currentVersion ? 'current' : 'changed'

/** Two crawls analysed with the same rules, different ones, or one of them not at all (`null`). */
export const sameRulesOf = (a: number | null, b: number | null): boolean | null =>
  a === null || b === null ? null : a === b
