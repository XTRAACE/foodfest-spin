-- ===========================================================================
-- FOOD FEST – SMART LUCKY SPIN SYSTEM
-- Migration 001 : core schema (PostgreSQL / Supabase compatible)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Admin accounts (passwords are bcrypt hashes, never plain text)
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null default 'admin' check (role in ('admin', 'operator')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Global event settings (single row, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists event_settings (
  id                   integer primary key default 1 check (id = 1),
  event_name           text not null default 'Food Fest 2026',
  event_status         text not null default 'active' check (event_status in ('active', 'paused', 'ended')),
  mode                 text not null default 'demo' check (mode in ('demo', 'real')),
  registration_open    boolean not null default true,
  duplicate_mobile_rule text not null default 'reject' check (duplicate_mobile_rule in ('reject', 'allow')),
  device_id            text not null default 'FOODFEST_ESP32',
  servo_min_angle      integer not null default 10,
  servo_max_angle      integer not null default 170,
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sequential counters (customer numbers, spin codes) – updated under FOR UPDATE
-- ---------------------------------------------------------------------------
create table if not exists counters (
  key   text primary key,
  value bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  mode            text not null check (mode in ('demo', 'real')),
  customer_number integer not null,
  group_number    integer not null,
  name            text not null,
  mobile          text not null,
  email           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (mode, customer_number)
);

create index if not exists customers_mode_mobile_idx on customers (mode, mobile);
create index if not exists customers_mode_group_idx on customers (mode, group_number);

-- ---------------------------------------------------------------------------
-- Groups of three customers
-- ---------------------------------------------------------------------------
create table if not exists customer_groups (
  id           uuid primary key default gen_random_uuid(),
  mode         text not null check (mode in ('demo', 'real')),
  group_number integer not null,
  status       text not null default 'waiting' check (status in ('waiting', 'complete')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (mode, group_number)
);

-- ---------------------------------------------------------------------------
-- One randomly selected customer per completed group
-- ---------------------------------------------------------------------------
create table if not exists group_selections (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null unique references customer_groups (id) on delete cascade,
  customer_id     uuid not null unique references customers (id) on delete cascade,
  mode            text not null check (mode in ('demo', 'real')),
  group_number    integer not null,
  customer_number integer not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Prize configuration
-- ---------------------------------------------------------------------------
create table if not exists prizes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  image_url   text,
  color       text not null default '#f97316',
  weight      integer not null default 1 check (weight >= 0),
  is_enabled  boolean not null default true,
  is_unlimited boolean not null default false,
  servo_angle integer check (servo_angle >= 0 and servo_angle <= 180),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Stock per mode: demo stock is completely isolated from real stock
-- ---------------------------------------------------------------------------
create table if not exists prize_stock (
  prize_id  uuid not null references prizes (id) on delete cascade,
  mode      text not null check (mode in ('demo', 'real')),
  stock     integer not null default 0 check (stock >= 0),
  updated_at timestamptz not null default now(),
  primary key (prize_id, mode)
);

-- ---------------------------------------------------------------------------
-- Spins – the prize is frozen here BEFORE any animation starts
-- ---------------------------------------------------------------------------
create table if not exists spins (
  id              uuid primary key default gen_random_uuid(),
  spin_code       text not null unique,
  mode            text not null check (mode in ('demo', 'real')),
  status          text not null default 'pending'
                  check (status in ('pending', 'spinning', 'completed', 'failed', 'cancelled')),
  customer_id     uuid not null references customers (id) on delete cascade,
  group_id        uuid references customer_groups (id) on delete set null,
  customer_number integer not null,
  customer_name   text not null,
  prize_id        uuid references prizes (id) on delete set null,
  prize_name      text not null,
  prize_weight    integer not null,
  total_weight    integer not null,
  probability     numeric(7, 4) not null,
  wheel_angle     numeric(7, 2) not null,
  servo_angle     integer not null,
  source          text not null default 'admin' check (source in ('admin', 'device')),
  device_id       text,
  idempotency_key text unique,
  stock_deducted  boolean not null default false,
  requested_at    timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists spins_mode_created_idx on spins (mode, requested_at desc);
create index if not exists spins_status_idx on spins (status);

-- A real customer can receive exactly one spin, ever.
create unique index if not exists spins_one_real_per_customer
  on spins (customer_id) where mode = 'real';

-- ---------------------------------------------------------------------------
-- Stock movements – unique spin_id guarantees a single deduction per spin
-- ---------------------------------------------------------------------------
create table if not exists prize_stock_transactions (
  id           uuid primary key default gen_random_uuid(),
  prize_id     uuid not null references prizes (id) on delete cascade,
  mode         text not null check (mode in ('demo', 'real')),
  spin_id      uuid not null unique references spins (id) on delete cascade,
  delta        integer not null,
  stock_before integer not null,
  stock_after  integer not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Devices (ESP32 machines) – only a SHA-256 hash of the token is stored
-- ---------------------------------------------------------------------------
create table if not exists devices (
  id               uuid primary key default gen_random_uuid(),
  device_id        text not null unique,
  name             text not null default 'Food Fest Spin Machine',
  token_hash       text not null,
  is_active        boolean not null default true,
  status           text not null default 'offline' check (status in ('online', 'offline')),
  firmware_version text,
  ip_address       text,
  last_heartbeat   timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Commands queued for the device (test displays / servo)
-- ---------------------------------------------------------------------------
create table if not exists device_commands (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null,
  type       text not null check (type in ('oled', 'tm1637', 'servo', 'reset')),
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'pending' check (status in ('pending', 'acked')),
  created_at timestamptz not null default now(),
  acked_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Audit log for administrative changes
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
