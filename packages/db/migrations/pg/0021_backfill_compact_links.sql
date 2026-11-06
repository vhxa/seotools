-- Number the crawls, oldest first, so that the rows of their links refer to them with a small integer.
UPDATE "crawls" SET "ref" = r."n"
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "n" FROM "crawls") AS r
WHERE "crawls"."id" = r."id" AND "crawls"."ref" IS NULL;
--> statement-breakpoint
-- Number the URLs of each crawl in the order they were found (shallowest first).
UPDATE "crawl_urls" SET "seq" = r."n"
FROM (
  SELECT "crawl_id", "url_hash", row_number() OVER (PARTITION BY "crawl_id" ORDER BY "depth", "url_hash") AS "n"
  FROM "crawl_urls"
) AS r
WHERE "crawl_urls"."crawl_id" = r."crawl_id" AND "crawl_urls"."url_hash" = r."url_hash" AND "crawl_urls"."seq" IS NULL;
--> statement-breakpoint
-- The links, in the compact form.
INSERT INTO "crawl_url_links" ("crawl_ref", "source", "target", "kind")
SELECT c."ref", s."seq", t."seq", l."kind"
FROM "crawl_links" AS l
JOIN "crawls" AS c ON c."id" = l."crawl_id"
JOIN "crawl_urls" AS s ON s."crawl_id" = l."crawl_id" AND s."url_hash" = l."source_hash"
JOIN "crawl_urls" AS t ON t."crawl_id" = l."crawl_id" AND t."url_hash" = l."target_hash";
--> statement-breakpoint
-- Full results are kept for the latest crawl and the one before it: domains still on the old default follow.
UPDATE "crawl_settings" SET "retain_crawls" = 2 WHERE "retain_crawls" = 10;
