-- Drop stock reservation.
--
-- The decrement must be atomic ("UPDATE ... WHERE qty_left >= n RETURNING"), but a neighbor
-- has no UPDATE policy on drops and should not get one: that would let any signed-in user
-- rewrite qty_left. Reserving through this security-definer primitive keeps the write narrow
-- (only ever subtracts, only when enough stock exists) while staying race-safe.
create or replace function reserve_drop_units(p_drop_id uuid, p_qty integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if p_qty is null or p_qty <= 0 then
    return -1;
  end if;

  update drops
     set qty_left = qty_left - p_qty
   where id = p_drop_id
     and qty_left >= p_qty
  returning qty_left into remaining;

  -- -1 means "could not reserve": either the drop is gone or the units were taken first.
  return coalesce(remaining, -1);
end $$;

grant execute on function reserve_drop_units(uuid, integer) to public;
