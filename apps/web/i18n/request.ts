import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { LOCALE_COOKIE, resolveRequestLocale } from './locale'

/**
 * No locale in the URL: the language saved on the account (kept in a cookie, so there is no extra
 * database query) comes first, then the browser's `Accept-Language`.
 */
export default getRequestConfig(async () => {
  const locale = resolveRequestLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  )
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
