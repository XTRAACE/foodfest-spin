-- ===========================================================================
-- Migration 005 : prize tabs (categories) used by the admin panel
-- The random wheel still uses every ENABLED prize; tabs only organise them.
-- ===========================================================================

create table if not exists prize_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table prizes add column if not exists category_id uuid
  references prize_categories (id) on delete set null;

-- Start with the two tabs used at the food fest; both can be renamed in admin.
insert into prize_categories (name, sort_order)
select 'Mach', 0
 where not exists (select 1 from prize_categories);

insert into prize_categories (name, sort_order)
select 'Snack', 1
 where not exists (select 1 from prize_categories where lower(name) = 'snack');

-- Existing prize data: the "Mach" grand prize gets its own tab, the rest Snack.
update prizes
   set category_id = (select id from prize_categories order by sort_order asc, created_at asc limit 1)
 where category_id is null and lower(name) = 'mach';

update prizes
   set category_id = (select id from prize_categories order by sort_order desc, created_at asc limit 1)
 where category_id is null;

create index if not exists prizes_category_idx on prizes (category_id);
