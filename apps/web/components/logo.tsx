/** The seotools mark, same artwork as `app/icon.svg` and `assets/icon.svg`. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#7c3aed" />
      <text
        x="32"
        y="32"
        dy="0.35em"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontSize="32"
        fontWeight="600"
        fill="#ffffff"
      >
        S
      </text>
    </svg>
  )
}
