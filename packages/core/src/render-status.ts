import { z } from './zod'

export const RENDER_STATUS_KEY = 'render.browser-status'
export const RENDER_STATUS_STALE_MS = 15 * 60_000
export const renderStatusSchema = z.object({
  state: z.enum([
    'not-configured',
    'ready',
    'unreachable',
    'has-network',
    'unsafe-configuration',
    'too-old',
  ]),
  version: z.string().max(100).optional(),
  checkedAt: z.string().datetime(),
  detail: z.string().max(200).optional(),
})
export type RenderStatus = z.infer<typeof renderStatusSchema>

/** An old, future-dated or malformed status is unknown, never proof of a connected browser. */
export function readRenderStatus(value: unknown, now = Date.now()): RenderStatus | null {
  const parsed = renderStatusSchema.safeParse(value)
  if (!parsed.success) return null
  const age = now - Date.parse(parsed.data.checkedAt)
  return age >= 0 && age < RENDER_STATUS_STALE_MS ? parsed.data : null
}
