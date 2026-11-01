import { headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { resolveLocale } from './locale'

/** No locale in the URL: the language follows the browser's `Accept-Language`. */
export default getRequestConfig(async () => {
  const locale = resolveLocale((await headers()).get('accept-language'))
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
