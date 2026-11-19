-- Site-triggered spins (customer phone) are stored distinctly from admin and
-- device spins so reports and audit can tell where a spin came from.
alter table spins drop constraint if exists spins_source_check;
alter table spins add constraint spins_source_check
  check (source in ('admin', 'device', 'site'));
