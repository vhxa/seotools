-- Number the crawls, oldest first, so that the rows of their links refer to them with a small integer.
CREATE TEMP TABLE `crawl_refs_0021` AS SELECT `id`, row_number() OVER (ORDER BY `created_at`, `id`) AS `n` FROM `crawls`;
--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_refs_0021_id` ON `crawl_refs_0021` (`id`);
--> statement-breakpoint
UPDATE `crawls` SET `ref` = (SELECT `n` FROM `crawl_refs_0021` WHERE `crawl_refs_0021`.`id` = `crawls`.`id`) WHERE `ref` IS NULL;
--> statement-breakpoint
DROP TABLE `crawl_refs_0021`;
--> statement-breakpoint
-- Number the URLs of each crawl in the order they were stored.
CREATE TEMP TABLE `crawl_url_seqs_0021` AS SELECT `crawl_id`, `url_hash`, row_number() OVER (PARTITION BY `crawl_id` ORDER BY `rowid`) AS `n` FROM `crawl_urls`;
--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_url_seqs_0021_key` ON `crawl_url_seqs_0021` (`crawl_id`, `url_hash`);
--> statement-breakpoint
UPDATE `crawl_urls` SET `seq` = (SELECT `n` FROM `crawl_url_seqs_0021` AS s WHERE s.`crawl_id` = `crawl_urls`.`crawl_id` AND s.`url_hash` = `crawl_urls`.`url_hash`) WHERE `seq` IS NULL;
--> statement-breakpoint
DROP TABLE `crawl_url_seqs_0021`;
--> statement-breakpoint
-- The links, in the compact form.
INSERT INTO `crawl_url_links` (`crawl_ref`, `source`, `target`, `kind`)
SELECT c.`ref`, s.`seq`, t.`seq`, l.`kind`
FROM `crawl_links` AS l
JOIN `crawls` AS c ON c.`id` = l.`crawl_id`
JOIN `crawl_urls` AS s ON s.`crawl_id` = l.`crawl_id` AND s.`url_hash` = l.`source_hash`
JOIN `crawl_urls` AS t ON t.`crawl_id` = l.`crawl_id` AND t.`url_hash` = l.`target_hash`;
--> statement-breakpoint
-- Full results are kept for the latest crawl and the one before it: domains still on the old default follow.
UPDATE `crawl_settings` SET `retain_crawls` = 2 WHERE `retain_crawls` = 10;
