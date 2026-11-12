'use client'

import type { AuditRule, LanguageConfig } from '@seotools/core/crawl/audit'
import { createContext, useContext, type ReactNode } from 'react'

/**
 * What the rule editor needs to know about the rest of the domain: every rule (to say what a
 * statement would be if the rule did not make it) and the language directories. Given once to the
 * list of rules, not to each of its dialogs.
 */
interface AuditConfig {
  host: string
  rules: AuditRule[]
  languages: LanguageConfig
}

const Config = createContext<AuditConfig | null>(null)

export function AuditConfigProvider({
  children,
  ...config
}: AuditConfig & { children: ReactNode }) {
  return <Config.Provider value={config}>{children}</Config.Provider>
}

export function useAuditConfig(): AuditConfig {
  const config = useContext(Config)
  if (!config) throw new Error('The rule editor needs an AuditConfigProvider')
  return config
}
