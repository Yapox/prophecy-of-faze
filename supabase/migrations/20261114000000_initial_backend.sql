-- Prophecy of FaZe: virtual coins only, with no deposits, cash value, or withdrawals.
-- Apply with the Supabase migration owner (postgres). This file does not deploy itself.
-- Model: whole-coin stakes, fixed 2x gross winning payout, refund on cancellation.
begin;

create type public.prediction_side as enum ('YES', 'NO');
create type public.market_status as enum ('open', 'resolved', 'cancelled');
create type public.wallet_transaction_kind as enum ('signup_bonus', 'prediction_purchase', 'prediction_payout', 'prediction_refund');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'FaZe Fan' check (char_length(btrim(display_name)) between 1 and 50),
  created_at timestamptz not null default now()
);

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 1000 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (char_length(btrim(game)) between 1 and 100),
  event_name text not null check (char_length(btrim(event_name)) between 1 and 200),
  -- FaZe Clan is always one participant; store the other participant here.
  faze_team text not null default 'FaZe Clan' check (faze_team = 'FaZe Clan'),
  opponent text not null check (char_length(btrim(opponent)) between 1 and 100 and lower(btrim(opponent)) <> 'faze clan'),
  starts_at timestamptz not null check (isfinite(starts_at)),
  external_reference text unique,
  created_at timestamptz not null default now()
);

create table public.prediction_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete restrict,
  question text not null check (char_length(btrim(question)) between 1 and 300),
  closes_at timestamptz not null,
  status public.market_status not null default 'open',
  winning_side public.prediction_side,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'open' and winning_side is null and settled_at is null)
    or (status = 'resolved' and winning_side is not null and settled_at is not null)
    or (status = 'cancelled' and winning_side is null and settled_at is not null)
  )
);

-- A market must stop taking predictions by the scheduled match start.
-- CHECK constraints cannot query another table, so enforce this with a trigger.
create function public.validate_prediction_market_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_starts_at timestamptz;
begin
  select starts_at into v_starts_at from public.matches where id = new.match_id;
  if not found then raise exception 'Match not found'; end if;
  if not isfinite(new.closes_at) or new.closes_at > v_starts_at then
    raise exception 'Market closing time must be finite and no later than match start';
  end if;
  return new;
end;
$$;

create trigger validate_prediction_market_window
  before insert or update of match_id, closes_at on public.prediction_markets
  for each row execute function public.validate_prediction_market_window();

-- Each purchase is a position (multiple purchases per market are allowed).
create table public.prediction_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_id uuid not null references public.prediction_markets(id) on delete restrict,
  side public.prediction_side not null,
  stake bigint not null check (stake between 1 and 1000000000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id),
  unique (id, user_id)
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wallets(user_id) on delete cascade,
  position_id uuid,
  kind public.wallet_transaction_kind not null,
  amount bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  foreign key (position_id, user_id) references public.prediction_positions(id, user_id) on delete cascade,
  check (
    (kind = 'signup_bonus' and position_id is null and amount = 1000)
    or (kind = 'prediction_purchase' and position_id is not null and amount < 0)
    or (kind in ('prediction_payout', 'prediction_refund') and position_id is not null and amount > 0)
  )
);

create unique index one_signup_bonus_per_user on public.wallet_transactions(user_id) where kind = 'signup_bonus';
create unique index one_purchase_per_position on public.wallet_transactions(position_id) where kind = 'prediction_purchase';
-- A position can receive a payout OR a refund, never both or a second credit.
create unique index one_credit_per_position on public.wallet_transactions(position_id) where kind in ('prediction_payout', 'prediction_refund');
create index positions_market_user on public.prediction_positions(market_id, user_id);
create index transactions_user_created on public.wallet_transactions(user_id, created_at desc);
create index transactions_position_user on public.wallet_transactions(position_id, user_id);
create index markets_match on public.prediction_markets(match_id);
create index matches_start on public.matches(starts_at);

-- Bootstrap users without trusting user-editable Auth metadata for privileges or money.
create function public.initialize_prediction_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id);
  insert into public.wallets(user_id) values (new.id);
  insert into public.wallet_transactions(user_id, kind, amount, balance_after)
    values (new.id, 'signup_bonus', 1000, 1000);
  return new;
