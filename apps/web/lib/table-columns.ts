/**
 * A JSON object saved in `localStorage`, or `null` when there is none, it is corrupt or it is not
 * an object (`null`, an array, a number…): preferences are never trusted.
 */
export function parseSavedObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null
    return saved as Record<string, unknown>
  } catch {
    return null
  }
}

/** Bound persisted values before using them in table geometry. */
export function readColumnWidths(raw: string | null, defaults: Record<string, number>) {
  const widths = { ...defaults }
  const saved = parseSavedObject(raw)
  if (!saved) return widths
  for (const id of Object.keys(defaults)) {
    const width = saved[id]
    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[id] = Math.max(80, Math.min(800, width))
    }
  }
  return widths
}
