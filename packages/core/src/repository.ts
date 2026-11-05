/** Where SEO Tools is published. Import-free, like `version.ts`: the release tooling reads it too. */

/** The GitHub repository that holds the code, the tags and the release notes. */
export const RELEASES_REPOSITORY = 'botaroikawa/seotools'

/** Every published release, with its notes. */
export const RELEASES_URL = `https://github.com/${RELEASES_REPOSITORY}/releases`

/** The container image every release is published to (GitHub Container Registry). */
export const IMAGE_REPOSITORY = `ghcr.io/${RELEASES_REPOSITORY}`

/** The guide for updating an installation: what is done by hand, and what Docker does. */
export const UPDATE_GUIDE_URL = `https://github.com/${RELEASES_REPOSITORY}/blob/main/docs/updating.md`
