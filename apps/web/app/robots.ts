import type { MetadataRoute } from 'next'

/** A private tool: no crawler is welcome anywhere in it. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
