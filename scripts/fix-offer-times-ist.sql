-- The admin offer form used to save the times you typed as UTC, so an offer entered as
-- "2 Oct 19:26" (meant as India time) was stored as 19:26 UTC = 3 Oct 00:56 IST and had not started.
-- This moves that offer's start and end back by 5h30m so they mean the IST times that were entered:
--   starts 2 Oct 2026 19:26 IST, ends 31 Oct 2026 19:26 IST.
-- Only touches this one offer, and only while it still has the shifted times, so it is safe to re-run.
begin;

update app.offers
set starts_at = starts_at - interval '5 hours 30 minutes',
    ends_at   = ends_at   - interval '5 hours 30 minutes',
    version   = version + 1
where id = '61545984-5e8d-4870-aacd-43ca71e5f43c'
  and starts_at = '2026-10-02T19:26:00+00:00';

-- Check: times in IST and whether the storefront would show it now.
select title, is_active,
       starts_at at time zone 'Asia/Kolkata' as starts_ist,
       ends_at   at time zone 'Asia/Kolkata' as ends_ist,
       now() between starts_at and ends_at as live_now
from app.offers
where id = '61545984-5e8d-4870-aacd-43ca71e5f43c';

commit;
