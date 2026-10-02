-- Set the allowed weights shown to customers. Prices are not touched.
--   RAW_WEIGHT products: 500 g, 1 kg, 1.5 kg, 2 kg (Rohu Big: 1 kg, 1.5 kg only)
--   King Fish / Vanjaram (NET_WEIGHT): 500 g, 1 kg, 1.5 kg net
--
-- app.products is the source of truth: its trigger (products_catalogue_sync) rebuilds
-- app.product_allowed_weights from products.allowed_weights, so the admin product form and
-- the storefront stay in agreement. This replaces scripts/add-500g-raw-weights.sql, which edited
-- the weights table directly; running this script also repairs anything that one changed.
-- Re-runnable.
begin;

update app.products
set allowed_weights = case when name = 'Rohu Big' then '[1000,1500]'::jsonb else '[500,1000,1500,2000]'::jsonb end
where pricing_basis = 'RAW_WEIGHT'
  and allowed_weights is distinct from case when name = 'Rohu Big' then '[1000,1500]'::jsonb else '[500,1000,1500,2000]'::jsonb end;

update app.products
set sale_quantities = '[500,1000,1500]'::jsonb
where pricing_basis = 'NET_WEIGHT' and name = 'King Fish / Vanjaram'
  and sale_quantities is distinct from '[500,1000,1500]'::jsonb;

-- Check: what customers will be offered (active weights, in order) next to the product's own setting.
select p.name, p.pricing_basis,
       coalesce(nullif(p.allowed_weights, '[]'::jsonb), p.sale_quantities) as configured,
       (select array_agg(w.raw_weight_grams order by w.sort_order) from app.product_allowed_weights w
         where w.product_id = p.id and w.is_active) as active_raw_weights
from app.products p
where p.pricing_basis in ('RAW_WEIGHT', 'NET_WEIGHT')
order by p.pricing_basis, p.name;

commit;
