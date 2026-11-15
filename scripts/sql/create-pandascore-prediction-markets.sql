-- REVIEW BEFORE EXECUTION. Run later in the Supabase SQL Editor as postgres.
-- Standalone data-creation script, not a migration. No settlement or wallet writes.
-- Uses stored match times; closes predictions 15 minutes before each match.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

-- There is no UNIQUE(match_id) constraint. Serialize this script's check/insert
-- operations against other market INSERTs without adding or changing the schema.
lock table public.prediction_markets in share row exclusive mode;

do $create_markets$
declare
  v_target record;
  v_match public.matches;
  v_closes_at timestamptz;
  v_market_id uuid;
begin
  for v_target in
    select * from (values
      ('pandascore:match:1796528', 'fnatic', 'Will FaZe Clan beat fnatic?'),
      ('pandascore:match:1789256', 'Wildcard', 'Will FaZe Clan beat Wildcard?')
    ) as targets(external_reference, expected_opponent, question)
  loop
    -- Hold this match's schedule stable while checking/creating its market.
    select * into v_match
    from public.matches
    where external_reference = v_target.external_reference
    for share;

    if not found then
      raise notice 'SKIP %: imported match not found', v_target.external_reference;
      continue;
    end if;

    if v_match.game <> 'CS2'
       or v_match.faze_team <> 'FaZe Clan'
       or lower(btrim(v_match.opponent)) <> lower(v_target.expected_opponent)
       or v_match.event_name ilike '%fictional%' then
      raise notice 'SKIP %: unexpected game/team/opponent or fictional label', v_target.external_reference;
      continue;
    end if;

    -- Skip ANY existing market for this match, including settled markets or
    -- differently worded questions. Never update, reopen, or replace one.
    if exists (
      select 1 from public.prediction_markets where match_id = v_match.id
    ) then
      raise notice 'UNCHANGED %: a market already exists', v_target.external_reference;
      continue;
    end if;

    v_closes_at := v_match.starts_at - interval '15 minutes';
    if not isfinite(v_closes_at) or v_closes_at <= clock_timestamp() then
      raise notice 'SKIP %: proposed cutoff has passed', v_target.external_reference;
      continue;
    end if;

    -- Recheck the database clock at insertion. The schema supplies status='open',
    -- winning_side=NULL, settled_at=NULL, and generated id/created_at defaults.
    insert into public.prediction_markets (match_id, question, closes_at)
    select v_match.id, v_target.question, v_closes_at
    where v_closes_at > clock_timestamp()
    returning id into v_market_id;

    if found then
      raise notice 'CREATED %: market %', v_target.external_reference, v_market_id;
    else
      raise notice 'SKIP %: cutoff passed during execution', v_target.external_reference;
    end if;
  end loop;
end;
$create_markets$;

commit;

-- Read-only verification. Can also be run separately after creation or a rerun.
with targets(external_reference, expected_question) as (values
  ('pandascore:match:1796528', 'Will FaZe Clan beat fnatic?'),
  ('pandascore:match:1789256', 'Will FaZe Clan beat Wildcard?')
)
select
  t.external_reference,
  m.id as match_id,
  m.opponent,
  m.starts_at,
  p.id as market_id,
  p.question,
  p.question = t.expected_question as question_matches,
  p.status,
  p.closes_at,
  p.closes_at < m.starts_at as closes_before_start,
  p.status = 'open'::public.market_status
    and p.closes_at > clock_timestamp()
    and m.starts_at > clock_timestamp() as accepting_predictions_now,
  p.winning_side,
  p.settled_at,
  (select count(*) from public.prediction_markets existing
   where existing.match_id = m.id) as markets_for_match
from targets t
left join public.matches m on m.external_reference = t.external_reference
left join public.prediction_markets p on p.match_id = m.id
order by t.external_reference, p.id;
