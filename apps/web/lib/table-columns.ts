/** Bound persisted values before using them in table geometry. */
export function readColumnWidths(raw: string | null, defaults: Record<string, number>) {
  const widths = { ...defaults }
  if (!raw) return widths
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return widths
    for (const id of Object.keys(defaults)) {
      const width = (saved as Record<string, unknown>)[id]
      if (typeof width === 'number' && Number.isFinite(width)) {
        widths[id] = Math.max(80, Math.min(800, width))
      }
    }
  } catch {
    // Corrupt preferences use the defaults.
  }
  return widths
}
