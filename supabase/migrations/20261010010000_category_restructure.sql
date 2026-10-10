-- Category restructure, all top-level. Forward-only; data only (no schema, grants or RLS change).
-- Renames keep IDs (FRESH WATER → River Fish, SEAFOOD → Sea Fish, EGGS → Eggs), adds Prawns, Crabs & Lobsters and Dry Fish,
-- moves three products, and sets the display order. Matches by name per business, so it is a no-op where those names don't exist.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

UPDATE app.categories SET name='River Fish' WHERE name='FRESH WATER';
UPDATE app.categories SET name='Sea Fish' WHERE name='SEAFOOD';
UPDATE app.categories SET name='Eggs' WHERE name='EGGS';

INSERT INTO app.categories(business_id,name)
SELECT b.business_id,n.name FROM (SELECT DISTINCT business_id FROM app.categories WHERE name IN ('River Fish','Sea Fish')) b
CROSS JOIN (VALUES ('Prawns'),('Crabs & Lobsters'),('Dry Fish')) n(name)
ON CONFLICT (business_id,name) DO NOTHING;

UPDATE app.categories c SET parent_id=NULL,is_active=true,sort_order=o.position
FROM (VALUES ('River Fish',1),('Sea Fish',2),('Prawns',3),('Crabs & Lobsters',4),('Chicken',5),('Mutton',6),('Eggs',7),('Dry Fish',8)) o(name,position)
WHERE c.name=o.name;

UPDATE app.products p SET category_id=c.id FROM app.categories c
WHERE c.business_id=p.business_id AND c.name='Prawns' AND p.name IN ('Sea Prawns Big','Prawns Above Medium');
UPDATE app.products p SET category_id=c.id FROM app.categories c
WHERE c.business_id=p.business_id AND c.name='Crabs & Lobsters' AND p.name='Blue Crab';

NOTIFY pgrst,'reload schema';
COMMIT;
