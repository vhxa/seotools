import { describe, expect, it } from 'vitest'
import {
  EMPTY_REQUEST_SETTINGS,
  domainRequestSettings,
  requestHeaders,
  requestSettingsSchema,
} from './request-settings'
import { isInternalUrl } from './url'

describe('request settings', () => {
  it('accepts Cookie and tokens, refusing transport overrides and injection', () => {
    expect(
      requestSettingsSchema.parse({
        ...EMPTY_REQUEST_SETTINGS,
        headers: [{ name: 'Cookie', value: 'staging=yes' }],
      }).headers,
    ).toHaveLength(1)
    for (const name of ['Host', 'Content-Length', 'Connection', 'bad:name', 'a\r\nb']) {
      expect(
        requestSettingsSchema.safeParse({
          ...EMPTY_REQUEST_SETTINGS,
          headers: [{ name, value: 'x' }],
        }).success,
      ).toBe(false)
    }
    expect(
      requestSettingsSchema.safeParse({
        ...EMPTY_REQUEST_SETTINGS,
        headers: [{ name: 'X-Test', value: 'a\r\nb' }],
      }).success,
    ).toBe(false)
    expect(
      requestSettingsSchema.safeParse({
        ...EMPTY_REQUEST_SETTINGS,
        headers: Array.from({ length: 11 }, (_, i) => ({ name: `X-${i}`, value: 'x' })),
      }).success,
    ).toBe(false)
  })
  it('encrypts domain secrets using the settings store and builds Basic Auth', async () => {
    let encrypted: string | null = null
    const store = domainRequestSettings(
      {
        async requestSecrets() {
          return encrypted
        },
        async saveRequestSecrets(_id, value) {
          encrypted = value
        },
      },
      'domain',
      'test-key',
    )
    const value = {
      headers: [{ name: 'Cookie', value: 'secret-cookie' }],
      username: 'user',
      password: 'secret-password',
    }
    await store.setJson('request', value, { encrypted: true })
    expect(encrypted).not.toContain('secret')
    expect(await store.getJson('request', requestSettingsSchema)).toEqual(value)
    expect(requestHeaders(value)).toEqual({
      cookie: 'secret-cookie',
      authorization: 'Basic dXNlcjpzZWNyZXQtcGFzc3dvcmQ=',
    })
  })
  it('recognizes only the tracked site on default ports', () => {
    for (const url of ['https://example.com/', 'http://www.example.com:80/a'])
      expect(isInternalUrl(url, 'example.com')).toBe(true)
    for (const url of [
      'https://other.com/',
      'https://sub.example.com/',
      'https://example.com:8443/',
    ])
      expect(isInternalUrl(url, 'example.com')).toBe(false)
  })
})
