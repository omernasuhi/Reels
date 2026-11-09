-- Dikey Hikâye Reels Stüdyosu: başlangıç şeması
-- Kural: istemci yalnızca kendi satırlarını OKUR. Tüm yazma işlemleri sunucuda
-- service_role ile yapılır (tek istisna: profiles üzerindeki ayar sütunları).

-- ---------------------------------------------------------------------------
-- Ayarlar (fiyatlar, sınırlar)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('pricing', '{"script": 2, "character_card": 3, "frame": 3, "voiceover": 30, "render": 5, "frame_regenerate": 3}'),
  ('limits', '{"max_concurrent_projects": 2, "max_daily_projects": 10}'),
  -- Gerçek maliyet tahmini için birim fiyatlar (USD) ve bir kredinin satış değeri
  ('api_prices', '{"claude_input_per_mtok": 2, "claude_output_per_mtok": 10, "replicate_image": 0.04, "elevenlabs_per_1k_chars": 0.15, "scribe_per_minute": 0.007, "render": 0.02, "credit_value": 0.05}'),
  ('signup_bonus_credits', '200');

-- ---------------------------------------------------------------------------
-- Profil
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  credits_balance integer not null default 0 check (credits_balance >= 0),
  is_admin boolean not null default false,
  locale text not null default 'tr',
  default_voice_id text,
  notify_email boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Proje ve içerik tabloları
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  topic text not null,
  options jsonb not null default '{}',
  status text not null default 'draft' check (status in (
    'draft', 'script', 'characters', 'producing', 'preview', 'rendering', 'done', 'failed'
  )),
  cover_image_url text,
  job_step text,                -- arka planda süren adımın adı (ilerleme göstergesi için)
  job_error text,               -- kullanıcıya gösterilecek son hata mesajı
  job_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_created_idx on public.projects (user_id, created_at desc);

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  plain_text text not null,
  tagged_text text not null,
  word_count integer not null,
  version integer not null default 1,
  vote_options jsonb,
  opening_stamp text,           -- açılış kartı: mekân/zaman damgası
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  description_en text not null,
  card_image_url text,
  replicate_prediction_id text,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'error')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  key text not null,
  description_en text not null,
  unique (project_id, key)
);

create table public.frames (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  index integer not null,
  sentence text not null,
  start_phrase text not null,
  shot_prompt_en text not null,
  character_ids uuid[] not null default '{}',
  location_key text,
  kind text not null default 'normal' check (kind in (
    'normal', 'opening', 'problem', 'final', 'reveal', 'closing'
  )),
  uses_product boolean not null default false,
  image_url text,
  replicate_prediction_id text,
  status text not null default 'queued' check (status in (
    'queued', 'generating', 'checking', 'fixing', 'ready', 'review', 'error'
  )),
  qc_result jsonb,
  attempt_count integer not null default 0,
  start_time_raw double precision,
  start_time_final double precision,
  duration double precision,
  unique (project_id, index)
);

create table public.audio (
  project_id uuid primary key references public.projects (id) on delete cascade,
  raw_url text,
  trimmed_url text,
  raw_duration double precision,
  trimmed_duration double precision,
  words jsonb,
  trim_map jsonb,
  created_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  text text not null,
  frame_index integer not null,
  "offset" double precision not null default 0,
  duration double precision not null default 1.8,
  size integer not null default 96,
  y_position double precision not null default 0.5,
  enabled boolean not null default true
);
create index cards_project_idx on public.cards (project_id);

create table public.renders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  variant text not null check (variant in ('cards', 'clean')),
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'error')),
  video_url text,
  duration double precision,
  created_at timestamptz not null default now(),
  unique (project_id, variant)
);

-- ---------------------------------------------------------------------------
-- Krediler, maliyet ve olay günlüğü
-- ---------------------------------------------------------------------------
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  amount integer not null,            -- eksi: harcama, artı: yükleme/iade
  kind text not null check (kind in ('purchase', 'bonus', 'reserve', 'refund', 'adjust')),
  reason text not null,
  ref text,                           -- idempotency anahtarı, örn. "frame:<id>:1"
  created_at timestamptz not null default now()
);
create index credit_tx_user_idx on public.credit_transactions (user_id, created_at desc);
create unique index credit_tx_ref_idx on public.credit_transactions (user_id, kind, ref)
  where ref is not null;

create table public.api_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  provider text not null,
  operation text not null,
  cost_usd numeric(12, 6) not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index api_costs_project_idx on public.api_costs (project_id);

