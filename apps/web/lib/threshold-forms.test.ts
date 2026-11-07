import { describe, expect, it } from 'vitest'
import { parseThresholdsForm } from './threshold-forms'

const formOf = (values: Record<string, string>) => {
  const form = new FormData()
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return form
}

describe('parseThresholdsForm', () => {
  it('keeps only what differs from the recommended figures', () => {
    expect(parseThresholdsForm(formOf({ thinWords: '100', titleMax: '60', urlMax: '' }))).toEqual({
      ok: true,
      thresholds: { thinWords: 100 },
    })
    expect(parseThresholdsForm(formOf({}))).toEqual({ ok: true, thresholds: {} })
  })

  it('refuses a figure out of range, or that is not a whole number', () => {
    expect(parseThresholdsForm(formOf({ thinWords: '0' }))).toEqual({
      ok: false,
      error: 'range',
      field: 'thinWords',
    })
    expect(parseThresholdsForm(formOf({ urlMax: '12.5' }))).toMatchObject({ error: 'range' })
  })

  it('refuses a minimum that is not under its maximum', () => {
    expect(parseThresholdsForm(formOf({ titleMin: '70' }))).toEqual({ ok: false, error: 'title' })
    expect(parseThresholdsForm(formOf({ descriptionMin: '160' }))).toEqual({
      ok: false,
      error: 'description',
    })
  })
})
