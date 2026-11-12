export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * Picks the best supported locale from an `Accept-Language` header: the highest-quality tag
 * whose primary language we ship (`es-MX` → `es`), or English when none matches.
 */
export function resolveLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.split(';').map((piece) => piece.trim())
      const quality = params.find((param) => param.startsWith('q='))
      return { tag: tag.toLowerCase(), q: quality ? Number(quality.slice(2)) : 1 }
    })
    .filter(({ tag, q }) => tag && tag !== '*' && Number.isFinite(q) && q > 0)
    // Array#sort is stable, so equal qualities keep the order the browser sent them in.
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0]
    const match = LOCALES.find((locale) => locale === primary)
    if (match) return match
  }
  return DEFAULT_LOCALE
}

/** The cookie that carries the language chosen on the account, so no request reads the database. */
export const LOCALE_COOKIE = 'seotools-locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** The saved language from a cookie value; anything we do not ship is ignored. */
export function parseLocale(value: string | null | undefined): Locale | null {
  return LOCALES.find((locale) => locale === value) ?? null
}

/** The saved language first, then the browser's `Accept-Language`. */
export function resolveRequestLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  return parseLocale(cookie) ?? resolveLocale(acceptLanguage)
}

/** Attributes of the locale cookie; `secure` follows how the app is served. */
export function localeCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
  }
}
