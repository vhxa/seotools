'use client'

import { GlobeIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const SIZES = {
  /** The tile of the selector in the sidebar. */
  md: {
    root: 'size-8 rounded-lg after:rounded-lg',
    image: 'rounded-lg',
    fallback: 'rounded-lg bg-sidebar-primary text-sidebar-primary-foreground',
    globe: 'size-4',
  },
  /** Next to the name of a domain in a list: the globe is a quiet glyph, not a dark tile. */
  sm: {
    root: 'size-4 rounded-sm after:hidden',
    image: 'rounded-sm',
    fallback: 'rounded-sm bg-transparent text-muted-foreground',
    globe: 'size-4',
  },
}

/**
 * The favicon of a domain, or a globe while it has none (or while it loads, or if it fails to).
 * `version` is the icon's hash from the database: it is in the URL so that a changed icon is
 * fetched again, and an unchanged one is never requested twice. `null`: the domain has no icon.
 */
export function DomainIcon({
  host,
  version,
  size = 'md',
  className,
}: {
  host: string
  version: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const classes = SIZES[size]
  return (
    <Avatar className={cn(classes.root, className)}>
      {version && (
        <AvatarImage
          src={`/domains/${encodeURIComponent(host)}/favicon?v=${encodeURIComponent(version)}`}
          alt=""
          // Icons are drawn for light pages: a white tile keeps dark glyphs visible in dark mode.
          className={cn('bg-white object-contain', classes.image)}
        />
      )}
      <AvatarFallback
        // A cached icon loads in a few ms: do not flash the globe before it.
        delay={version ? 200 : undefined}
        className={classes.fallback}
      >
        <GlobeIcon className={classes.globe} />
      </AvatarFallback>
    </Avatar>
  )
}
