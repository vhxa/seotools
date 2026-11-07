/** A translator for keys known only at run time (a key stored with a result, a column header). */
export type DynamicTranslate = (key: string, values?: Record<string, string | number>) => string

/**
 * next-intl types the keys of a translator, which a key read from data cannot satisfy. This turns
 * one (`getTranslations()` or `useTranslations()` without a namespace, or `createTranslator`) into a
 * function that takes any string, in one place. A key that does not exist is next-intl's usual error
 * handling, never a type error. Pure, so server and client code can both import it.
 */
export function dynamicTranslator(translator: (key: never, values?: never) => string) {
  return translator as DynamicTranslate
}
