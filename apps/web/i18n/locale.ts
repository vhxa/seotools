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