end;
$$;

create trigger on_auth_user_created_prediction_profile
  after insert on auth.users for each row execute function public.initialize_prediction_user();

-- The cloud project may already have Auth users; initialize them in this transaction too.
insert into public.profiles(id) select id from auth.users;
insert into public.wallets(user_id) select id from public.profiles;
insert into public.wallet_transactions(user_id, kind, amount, balance_after)
  select user_id, 'signup_bonus', 1000, 1000 from public.wallets;

create function public.purchase_prediction(
  p_market_id uuid, p_side public.prediction_side, p_stake bigint, p_request_id uuid
)
returns public.prediction_positions
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_market public.prediction_markets;
  v_position public.prediction_positions;
  v_balance bigint;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_market_id is null or p_side is null or p_stake is null
     or p_stake < 1 or p_stake > 1000000000 or p_request_id is null then
    raise exception 'Valid market, side, whole-coin stake and request ID required';
  end if;

  -- All purchase/settlement operations lock market before wallet.
  select * into v_market from public.prediction_markets where id = p_market_id for update;
  if not found then raise exception 'Market not found'; end if;
  select balance into v_balance from public.wallets where user_id = v_user for update;
  if not found then raise exception 'Wallet not found'; end if;

  select * into v_position from public.prediction_positions
    where user_id = v_user and request_id = p_request_id;
  if found then
    if v_position.market_id <> p_market_id or v_position.side <> p_side or v_position.stake <> p_stake then
      raise exception 'Request ID already used with different purchase parameters';
    end if;
    return v_position; -- Safe retries also work after the market closes or settles.
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= clock_timestamp() then
    raise exception 'Market is closed';
  end if;
  -- Also protect against a trusted operator moving the match start earlier.
  if exists (select 1 from public.matches where id = v_market.match_id and starts_at <= clock_timestamp()) then
    raise exception 'Match has already started';
  end if;
  if v_balance < p_stake then raise exception 'Insufficient virtual coins'; end if;

  update public.wallets set balance = balance - p_stake, updated_at = clock_timestamp()
    where user_id = v_user returning balance into v_balance;
  insert into public.prediction_positions(user_id, market_id, side, stake, request_id)
    values (v_user, p_market_id, p_side, p_stake, p_request_id) returning * into v_position;
  insert into public.wallet_transactions(user_id, position_id, kind, amount, balance_after)
    values (v_user, v_position.id, 'prediction_purchase', -p_stake, v_balance);
  return v_position;
end;
$$;

-- Trusted backend only. NULL winning side cancels and refunds the market.
-- Repeating an identical settlement is a no-op; conflicting outcomes fail.
create function public.settle_prediction_market(p_market_id uuid, p_winning_side public.prediction_side)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_market public.prediction_markets;
  v_position public.prediction_positions;
  v_target public.market_status;
  v_credit bigint;
  v_balance bigint;
begin
  v_target := case when p_winning_side is null then 'cancelled'::public.market_status else 'resolved'::public.market_status end;
  select * into v_market from public.prediction_markets where id = p_market_id for update;
  if not found then raise exception 'Market not found'; end if;
  if v_market.status <> 'open' then
    if v_market.status = v_target and v_market.winning_side is not distinct from p_winning_side then
      return;
    end if;
    raise exception 'Market already settled with a different outcome';
  end if;
  if p_winning_side is not null and v_market.closes_at > clock_timestamp() then
    raise exception 'Cannot resolve a market before it closes';
  end if;

  -- Deterministic wallet order prevents deadlocks across concurrent settlements.
  perform w.user_id from public.wallets w
    where exists (select 1 from public.prediction_positions p where p.market_id = p_market_id and p.user_id = w.user_id)
    order by w.user_id for update;

  for v_position in select * from public.prediction_positions where market_id = p_market_id order by user_id, id loop
    v_credit := case when p_winning_side is null then v_position.stake
                     when v_position.side = p_winning_side then v_position.stake * 2 else 0 end;
    if v_credit > 0 then
      update public.wallets set balance = balance + v_credit, updated_at = clock_timestamp()
        where user_id = v_position.user_id returning balance into v_balance;
      insert into public.wallet_transactions(user_id, position_id, kind, amount, balance_after)
        values (v_position.user_id, v_position.id,
          case when p_winning_side is null then 'prediction_refund'::public.wallet_transaction_kind
               else 'prediction_payout'::public.wallet_transaction_kind end, v_credit, v_balance);
    end if;
  end loop;

  update public.prediction_markets set status = v_target, winning_side = p_winning_side, settled_at = clock_timestamp()
    where id = p_market_id;
