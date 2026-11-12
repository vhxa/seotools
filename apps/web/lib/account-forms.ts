import { z } from 'zod'
import { LOCALES, type Locale } from '../i18n/locale'

export const MAX_NAME_LENGTH = 100

/** One's own display name: trimmed, 1–100 characters. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH)

/** The language choice of the account form: a shipped language, or `browser` for none. */
export const LANGUAGE_CHOICES = ['browser', ...LOCALES] as const
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number]
export const languageChoiceSchema = z.enum(LANGUAGE_CHOICES)

/** What is stored: `null` follows the browser. */
export const localeOfChoice = (choice: LanguageChoice): Locale | null =>
  choice === 'browser' ? null : choice
