CREATE TEMP TABLE `owned_card_merge` AS
SELECT `id`,
  first_value(`id`) OVER (PARTITION BY `user_id`, `catalog_card_id`, `collection_id` ORDER BY `created_at`, `id`) AS `keep_id`,
  count(*) OVER (PARTITION BY `user_id`, `catalog_card_id`, `collection_id`) AS `group_size`
FROM `owned_card`;
--> statement-breakpoint
UPDATE `owned_card` SET
  `quantity` = (SELECT sum(o.`quantity`) FROM `owned_card` o JOIN `owned_card_merge` m ON m.`id` = o.`id` WHERE m.`keep_id` = `owned_card`.`id`),
  `note` = (SELECT group_concat(n, char(10)) FROM (SELECT trim(o.`note`) AS n, min(o.`created_at`) AS first_at FROM `owned_card` o JOIN `owned_card_merge` m ON m.`id` = o.`id` WHERE m.`keep_id` = `owned_card`.`id` AND trim(coalesce(o.`note`, '')) <> '' GROUP BY trim(o.`note`) ORDER BY first_at, n)),
  `updated_at` = (SELECT max(o.`updated_at`) FROM `owned_card` o JOIN `owned_card_merge` m ON m.`id` = o.`id` WHERE m.`keep_id` = `owned_card`.`id`)
WHERE `id` IN (SELECT `keep_id` FROM `owned_card_merge` WHERE `group_size` > 1);
--> statement-breakpoint
DELETE FROM `owned_card` WHERE `id` IN (SELECT `id` FROM `owned_card_merge` WHERE `id` <> `keep_id`);
--> statement-breakpoint
UPDATE `owned_card` SET `printing_id` = NULL, `language` = 'en', `condition` = 'near_mint', `edition` = 'unlimited'
WHERE `printing_id` IS NOT NULL OR `language` <> 'en' OR `condition` <> 'near_mint' OR `edition` <> 'unlimited';
--> statement-breakpoint
DROP TABLE `owned_card_merge`;
