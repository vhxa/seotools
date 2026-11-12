import { describe, expect, it } from 'vitest'
import { languageChoiceSchema, localeOfChoice, nameSchema } from './account-forms'

describe('nameSchema', () => {
  it('trims and accepts 1 to 100 characters', () => {
    expect(nameSchema.parse('  Ana  ')).toBe('Ana')
    expect(nameSchema.safeParse('a'.repeat(100)).success).toBe(true)
  })
  it('refuses empty, blank and longer names', () => {
    expect(nameSchema.safeParse('').success).toBe(false)
    expect(nameSchema.safeParse('   ').success).toBe(false)
    expect(nameSchema.safeParse('a'.repeat(101)).success).toBe(false)
  })
})

describe('languageChoiceSchema', () => {
  it('accepts the shipped languages and the browser, nothing else', () => {
    for (const ok of ['browser', 'en', 'es'])
      expect(languageChoiceSchema.safeParse(ok).success).toBe(true)
    for (const bad of ['fr', '', 'EN', null])
      expect(languageChoiceSchema.safeParse(bad).success).toBe(false)
  })
  it('stores null for the browser', () => {
    expect(localeOfChoice('browser')).toBeNull()
    expect(localeOfChoice('es')).toBe('es')
  })
})
