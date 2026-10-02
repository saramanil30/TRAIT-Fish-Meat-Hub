-- Add 500 g to the allowed weights of every RAW_WEIGHT product except Rohu Big.
-- Prices are untouched (raw products are priced per kg). 500 g is listed first.
-- Re-runnable: products that already offer an active 500 g are skipped.
begin;

create temporary table target_products on commit drop as
select p.id, p.business_id
from app.products p
where p.pricing_basis = 'RAW_WEIGHT'
  and p.name <> 'Rohu Big'
  and not exists (select 1 from app.product_allowed_weights w
                  where w.product_id = p.id and w.raw_weight_grams = 500 and w.is_active);

-- Make room at the top of each product's weight list.
update app.product_allowed_weights w set sort_order = w.sort_order + 1
from target_products t
where w.product_id = t.id and w.raw_weight_grams <> 500;

-- Reactivate a retired 500 g row if one exists (rows are never deleted)...
update app.product_allowed_weights w set is_active = true, sort_order = 0
from target_products t
where w.product_id = t.id and w.raw_weight_grams = 500;

-- ...otherwise add it.
insert into app.product_allowed_weights (business_id, product_id, raw_weight_grams, is_active, sort_order)
select t.business_id, t.id, 500, true, 0
from target_products t
where not exists (select 1 from app.product_allowed_weights w where w.product_id = t.id and w.raw_weight_grams = 500);

-- Check: every RAW_WEIGHT product except Rohu Big now lists 500 g first.
select p.name, array_agg(w.raw_weight_grams order by w.sort_order, w.raw_weight_grams) filter (where w.is_active) as weights
from app.products p join app.product_allowed_weights w on w.product_id = p.id
where p.pricing_basis = 'RAW_WEIGHT'
group by p.name order by p.name;

commit;
