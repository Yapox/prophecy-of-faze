begin;

create unique index one_open_question_per_match on public.prediction_markets(match_id, question) where status = 'open';

-- Service-only operational receipts. No credentials or account chat text.
create table public.prediction_operations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  match_id uuid references public.matches(id),
  market_id uuid references public.prediction_markets(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.prediction_operations enable row level security;
revoke all on public.prediction_operations from public, anon, authenticated, service_role;
grant select on public.prediction_operations to service_role;

create function public.sync_pandascore_match(p_fixture jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_match public.matches%rowtype;
  v_market public.prediction_markets%rowtype;
  v_ref text := p_fixture->>'external_reference';
  v_opponent text := btrim(p_fixture->>'opponent');
  v_event text := btrim(p_fixture->>'event_name');
  v_start timestamptz;
  v_new boolean := false;
  v_changed boolean := false;
  v_has_positions boolean;
begin
  if jsonb_typeof(p_fixture) <> 'object' or p_fixture->>'game' is distinct from 'CS2'
      or v_ref is null or v_ref !~ '^pandascore:match:[1-9][0-9]*$'
      or v_opponent is null or char_length(v_opponent) not between 1 and 100
      or lower(v_opponent) in ('faze', 'faze clan', 'tbd', 'tba', 'unknown')
      or v_event is null or char_length(v_event) not between 1 and 200
      or coalesce(p_fixture->>'starts_at', '') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'Invalid PandaScore fixture';
  end if;
  v_start := (p_fixture->>'starts_at')::timestamptz;
  if not isfinite(v_start) or v_start - interval '5 minutes' <= clock_timestamp() then
    raise exception 'Fixture no longer has an open prediction window';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pandascore-sync:' || v_ref, 0));
  select * into v_match from public.matches where external_reference = v_ref for update;
  if not found then
    insert into public.matches(game, event_name, opponent, starts_at, external_reference)
      values ('CS2', v_event, v_opponent, v_start, v_ref) returning * into v_match;
    v_new := true;
  elsif v_match.game <> 'CS2' or v_match.faze_team <> 'FaZe Clan' then
    raise exception 'Existing source identity does not match';
  end if;

  -- Lock market terms before checking positions. Purchases use the same locks.
  perform 1 from public.prediction_markets where match_id = v_match.id order by id for update;
  select exists(select 1 from public.prediction_positions p join public.prediction_markets m on m.id = p.market_id where m.match_id = v_match.id) into v_has_positions;
  v_changed := v_match.starts_at <> v_start or v_match.opponent <> v_opponent;
  if v_changed then
    for v_market in select * from public.prediction_markets where match_id = v_match.id and status = 'open' order by id loop
      perform public.settle_prediction_market(v_market.id, null);
    end loop;
    if v_has_positions then
      -- Preserve purchased/historical terms, refund every still-open position,
      -- and require review before publishing a replacement market.
      insert into public.prediction_operations(operation_key, match_id, action, details)
        values ('drift:' || v_ref || ':' || v_start::text || ':' || v_opponent, v_match.id, 'schedule_or_opponent_drift_refunded_review_required', p_fixture)
        on conflict (operation_key) do nothing;
      return jsonb_build_object('action', 'refunded_review_required', 'match_id', v_match.id);
    end if;
    update public.matches set starts_at = v_start, opponent = v_opponent, event_name = v_event where id = v_match.id;
  elsif not v_has_positions and v_match.event_name <> v_event then
    update public.matches set event_name = v_event where id = v_match.id;
  end if;

  if not v_changed and exists(select 1 from public.prediction_markets where match_id = v_match.id) then
    return jsonb_build_object('action', 'existing_market', 'match_id', v_match.id);
  end if;
  insert into public.prediction_markets(match_id, question, closes_at)
    values (v_match.id, 'Will FaZe Clan beat ' || v_opponent || '?', v_start - interval '5 minutes') returning * into v_market;
  insert into public.prediction_operations(operation_key, match_id, market_id, action, details)
    values ('market:' || v_market.id::text, v_match.id, v_market.id, 'pandascore_market_created', p_fixture);
  return jsonb_build_object('action', case when v_new then 'match_and_market_created' when v_changed then 'untraded_fixture_rescheduled' else 'market_created' end, 'match_id', v_match.id, 'market_id', v_market.id);
end;
$$;
revoke all on function public.sync_pandascore_match(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_pandascore_match(jsonb) to service_role;

create function public.settle_pandascore_prediction(p_market_id uuid, p_winning_side public.prediction_side, p_evidence jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_market public.prediction_markets%rowtype;
  v_match public.matches%rowtype;
begin
  select * into v_market from public.prediction_markets where id = p_market_id for update;
  if not found then raise exception 'Market not found'; end if;
  select * into v_match from public.matches where id = v_market.match_id;
  if coalesce(v_match.external_reference, '') !~ '^pandascore:match:[1-9][0-9]*$' or v_match.game <> 'CS2'
      or v_market.question <> 'Will FaZe Clan beat ' || v_match.opponent || '?'
      or p_winning_side is null or jsonb_typeof(p_evidence) is distinct from 'object'
      or p_evidence->>'external_reference' is distinct from v_match.external_reference
      or p_evidence->>'market_id' is distinct from p_market_id::text
      or p_evidence->'rpc'->>'p_winning_side' is distinct from p_winning_side::text
      or p_evidence->>'faze_team_id' is distinct from '3212'
      or p_evidence->>'winner_team_id' is distinct from (case when p_winning_side = 'YES' then '3212' else p_evidence->>'opponent_team_id' end)
      or octet_length(p_evidence::text) > 16384 then
    raise exception 'Settlement evidence does not match this market';
  end if;
  perform public.settle_prediction_market(p_market_id, p_winning_side);
  insert into public.prediction_operations(operation_key, match_id, market_id, action, details)
    values ('settlement:' || p_market_id::text, v_match.id, p_market_id, 'pandascore_settlement', p_evidence)
    on conflict (operation_key) do nothing;
end;
$$;
revoke all on function public.settle_pandascore_prediction(uuid, public.prediction_side, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.settle_pandascore_prediction(uuid, public.prediction_side, jsonb) to service_role;

-- Shared across server instances: five requests per user/minute and 500/day
-- for this prototype. A reservation counts even when an upstream request fails.
create table public.oracle_request_limits (
  bucket text primary key,
  requests integer not null default 0 check (requests >= 0),
  expires_at timestamptz not null
);
alter table public.oracle_request_limits enable row level security;
revoke all on public.oracle_request_limits from public, anon, authenticated, service_role;

create function public.reserve_oracle_request()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_day text;
  v_minute text;
  v_total integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  v_day := 'day:' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD');
  v_minute := 'user:' || v_user::text || ':' || to_char(v_now at time zone 'UTC', 'YYYY-MM-DD-HH24-MI');
  delete from public.oracle_request_limits where expires_at < v_now;
  insert into public.oracle_request_limits(bucket, expires_at) values (v_day, v_now + interval '2 days') on conflict do nothing;
  select requests into v_total from public.oracle_request_limits where bucket = v_day for update;
  insert into public.oracle_request_limits(bucket, expires_at) values (v_minute, v_now + interval '2 minutes') on conflict do nothing;
  select requests into v_used from public.oracle_request_limits where bucket = v_minute for update;
  if v_total >= 500 or v_used >= 5 then return false; end if;
  update public.oracle_request_limits set requests = requests + 1 where bucket in (v_day, v_minute);
  return true;
end;
$$;
revoke all on function public.reserve_oracle_request() from public, anon, authenticated, service_role;
grant execute on function public.reserve_oracle_request() to authenticated;

comment on function public.sync_pandascore_match(jsonb) is 'Service-only atomic fixture and fixed-contract market publication. Drift with positions refunds open markets and requires review.';
comment on function public.settle_pandascore_prediction(uuid, public.prediction_side, jsonb) is 'Service-only existing payout RPC plus an immutable first settlement receipt. Server must validate provider evidence.';
commit;
