-- Veero Solutions (HSE & Quality) - Supabase schema.
-- NEW INSTALL : Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run. It is safe to run again.
-- EXISTING Veero database (restaurant version): run this same file; every statement is idempotent and only adds what is missing.
-- Table names keep the old "nj_" prefix on purpose: nj_restaurants now stores the SITES (plants, kitchens, warehouses, work sites).

create table if not exists nj_restaurants (
  id          text primary key,
  name        text not null,
  pair_ver    int  not null default 1,          -- bump = old pairing code stops working
  created_at  timestamptz not null default now()
);
alter table nj_restaurants add column if not exists pair_ver int not null default 1;

-- one row per site = its latest snapshot (overwritten every ~2 s by the engine)
create table if not exists nj_state (
  restaurant_id text primary key references nj_restaurants(id) on delete cascade,
  state         jsonb not null,      -- full snapshot (zones, open risks, kpi, recent events)
  summary       jsonb not null,      -- small card for the home screen
  updated_at    timestamptz not null default now()
);

-- history of detections / resolutions / escalations / acknowledgements (daily + monthly reports, analytics)
create table if not exists nj_events (
  id            bigserial primary key,
  restaurant_id text not null references nj_restaurants(id) on delete cascade,
  ts            timestamptz not null default now(),
  type          text not null,       -- detected | resolved | escalated | ack
  domain        text,                -- hse | quality
  risk_type     text,                -- fire, smoke, no_ppe, dirt, foreign, pest ... (see public/static/hse.js)
  level         text,                -- warn | critical
  ref           text,                -- id of the risk (links detected / resolved / ack)
  table_name    text,                -- the ZONE name (column name kept for compatibility)
  staff         text,                -- who handled it (resolved / ack)
  seconds       real,                -- handling time for "resolved"
  notify        text                 -- who was notified: hse | quality | admin
);
alter table nj_events add column if not exists domain text;
alter table nj_events add column if not exists risk_type text;
alter table nj_events add column if not exists level text;
alter table nj_events add column if not exists ref text;
create index if not exists nj_events_rest_ts on nj_events (restaurant_id, ts desc);
create index if not exists nj_events_ack on nj_events (restaurant_id, type, ts desc);

-- the site administration account (email + password)
create table if not exists nj_accounts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  text not null references nj_restaurants(id) on delete cascade,
  business_name  text not null,
  business_type  text not null default 'industry',   -- industry | food | logistics | construction | other
  city           text,
  manager_name   text not null,
  email          text not null unique,
  pass_salt      text not null,
  pass_hash      text not null,
  created_at     timestamptz not null default now()
);
-- the two managers of a site: role = hse or quality (ID + PIN login on /staff). Old restaurant roles are no longer accepted.
create table if not exists nj_employees (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  text not null references nj_restaurants(id) on delete cascade,
  emp_code       text not null unique,
  name           text not null,
  role           text not null default 'hse',
  active         boolean not null default true,
  pin_salt       text,
  pin_hash       text,
  created_at     timestamptz not null default now()
);
-- the restaurant version may have limited these columns to its own values
alter table nj_accounts  drop constraint if exists nj_accounts_business_type_check;
alter table nj_employees drop constraint if exists nj_employees_role_check;
create index if not exists nj_employees_rest on nj_employees (restaurant_id);

-- platform settings (brand name, public pricing)
create table if not exists nj_settings (
  key    text primary key,
  value  jsonb not null
);

-- manual register: equipment, lots, calibrations, certificates ... with an expiry date
create table if not exists nj_assets (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  text not null references nj_restaurants(id) on delete cascade,
  domain         text not null check (domain in ('hse','quality')),
  category       text not null default 'other',   -- extinguisher, probe, food_lot, certificate ... (see public/static/hse.js)
  name           text not null,
  location       text not null default '',
  ref            text not null default '',        -- serial number or lot number
  expires_on     date not null,                   -- next check / expiry / end of validity
  last_check     date,
  remind_days    int  not null default 30,        -- alert starts this many days before expires_on
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists nj_assets_rest_exp on nj_assets (restaurant_id, expires_on);

-- updated_at is set by the database, so "online/offline" does not depend on the engine computer's clock
create or replace function nj_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists nj_state_touch on nj_state;
create trigger nj_state_touch before update on nj_state for each row execute function nj_touch();

-- Lock the tables: nobody can read or write them with the public (anon) key.
-- Only the secret/service key (engine computer + Vercel functions) can, because it bypasses RLS.
alter table nj_restaurants enable row level security;
alter table nj_state       enable row level security;
alter table nj_events      enable row level security;
alter table nj_accounts    enable row level security;
alter table nj_employees   enable row level security;
alter table nj_settings    enable row level security;
alter table nj_assets      enable row level security;

-- optional: keep the history table small (delete events older than 400 days)
-- delete from nj_events where ts < now() - interval '400 days';
