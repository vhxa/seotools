# Ignored query parameters

In Settings → Crawling → Scope, enter one parameter name per line. Names are case-sensitive and
match decoded query names (`updatedAt` also matches `updated%41t`). A trailing `*` matches a prefix,
for example `utm_*`. There may be at most 100 entries, each at most 100 characters, without `=`,
`&`, `?`, `#` or an embedded `*`. The default empty list changes nothing.

From the next crawl, matching parameters are removed from internal URL identity before queueing,
deduplication and storage. Remaining query bytes and order stay intact. External URLs are unchanged.
This applies to seeds, priority URLs, links, redirects and followed canonical, hreflang and sitemap
targets. The crawler requests the stripped address, so choose names that do not select distinct content.

The Parameters page reads retained crawl results, without making requests, scanning up to 100,000
internal query URLs per crawl. It suggests a name when at least 90% of at least five observed URLs
canonically point to the same address without it, or when at least 90% of five unambiguous URL pairs
change its value across the two latest retained full crawls. Several distinct values for one URL in
either crawl do not count as a volatile pair. Suggestions never change settings automatically.

Known tracking names appear first, marked **Tracking parameter**, with their entry links below.
They never get ignore suggestions, even when the other heuristics match: internal links generally
should not carry tracking parameters. This mark is informational, not an audit finding. Any name
can still be ignored manually. Stopping an ignore on a row removes matching prefix rules too, as
explained by the button; edit the settings list for finer control.

Ignored names disappear from new crawl URL lists. Browse an older retained crawl to inspect them.
Each crawl keeps its ignored names at creation, including across worker retries. Comparison warns
when these sets change: added and not seen URLs can reflect the setting change.

## Audit declarations

Canonical and hreflang declarations, redirect destinations and page facts remain as written.
Declaration checks (canonical conflicts, repeated/relative/fragment declarations, canonicalisation,
hreflang declarations and Open Graph comparisons) continue to inspect those values. Destination
lookups and redirect traversal resolve internal addresses through the crawl's ignored-name snapshot,
so target status checks do not mistake a stripped target for an unknown URL. Link opening tags keep
the original parameters; links to variants share the stripped destination sequence while preserving
their separate contexts.

## Upgrade

This feature adds nullable settings and crawl snapshot columns, and a link occurrence column/key
so coalesced variants retain both link contexts. Migrations move forward only; take a backup before
upgrading. Returning to an older image requires restoring that backup.
