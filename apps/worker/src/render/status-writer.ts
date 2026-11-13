import {
  RENDER_STATUS_KEY,
  renderStatusSchema,
  type Settings,
  type RenderStatus,
} from '@seotools/core'

export const createRenderStatusWriter = (settings: Settings) => (status: RenderStatus) =>
  settings.setJson(RENDER_STATUS_KEY, renderStatusSchema.parse(status), { encrypted: false })
