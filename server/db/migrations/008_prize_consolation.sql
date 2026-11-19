-- Marks the consolation prize ("Better Luck") so the admin panel can offer an
-- explicit enable/disable switch that survives renaming the product.
alter table prizes add column if not exists is_consolation boolean not null default false;

update prizes
   set is_consolation = true
 where lower(name) like '%better luck%'
   and not exists (select 1 from prizes where is_consolation = true);
