-- How long the spin animation takes, in milliseconds, as reported by the
-- initiating device (the ESP32 reports its own show duration). The site uses
-- this plus the spin's requested_at to mirror the physical wheel in real time.
alter table spins add column if not exists animation_ms integer;
