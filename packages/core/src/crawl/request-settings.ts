import { z } from '../zod'
import { createSettings, type SettingsStore } from '../settings'

const headerName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .refine(
    (name) =>
      ![
        'host',
        'content-length',
        'connection',
        'transfer-encoding',
        'upgrade',
        'proxy-authorization',
      ].includes(name.toLowerCase()),
  )
const headerValue = z
  .string()
  .max(4096)
  .regex(/^[\x20-\x7e]*$/)

export const requestSettingsSchema = z.object({
  headers: z
    .array(z.object({ name: headerName, value: headerValue }))
    .max(10)
    .refine((headers) => new Set(headers.map((h) => h.name.toLowerCase())).size === headers.length),
  username: z
    .string()
    .max(255)
    .regex(/^[^:\r\n]*$/),
  password: z
    .string()
    .max(4096)
    .regex(/^[^\r\n]*$/),
})
export type RequestSettings = z.infer<typeof requestSettingsSchema>
export const EMPTY_REQUEST_SETTINGS: RequestSettings = { headers: [], username: '', password: '' }

/** A domain-owned encrypted column using the same settings encryption as instance mail. */
export function domainRequestSettings(
  store: {
    requestSecrets(domainId: string): Promise<string | null>
    saveRequestSecrets(domainId: string, value: string | null): Promise<void>
  },
  domainId: string,
  secret: string,
) {
  const adapter: SettingsStore = {
    async get() {
      const value = await store.requestSecrets(domainId)
      return value ? { value, encrypted: true } : null
    },
    async set(_key, value) {
      await store.saveRequestSecrets(domainId, value)
    },
    async delete() {
      await store.saveRequestSecrets(domainId, null)
    },
  }
  return createSettings(adapter, secret)
}

export function requestHeaders(settings: RequestSettings): Record<string, string> {
  const headers = Object.fromEntries(settings.headers.map((h) => [h.name.toLowerCase(), h.value]))
  if (settings.username)
    headers.authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`
  return headers
}
