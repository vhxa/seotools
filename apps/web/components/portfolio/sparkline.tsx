const WIDTH = 96
const HEIGHT = 28
const PAD = 3

/**
 * A small line of how a figure moved over the last full crawls, in the colour the dashboard gives
 * issues. Plain SVG drawn on the server: no script, so nothing for the Content-Security-Policy to
 * object to, and a list of many domains stays light. `label` says it in words for those who do not
 * see it; with fewer than two points there is no line to draw and `empty` is shown instead.
 */
export function Sparkline({
  values,
  label,
  empty,
}: {
  values: readonly number[]
  label: string
  empty: string
}) {
  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">{empty}</span>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = (WIDTH - PAD * 2) / (values.length - 1)
  const points = values.map((value, index) => ({
    x: PAD + index * step,
    // A flat line sits in the middle instead of on the floor.
    y: max === min ? HEIGHT / 2 : PAD + (HEIGHT - PAD * 2) * (1 - (value - min) / span),
  }))
  const last = points[points.length - 1]!
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="shrink-0"
    >
      <polyline
        points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={3} fill="var(--chart-2)" />
    </svg>
  )
}
