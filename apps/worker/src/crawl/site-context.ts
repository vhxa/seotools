/**
 * Thrown by anything a recheck cannot know because it is about the rest of the site: other pages,
 * who links here, the sitemaps. A check that reaches for it was not made, which is not the same as
 * finding nothing.
 */
export class SiteContextError extends Error {
  override name = 'SiteContextError'
  constructor(what: string) {
    super(`A recheck of some URLs does not know ${what}: only a full crawl does`)
  }
}
