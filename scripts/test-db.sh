#!/usr/bin/env bash
# Göçü ve RLS/kredi testlerini geçici bir yerel Postgres veritabanında çalıştırır.
# Supabase'in sağladığı auth şemasını ve rolleri en küçük haliyle taklit eder.
# Kullanım: PGHOST/PGUSER ayarlı bir Postgres 15+ gerekir (varsayılan: yerel soket, postgres kullanıcısı).
set -euo pipefail
cd "$(dirname "$0")/.."

DB="reels_test_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "create database $DB"
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB"' EXIT

"${PSQL[@]}" -d "$DB" <<'SQL'
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase varsayılanı: public tablolar istemci rollerine açıktır, RLS sınırlar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f"
done
psql -v ON_ERROR_STOP=1 -q -t -d "$DB" -f supabase/tests/rls_and_credits.sql
