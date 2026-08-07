-- PREPDO AI Sales Coach — Supabase schema (v0.6)
-- Run this in the Supabase SQL editor. Safe to run once on a fresh project.

create extension if not exists "uuid-ossp";

-- ============================================================
-- team_members
-- ============================================================
create table team_members (
  id uuid primary key default uuid_generate_v4(),
  invite_id uuid,  -- FK added below, after invites exists
  email text unique not null,
  key_type text not null check (key_type in ('admin','member')),
  name text,
  mobile text,
  city text,
  created_at timestamptz default now(),
  first_login_at timestamptz,
  last_login timestamptz,
  -- returning-visit session, separate from the one-time activation token
  session_token_hash text,
  session_expires_at timestamptz,
  subscription_type text check (subscription_type in ('trial','paid')),
  subscription_start_date date,
  subscription_expiry_date date,
  subscription_status text default 'pending_activation'
    check (subscription_status in ('pending_activation','active','expiring_soon','expired')),
  reminder_90_sent boolean default false,
  reminder_14_sent boolean default false,
  -- reserved for future payments module, no logic yet
  plan_type text,
  amount_paid numeric,
  payment_reference text,
  last_payment_date date,
  renewal_date date,
  auto_renew boolean
);

-- ============================================================
-- invites  (replaces the old pre-generated key pool)
-- ============================================================
-- Tokens are generated on-demand, one per invited person, never stored
-- in plaintext. Only the SHA-256 hash is kept — a database breach does
-- not expose usable tokens.
create table invites (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  name text not null,
  token_hash text not null unique,
  key_type text not null check (key_type in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','activated','expired','revoked')),
  invited_by uuid references team_members(id),
  created_at timestamptz default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  activated_at timestamptz
);
create index idx_invites_email on invites(email);
create index idx_invites_status on invites(status);

-- Now that both tables exist, add the invite_id FK on team_members
alter table team_members
  add constraint fk_team_members_invite foreign key (invite_id) references invites(id);

-- ============================================================
-- prospects
-- ============================================================
create table prospects (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references team_members(id) not null,
  company_name text,
  company_website text,
  prospect_name text,
  linkedin_url text,
  position text,
  meeting_objective text,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- reports
-- ============================================================
create table reports (
  id uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) not null,
  owner_id uuid references team_members(id) not null,
  report_type text not null check (report_type in ('presales_prep','meeting_analysis')),
  meeting_number integer,
  meeting_date date,
  input_mode text check (input_mode in ('transcript','structured','both')),
  transcript_summary text,
  structured_data jsonb,
  ai_output_detailed text,
  ai_output_summary text,
  ai_output_extra text,
  ai_output_missed text,
  recommended_actions jsonb,
  overall_score numeric(3,1),
  probability_of_close numeric,
  created_at timestamptz default now()
);

-- ============================================================
-- action_items
-- ============================================================
create table action_items (
  id uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) not null,
  report_id uuid references reports(id),
  owner_id uuid references team_members(id) not null,
  description text not null,
  due_date date,
  priority text check (priority in ('High','Medium','Low')),
  status text default 'open' check (status in ('open','done')),
  source text check (source in ('manual','ai_suggested')),
  calendar_link_used boolean default false,
  task_link_used boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- stalls_objections_log
-- ============================================================
create table stalls_objections_log (
  id uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) not null,
  report_id uuid references reports(id),
  owner_id uuid references team_members(id) not null,
  entry_type text not null check (entry_type in ('stall','objection')),
  description text not null,
  handled_status text check (handled_status in ('Y','N','Partial')),
  handling_notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- learnings
-- ============================================================
create table learnings (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references team_members(id) not null,
  prospect_id uuid references prospects(id),
  report_id uuid references reports(id),
  text text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- email_templates
-- ============================================================
create table email_templates (
  id uuid primary key default uuid_generate_v4(),
  template_name text not null,
  linked_to text not null unique check (linked_to in (
    'access_key_welcome','detailed_report','summary_report',
    'action_report','general','expiry_reminder'
  )),
  subject text not null,
  body text not null,
  updated_at timestamptz default now()
);

-- Seed the 6 starter templates
insert into email_templates (template_name, linked_to, subject, body) values
('Access Key Welcome', 'access_key_welcome',
  'Welcome to PREPDO — Activate Your Account',
  'Hi {{sender_name}},

You have been invited to PREPDO AI Sales Coach. Click below to activate your account:

{{login_link}}

This link expires in 7 days.

Regards,
PREPDO Team'),
('Detailed Report', 'detailed_report',
  'Detailed Report — {{client_name}}',
  'Hi,

Please find attached the detailed {{report_type}} report for {{client_name}}.

Regards,
{{sender_name}}'),
('Summary Report', 'summary_report',
  'Summary Report — {{client_name}}',
  'Hi,

Please find attached the summary {{report_type}} report for {{client_name}}.

Regards,
{{sender_name}}'),
('Action Report', 'action_report',
  'Action Points — {{client_name}}',
  'Hi,

Please find attached the recommended action points for {{client_name}}.

Regards,
{{sender_name}}'),
('General', 'general',
  '{{report_type}} — {{client_name}}',
  'Hi,

Please find attached the {{report_type}} for {{client_name}}.

Regards,
{{sender_name}}'),
('Subscription Expiry Reminder', 'expiry_reminder',
  'Your PREPDO subscription expires in {{days_remaining}} days',
  'Hi {{sender_name}},

Your PREPDO subscription is due to expire on {{expiry_date}} ({{days_remaining}} days from now).

Regards,
PREPDO Team');

-- ============================================================
-- Bootstrap the first admin
-- ============================================================
-- The normal invite flow requires an existing admin to invite anyone else,
-- so the very first admin has to be seeded directly. Two ways to do this:
--
-- Option A (simplest): create the team_members row directly, with no
-- password/token at all, then rely on a one-time manual Supabase edit
-- to set session_token_hash once you generate a first activation link
-- by calling the invite function with invited_by = NULL.
--
-- Option B (recommended): run the invite Netlify function once, manually,
-- with invited_by = NULL and key_type = 'admin', for ashok@lmi-india.in.
-- That creates the invites row with a real hashed token the normal way,
-- and the activation link that comes back is used exactly like any other
-- invite. This keeps the bootstrap admin going through the same code path
-- as everyone else, rather than being a special case in the database.

-- ============================================================
-- Indexes for common lookups
-- ============================================================
create index idx_prospects_owner on prospects(owner_id);
create index idx_reports_prospect on reports(prospect_id);
create index idx_reports_owner on reports(owner_id);
create index idx_action_items_owner on action_items(owner_id);
create index idx_action_items_status on action_items(status);
create index idx_stalls_prospect on stalls_objections_log(prospect_id);
create index idx_learnings_owner on learnings(owner_id);
