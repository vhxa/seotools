import type en from './messages/en.json'
import type { Locale } from './i18n/locale'

// Makes `t('…')` keys and their ICU arguments type-checked against the English catalog.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: typeof en
  }
}
