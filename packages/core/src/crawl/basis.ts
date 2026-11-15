import type { PageIssueId } from './issues'

export type IssueBasis = 'response' | 'document' | 'html' | 'graph'

/** Explicit observation dependency of every check. Locality is classified separately. */
export const ISSUE_BASIS: Record<PageIssueId, IssueBasis> = {
  // Stored field LCP; rendering does not collect or replace it.
  'lcp-poor': 'response',
  // Stored field INP; rendering does not collect or replace it.
  'inp-poor': 'response',
  // Stored field CLS; rendering does not collect or replace it.
  'cls-poor': 'response',
  // Compares served and rendered word counts; both independent inputs must survive.
  'text-only-after-rendering': 'html',
  // Compares the served title with the rendered title.
  'title-only-after-rendering': 'html',
  // Compares normalized served and rendered titles.
  'title-changed-by-javascript': 'html',
  // Compares served and rendered descriptions.
  'description-only-after-rendering': 'html',
  // Compares normalized served and rendered descriptions.
  'description-changed-by-javascript': 'html',
  // Compares served and rendered first H1 values.
  'h1-only-after-rendering': 'html',
  // Compares normalized served and rendered first H1 values.
  'h1-changed-by-javascript': 'html',
  // Compares HTML canonical declarations before and after rendering.
  'canonical-only-after-rendering': 'html',
  // Compares unambiguous normalized HTML canonical targets across stages.
  'canonical-changed-by-javascript': 'html',
  // States that a served meta noindex was removed; not a claim of indexability.
  'noindex-only-in-html': 'html',
  // States that rendering added a meta noindex.
  'noindex-added-by-javascript': 'html',
  // States that a served meta nofollow was removed.
  'nofollow-only-in-html': 'html',
  // States that rendering added a meta nofollow.
  'nofollow-added-by-javascript': 'html',
  // Compares structured-data presence in served and rendered facts.
  'structured-data-only-after-rendering': 'html',
  // Compares served and rendered page declarations, excluding sitemap declarations.
  'hreflang-only-after-rendering': 'html',
  // Reports preview essentials absent in HTML but added to the rendered DOM.
  'social-tags-only-after-rendering': 'html',
  // Compares the served URL with observed navigation; excludes served meta refresh.
  'javascript-redirect': 'html',
  // Render diagnostics explain why the served document could not load resources.
  'render-resources-blocked-by-robots': 'html',
  // The render observation's failed status and code; does not require a usable DOM.
  'render-failed': 'html',
  // Uncaught errors observed while rendering the served document.
  'render-script-errors': 'html',
  // Inbound rendered anchors and proven absence of HTML anchors site-wide.
  'linked-only-by-javascript': 'graph',
  // Rendered-only anchor edges from this page; retains the graph completeness guard.
  'links-only-after-rendering': 'graph',
  // The crawler's request failed.
  'no-response': 'response',
  // Served HTTP 5xx status.
  'server-error': 'response',
  // Served HTTP 4xx status.
  'client-error': 'response',
  // The served HTTP redirect trail loops.
  'redirect-loop': 'response',
  // The selected document has a not-found headline.
  'soft-404-confirmed': 'document',
  // The selected document has not-found text without that headline.
  'soft-404-possible': 'document',
  // The served HTTP redirect trail has several hops.
  'redirect-chain': 'response',
  // Served meta/HTTP Refresh declaration; retains observed redirect attribution when the DOM is abandoned.
  'refresh-redirect': 'html',
  // The crawl's robots.txt blocks this address.
  'robots-blocked': 'response',
  // Served HTTP redirect status and kind.
  'redirect-3xx': 'response',
  // Served HTTP 302 or 307.
  'redirect-temporary': 'response',
  // Time of the crawler's served response, not render duration.
  'slow-response': 'response',
  // The external URL's actual request failed or answered an eligible error.
  'broken-external-link': 'response',
  // Explicit indexable intent against selected technical blockers.
  'expected-indexable-blocked': 'document',
  // Explicit not-indexable intent contradicted only by proven selected indexability.
  'expected-not-indexable-but-indexable': 'document',
  // Complete selected directive observation lacks the required effective noindex.
  'noindex-required-missing': 'document',
  // Complete selected directive observation lacks the required effective nofollow.
  'nofollow-required-missing': 'document',
  // A conclusive robots.txt does not provide the required block.
  'robots-block-required-missing': 'response',
  // Complete sitemap coverage proves the required listing absent.
  'sitemap-required-missing': 'response',
  // Complete selected declarations do not canonicalise elsewhere.
  'canonical-required-missing': 'document',
  // Selected declarations conclusively canonicalise elsewhere against the rule.
  'canonical-forbidden-present': 'document',
  // Positive inbound anchors disprove the required unlinked state.
  'unlinked-required-missing': 'graph',
  // A sitemap actually lists the URL against its rule.
  'sitemap-forbidden-present': 'response',
  // Placement in the served source; a browser-repaired serialization would hide it.
  'directive-outside-head': 'html',
  // Conflicting directives within the selected document plus its unchanged headers.
  'directives-conflict': 'document',
  // Conflicting snippet directives in the selected document and headers.
  'directives-conflict-snippets': 'document',
  // Selected noindex/canonical declarations coexist with a robots.txt block.
  'directives-unreadable': 'document',
  // Effective noindex: served meta/header restrictions survive, rendered additions count.
  noindex: 'document',
  // Selected document's meta directives plus unchanged X-Robots-Tag.
  nofollow: 'document',
  // Selected document and response header snippet directives.
  nosnippet: 'document',
  // Selected document and header positive snippet limit.
  'max-snippet-limited': 'document',
  // Selected document and header image-indexing directive.
  noimageindex: 'document',
  // Selected document/header expiration directive evaluated at audit time.
  'unavailable-after-expired': 'document',
  // Selected document/header future expiration evaluated at audit time.
  'unavailable-after-future': 'document',
  // Placement of source canonical declarations before browser repair.
  'canonical-outside-head': 'html',
  // Conflicting canonical declarations in the selected document and unchanged Link header.
  'canonical-conflict': 'document',
  // Selected canonical reference points to an observed request failure.
  'canonical-broken': 'document',
  // Selected canonical reference points to an observed HTTP redirect.
  'canonical-redirect': 'document',
  // Selected canonical reference and selected indexing blockers of its target.
  'canonical-not-indexable': 'document',
  // Fragment in a selected canonical declaration.
  'canonical-fragment': 'document',
  // No selected canonical declaration/header target, subject to effective noindex.
  'canonical-missing': 'document',
  // Relative spelling of a selected canonical declaration.
  'canonical-relative': 'document',
  // Repeated canonical declarations in the selected document/header set.
  'canonical-repeated': 'document',
  // The sitemap response's byte and entry counts.
  'sitemap-too-big': 'response',
  // A sitemap lists a URL whose served request failed.
  'sitemap-broken': 'response',
  // A sitemap lists a URL that redirects over HTTP.
  'sitemap-redirect': 'response',
  // Sitemap listing stays a response fact, but the page's indexing blockers use the document basis.
  'sitemap-not-indexable': 'document',
  // External proof of indexing plus sitemap listing; currently silent without that proof.
  'indexed-not-in-sitemap': 'response',
  // Sitemap listing stays unchanged, but eligibility requires selected indexability.
  'indexable-not-in-sitemap': 'document',
  // Selected page/header alternates plus sitemap alternates point to failed requests.
  'hreflang-unreachable': 'document',
  // Selected page/header alternates plus sitemap alternates point to HTTP redirects.
  'hreflang-redirect': 'document',
  // Selected alternate declarations at both ends prove a missing return.
  'hreflang-no-return': 'document',
  // Language codes in selected page/header and retained sitemap alternates.
  'hreflang-invalid-code': 'document',
  // Placement of served page declarations; HTTP and sitemap entries have no head location.
  'hreflang-outside-head': 'html',
  // Selected alternates point at a target canonicalised on its selected basis.
  'hreflang-non-canonical': 'document',
  // Selected alternates point at an effectively noindex target.
  'hreflang-noindex': 'document',
  // Selected page/header and sitemap alternates assign one language to several identities.
  'hreflang-same-language': 'document',
  // The complete selected alternate set omits this page's identity.
  'hreflang-no-self': 'document',
  // The complete selected alternate set omits x-default.
  'hreflang-no-x-default': 'document',
  // Selected title is empty.
  'title-missing': 'document',
  // Placement of source title tags before browser repair.
  'title-outside-head': 'html',
  // Selected document contains several title tags.
  'title-multiple': 'document',
  // Shared selected titles among audited, conclusively indexable observed pages.
  'title-duplicate': 'document',
  // Selected title exceeds the configured maximum.
  'title-too-long': 'document',
  // Nonempty selected title is shorter than the configured minimum.
  'title-too-short': 'document',
  // Selected document contains several descriptions.
  'description-multiple': 'document',
  // Placement of source description tags before browser repair.
  'description-outside-head': 'html',
  // Selected description is empty.
  'description-missing': 'document',
  // Shared selected descriptions among audited indexable observed pages.
  'description-duplicate': 'document',
  // Selected description exceeds its configured maximum.
  'description-too-long': 'document',
  // Nonempty selected description is shorter than its configured minimum.
  'description-too-short': 'document',
  // Selected document has no H1.
  'h1-missing': 'document',
  // Selected document has several H1s.
  'h1-multiple': 'document',
  // An empty heading in selected document facts.
  'heading-empty': 'document',
  // Heading level sequence in the selected document.
  'heading-skipped-level': 'document',
  // Selected document is long enough for sections but has no H2.
  'h2-missing': 'document',
  // Shared selected first H1 values among audited indexable observed pages.
  'h1-duplicate': 'document',
  // Heading length in selected document facts.
  'heading-too-long': 'document',
  // Literal entity-like text after one decode of served title, description and H1.
  'html-entities-as-text': 'html',
  // Shared selected text hashes among audited indexable observed pages.
  'content-duplicate': 'document',
  // Selected text simhashes among audited indexable observed pages.
  'content-near-duplicate': 'document',
  // Placeholder text in the selected document.
  'content-placeholder': 'document',
  // Selected word count against the configured threshold.
  'content-thin': 'document',
  // Selected DOM image declarations lack alt attributes.
  'img-no-alt': 'document',
  // Selected DOM image declarations have empty alt attributes.
  'img-empty-alt': 'document',
  // Bytes and media type of the requested image response.
  'img-too-heavy': 'response',
  // Selected DOM image declarations lack size attributes.
  'img-no-size': 'document',
  // Selected DOM alt text exceeds the extractor's bound.
  'img-long-alt': 'document',
  // Invalid JSON-LD in the selected document.
  'json-ld-invalid': 'document',
  // Required properties missing from selected structured data.
  'structured-data-required-missing': 'document',
  // Recommended properties missing from selected structured data.
  'structured-data-recommended-missing': 'document',
  // Complete selected document has no extracted structured data.
  'no-structured-data': 'document',
  // Social preview crawlers need Open Graph tags in the served HTML.
  'og-missing': 'html',
  // Required Open Graph properties must exist in the served HTML.
  'og-incomplete': 'html',
  // The served social image reference and the target's actual HTTP result.
  'og-image-broken': 'html',
  // Served og:url versus served canonical/address; never versus a JavaScript canonical.
  'og-url-mismatch': 'html',
  // Social preview crawlers need the card declaration in the served HTML.
  'twitter-card-missing': 'html',
  // Localhost references in the selected document.
  'link-to-localhost': 'document',
  // Rendered-inclusive anchor graph pointing at failed requests.
  'links-to-broken': 'graph',
  // Actual selected document embeds point at resources the crawler observed failing.
  'resources-broken': 'document',
  // Rendered-inclusive anchor graph pointing at HTTP redirects.
  'links-to-redirect': 'graph',
  // Rendered-inclusive anchor graph and the target's selected canonical state.
  'links-to-canonicalised': 'graph',
  // Target addresses reached through the rendered-inclusive anchor graph.
  'links-tracking-parameters': 'graph',
  // Uncrawlable anchor declarations in the selected document.
  'uncrawlable-links': 'document',
  // Inbound graph has no observed followed anchor.
  'only-nofollow-inlinks': 'graph',
  // Inbound graph has no anchor from an observed indexable origin.
  'only-noindex-inlinks': 'graph',
  // Sitemap listing and proven absence of inbound graph anchors.
  'orphan-in-sitemap': 'graph',
  // Explicitly counts HTML anchors; its indexability eligibility also stays served-based.
  'few-html-links': 'html',
  // Exact selected internal anchor count is zero; never the HTML-plus-additions union.
  'no-outgoing-links': 'document',
  // Exact selected nofollow anchor count is positive.
  'internal-nofollow-links': 'document',
  // Click depth computed from the rendered-inclusive graph.
  'deep-page': 'graph',
  // Empty anchor text in selected document facts.
  'anchor-empty': 'document',
  // Vague anchor text in selected document facts.
  'anchor-vague': 'document',
  // The requested address contains repeated path slashes.
  'url-multiple-slashes': 'response',
  // The requested address contains encoded spaces.
  'url-spaces': 'response',
  // Tracking parameter names in the requested address.
  'url-tracking': 'response',
  // Case in the requested path, excluding encoding digits.
  'url-uppercase': 'response',
  // Repeated segments in the requested address.
  'url-repetitive-path': 'response',
  // Search paths or parameters in the requested address.
  'url-internal-search': 'response',
  // Underscores in the requested path.
  'url-underscores': 'response',
  // Length of the requested address.
  'url-too-long': 'response',
  // Scheme of the requested address.
  'http-url': 'response',
  // Insecure subresource declarations in the selected document.
  'mixed-content': 'document',
  // Insecure form actions in the selected document.
  'insecure-form': 'document',
  // The served response headers, even though currently copied into facts.
  'missing-security-header': 'response',
  // Selected cross-origin blank-target links lack the required protection.
  'unsafe-cross-origin-links': 'document',
  // Protocol-relative references in the selected document.
  'protocol-relative': 'document',
  // Invalid served markup; the browser may repair or relocate it.
  'invalid-head-elements': 'html',
  // Served structure loses source indexing declarations; use source facts and hreflang.
  'html-structure-broken': 'html',
  // Duplicate source containers may disappear during browser parsing.
  'multiple-head-or-body': 'html',
  // Downloaded response bytes, not serialized DOM size.
  'document-too-big': 'response',
  // Source order before browser repair.
  'content-before-head': 'html',
  // Selected html element has no usable lang.
  'html-lang-missing': 'document',
  // Selected html lang is not a well-formed language tag.
  'html-lang-invalid': 'document',
  // Selected document has no viewport declaration.
  'viewport-missing': 'document',
  // Decoding declarations must exist in the served headers/source, before scripts run.
  'charset-missing': 'html',
}

export const issueBasisOf = (issue: string): IssueBasis | undefined =>
  Object.hasOwn(ISSUE_BASIS, issue) ? ISSUE_BASIS[issue as PageIssueId] : undefined

export const RENDERED_GRAPH_ISSUES = Object.keys(ISSUE_BASIS).filter(
  (id) => ISSUE_BASIS[id as PageIssueId] === 'graph',
) as PageIssueId[]