end;
$$;

-- Deliberate public-to-authenticated projection: no wallet rows or email addresses.
-- Score includes stakes in open markets so buying a position does not reduce rank.
create function public.get_leaderboard(p_limit integer default 100)
returns table (rank bigint, user_id uuid, display_name text, total_coins bigint)
language sql stable security definer set search_path = '' as $$
  with scores as (
    select p.id, p.display_name, (w.balance + coalesce(s.open_stake, 0))::bigint as total_coins
    from public.profiles p join public.wallets w on w.user_id = p.id
    left join (
      select pos.user_id, sum(pos.stake) as open_stake
      from public.prediction_positions pos join public.prediction_markets m on m.id = pos.market_id
      where m.status = 'open' group by pos.user_id
    ) s on s.user_id = p.id
  )
  select dense_rank() over (order by s.total_coins desc), s.id, s.display_name, s.total_coins
  from scores s order by s.total_coins desc, s.id
  limit greatest(1, least(coalesce(p_limit, 100), 100));
$$;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.matches enable row level security;
alter table public.prediction_markets enable row level security;
alter table public.prediction_positions enable row level security;
alter table public.wallet_transactions enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy wallets_read_own on public.wallets for select to authenticated using (user_id = (select auth.uid()));
create policy matches_read on public.matches for select to authenticated using (true);
create policy markets_read on public.prediction_markets for select to authenticated using (true);
create policy positions_read_own on public.prediction_positions for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_read_own on public.wallet_transactions for select to authenticated using (user_id = (select auth.uid()));

-- Explicit ACLs override Supabase's potentially broad default privileges.
revoke all on table public.profiles, public.wallets, public.matches, public.prediction_markets,
  public.prediction_positions, public.wallet_transactions from public, anon, authenticated, service_role;
grant select on public.profiles, public.wallets, public.matches, public.prediction_markets,
  public.prediction_positions, public.wallet_transactions to authenticated, service_role;
grant update (display_name) on public.profiles to authenticated;
grant insert (game, event_name, opponent, starts_at, external_reference) on public.matches to service_role;
grant insert (match_id, question, closes_at) on public.prediction_markets to service_role;
-- Market terms cannot be edited through the API after creation.
-- In particular the service API cannot insert an already-resolved market.
grant usage on schema public to authenticated, service_role;
grant usage on type public.prediction_side, public.market_status, public.wallet_transaction_kind to authenticated, service_role;

revoke all on function public.validate_prediction_market_window() from public, anon, authenticated, service_role;
revoke all on function public.initialize_prediction_user() from public, anon, authenticated, service_role;
revoke all on function public.purchase_prediction(uuid, public.prediction_side, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.settle_prediction_market(uuid, public.prediction_side) from public, anon, authenticated, service_role;
revoke all on function public.get_leaderboard(integer) from public, anon, authenticated, service_role;
grant execute on function public.purchase_prediction(uuid, public.prediction_side, bigint, uuid) to authenticated;
grant execute on function public.settle_prediction_market(uuid, public.prediction_side) to service_role;
grant execute on function public.get_leaderboard(integer) to authenticated;

comment on table public.wallets is 'Virtual gameplay coins only. No monetary value, deposits, withdrawals, or cash redemption.';
comment on function public.purchase_prediction(uuid, public.prediction_side, bigint, uuid) is 'Atomic fixed-odds virtual coin purchase. Reuse request_id for retries of the same purchase.';
comment on function public.settle_prediction_market(uuid, public.prediction_side) is 'Trusted backend only: YES/NO pays winners 2x stake; NULL cancels and refunds. Atomic and idempotent.';
comment on function public.get_leaderboard(integer) is 'Authenticated leaderboard: wallet balance plus unsettled stakes, at most 100 entries. UUIDs and display names are intentionally shared.';

commit;