create table public.project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  step text not null,
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index project_events_project_idx on public.project_events (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- Yeni kullanıcıya profil + hoş geldin kredisi
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bonus integer;
begin
  select coalesce((value #>> '{}')::integer, 0) into bonus
    from public.app_settings where key = 'signup_bonus_credits';
  bonus := coalesce(bonus, 0);

  insert into public.profiles (id, credits_balance) values (new.id, bonus);
  if bonus > 0 then
    insert into public.credit_transactions (user_id, amount, kind, reason, ref)
      values (new.id, bonus, 'bonus', 'signup_bonus', 'signup');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Kredi fonksiyonları (yalnızca service_role çağırabilir)
-- Hepsi "ref" üzerinden idempotent: aynı ref ile ikinci çağrı para hareketi yapmaz.
-- ---------------------------------------------------------------------------

-- Rezerve: bakiye yeterliyse düşer ve true döner. Aynı ref daha önce
-- rezerve edildiyse tekrar düşmeden true döner. Yetersiz bakiyede false.
create function public.reserve_credits(
  p_user uuid, p_project uuid, p_amount integer, p_reason text, p_ref text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  bal integer;
begin
  if p_amount < 0 or p_ref is null then
    raise exception 'invalid reserve arguments';
  end if;

  select credits_balance into bal from public.profiles where id = p_user for update;
  if not found then
    raise exception 'profile not found';
  end if;

  if exists (select 1 from public.credit_transactions
             where user_id = p_user and kind = 'reserve' and ref = p_ref) then
    return true;
  end if;

  if bal < p_amount then
    return false;
  end if;

  update public.profiles set credits_balance = credits_balance - p_amount where id = p_user;
  insert into public.credit_transactions (user_id, project_id, amount, kind, reason, ref)
    values (p_user, p_project, -p_amount, 'reserve', p_reason, p_ref);
  return true;
end $$;

-- İade: ref ile yapılmış rezervi bir kez geri verir. İade edilen tutarı döner
-- (rezerv yoksa ya da zaten iade edildiyse 0).
create function public.refund_credits(p_user uuid, p_ref text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  perform 1 from public.profiles where id = p_user for update;

  select project_id, amount, reason into r from public.credit_transactions
    where user_id = p_user and kind = 'reserve' and ref = p_ref;
  if not found then
    return 0;
  end if;
  if exists (select 1 from public.credit_transactions
             where user_id = p_user and kind = 'refund' and ref = p_ref) then
    return 0;
  end if;

  update public.profiles set credits_balance = credits_balance - r.amount where id = p_user;
  insert into public.credit_transactions (user_id, project_id, amount, kind, reason, ref)
    values (p_user, r.project_id, -r.amount, 'refund', r.reason, p_ref);
  return -r.amount;
end $$;

-- Yükleme (satın alma, bonus, düzeltme). Aynı ref ile ikinci çağrı false döner.
create function public.grant_credits(
  p_user uuid, p_amount integer, p_kind text, p_reason text, p_ref text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_amount <= 0 or p_kind not in ('purchase', 'bonus', 'adjust') then
    raise exception 'invalid grant arguments';
  end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception 'profile not found';
  end if;
  if p_ref is not null and exists (select 1 from public.credit_transactions
             where user_id = p_user and kind = p_kind and ref = p_ref) then
    return false;
  end if;
  update public.profiles set credits_balance = credits_balance + p_amount where id = p_user;
  insert into public.credit_transactions (user_id, amount, kind, reason, ref)
    values (p_user, p_amount, p_kind, p_reason, p_ref);
  return true;
end $$;

revoke execute on function public.reserve_credits(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.refund_credits(uuid, text) from public, anon, authenticated;
revoke execute on function public.grant_credits(uuid, integer, text, text, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.refund_credits(uuid, text) to service_role;
grant execute on function public.grant_credits(uuid, integer, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.scripts enable row level security;
alter table public.characters enable row level security;
alter table public.locations enable row level security;
alter table public.frames enable row level security;
alter table public.audio enable row level security;
alter table public.cards enable row level security;
alter table public.renders enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.api_costs enable row level security;       -- politika yok: yalnızca sunucu
alter table public.project_events enable row level security;  -- politika yok: yalnızca sunucu

-- İstemci rolleri yalnızca okuyabilir; yazma yetkilerini tablo düzeyinde de kapat.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.app_settings, public.profiles, public.projects, public.scripts,
  public.characters, public.locations, public.frames, public.audio, public.cards,
  public.renders, public.credit_transactions to authenticated;

-- Profilde kullanıcı yalnızca ayar sütunlarını değiştirebilir (kredi ve yöneticilik hariç).
grant update (locale, default_voice_id, notify_email) on public.profiles to authenticated;

create policy "settings readable" on public.app_settings
  for select to authenticated using (true);

create policy "own profile read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own projects read" on public.projects
  for select to authenticated using (user_id = (select auth.uid()));

create policy "own credit transactions read" on public.credit_transactions
  for select to authenticated using (user_id = (select auth.uid()));

create function public.owns_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects
    where id = p_project and user_id = (select auth.uid())
  );
$$;

create policy "own scripts read" on public.scripts
  for select to authenticated using (public.owns_project(project_id));
create policy "own characters read" on public.characters
  for select to authenticated using (public.owns_project(project_id));
create policy "own locations read" on public.locations
  for select to authenticated using (public.owns_project(project_id));
create policy "own frames read" on public.frames
  for select to authenticated using (public.owns_project(project_id));
create policy "own audio read" on public.audio
  for select to authenticated using (public.owns_project(project_id));
create policy "own cards read" on public.cards
  for select to authenticated using (public.owns_project(project_id));
create policy "own renders read" on public.renders
  for select to authenticated using (public.owns_project(project_id));
