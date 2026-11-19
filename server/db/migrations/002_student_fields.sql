-- ===========================================================================
-- Migration 002 : participant academic details
--   * mobile is now optional (the public form collects roll no instead)
--   * roll_no / course / class_level are optional academic details
-- ===========================================================================

alter table customers alter column mobile drop not null;

alter table customers add column if not exists roll_no text;
alter table customers add column if not exists course text;
alter table customers add column if not exists class_level text;

create index if not exists customers_mode_roll_idx on customers (mode, roll_no);
