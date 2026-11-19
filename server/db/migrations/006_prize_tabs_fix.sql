-- ===========================================================================
-- Migration 006 : repair the default prize tabs
-- 005 could create only the "Mach" tab and put every prize in it. This adds
-- the "Snack" tab when it is missing and moves non-grand prizes into it.
-- ===========================================================================

insert into prize_categories (name, sort_order)
select 'Snack', coalesce((select max(sort_order) + 1 from prize_categories), 1)
 where not exists (select 1 from prize_categories where lower(name) = 'snack');

update prizes
   set category_id = (select id from prize_categories where lower(name) = 'snack' limit 1)
 where category_id = (select id from prize_categories where lower(name) = 'mach' limit 1)
   and lower(name) <> 'mach'
   and exists (select 1 from prize_categories where lower(name) = 'snack');
