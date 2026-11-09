-- Şema, RLS ve kredi fonksiyonları için duman testi.
-- Çalıştırma: scripts/test-db.sh (yerel Postgres üzerinde, Supabase'in auth
-- şemasını taklit eden küçük bir kurulumla).
\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  pa uuid;
  n integer;
  ok boolean;
begin
  -- Kayıt tetikleyicisi: profil + hoş geldin kredisi
  select credits_balance into n from public.profiles where id = a;
  assert n = 200, 'signup bonus expected 200, got ' || n;

  insert into public.projects (user_id, title, topic) values (a, 'A', 'a') returning id into pa;
  insert into public.projects (user_id, title, topic) values (b, 'B', 'b');
  insert into public.frames (project_id, index, sentence, start_phrase, shot_prompt_en)
    values (pa, 0, 's', 's', 'p');

  -- Rezerve idempotent
  ok := public.reserve_credits(a, pa, 30, 'voiceover', 'audio:1');
  assert ok, 'first reserve should succeed';
  ok := public.reserve_credits(a, pa, 30, 'voiceover', 'audio:1');
  assert ok, 'repeat reserve should report success';
  select credits_balance into n from public.profiles where id = a;
  assert n = 170, 'reserve must charge once, balance ' || n;

  -- Yetersiz bakiye
  ok := public.reserve_credits(a, pa, 1000, 'frames', 'frames:1');
  assert not ok, 'reserve over balance must fail';
  select credits_balance into n from public.profiles where id = a;
  assert n = 170, 'failed reserve must not charge';

  -- İade idempotent
  n := public.refund_credits(a, 'audio:1');
  assert n = 30, 'refund should return 30, got ' || n;
  n := public.refund_credits(a, 'audio:1');
  assert n = 0, 'second refund must be a no-op';
  n := public.refund_credits(a, 'does-not-exist');
  assert n = 0, 'refund without reserve must be a no-op';
  select credits_balance into n from public.profiles where id = a;
  assert n = 200, 'balance after refund ' || n;

  -- Satın alma idempotent (webhook iki kez gelirse)
  ok := public.grant_credits(a, 500, 'purchase', 'pack_500', 'cs_test_1');
  assert ok;
  ok := public.grant_credits(a, 500, 'purchase', 'pack_500', 'cs_test_1');
  assert not ok, 'duplicate grant must be ignored';
  select credits_balance into n from public.profiles where id = a;
  assert n = 700, 'balance after grant ' || n;
end $$;

-- RLS: A kullanıcısı olarak
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);

do $$
declare
  n integer;
begin
  select count(*) into n from public.projects;
  assert n = 1, 'user sees only own projects, saw ' || n;
  select count(*) into n from public.profiles;
  assert n = 1, 'user sees only own profile';
  select count(*) into n from public.frames;
  assert n = 1, 'user sees own frames';
  select count(*) into n from public.credit_transactions where user_id <> auth.uid();
  assert n = 0, 'no foreign transactions';

  -- Ayar sütunu değişebilir
  update public.profiles set locale = 'en' where id = auth.uid();

  -- Kredi değişemez
  begin
    update public.profiles set credits_balance = 99999 where id = auth.uid();
    raise exception 'TEST FAILED: client could change credits';
  exception when insufficient_privilege then null;
  end;

  -- Doğrudan yazma kapalı
  begin
    insert into public.projects (user_id, title, topic) values (auth.uid(), 'x', 'x');
    raise exception 'TEST FAILED: client could insert a project';
  exception when insufficient_privilege then null;
  end;

  -- Kredi fonksiyonları çağrılamaz
  begin
    perform public.grant_credits(auth.uid(), 100, 'bonus', 'x', 'x');
    raise exception 'TEST FAILED: client could grant credits';
  exception when insufficient_privilege then null;
  end;

  -- Yalnızca sunucu tabloları okunamaz
  begin
    perform 1 from public.api_costs;
    raise exception 'TEST FAILED: client could read api_costs';
  exception when insufficient_privilege then null;
  end;
end $$;

-- B kullanıcısı A'nın karelerini göremez
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', false);
do $$
declare
  n integer;
begin
  select count(*) into n from public.frames;
  assert n = 0, 'other user must not see frames, saw ' || n;
end $$;

reset role;
select 'ALL DB TESTS PASSED' as result;
