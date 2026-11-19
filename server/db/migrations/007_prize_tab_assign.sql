-- ===========================================================================
-- Migration 007 : put seeded prizes into a tab
-- On a brand-new database the prize seed runs after 005/006, so those prizes
-- had no tab yet. Grand prize -> "Mach", everything else -> "Snack".
-- ===========================================================================

update prizes
   set category_id = (select id from prize_categories where lower(name) = 'mach' limit 1)
 where category_id is null
   and lower(name) = 'mach'
   and exists (select 1 from prize_categories where lower(name) = 'mach');

update prizes
   set category_id = (select id from prize_categories where lower(name) = 'snack' limit 1)
 where category_id is null
   and exists (select 1 from prize_categories where lower(name) = 'snack')
   and lower(name) <> 'mach';

update prizes
   set category_id = (select id from prize_categories order by sort_order asc, created_at asc limit 1)
 where category_id is null
   and exists (select 1 from prize_categories);
