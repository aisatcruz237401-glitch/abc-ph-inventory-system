-- Supabase seed: safe upsert of branches, products, users, and inventory.
-- This script is intentionally non-destructive and avoids deleting or overwriting existing rows without a conflict check.

INSERT INTO public.branches (branch_code, name, status)
VALUES ('MAIN', 'Main', 'active')
ON CONFLICT (branch_code) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO public.products (sku, barcode, product_name, category, description)
VALUES ('SKU-001', '123456789012', 'Sample Product', 'General', 'Seeded product')
ON CONFLICT (barcode) DO UPDATE
SET product_name = EXCLUDED.product_name,
    sku = EXCLUDED.sku,
    category = EXCLUDED.category,
    description = EXCLUDED.description;

INSERT INTO public.users (username, password_hash, email, full_name, role, branch)
VALUES (
  'admin',
  '$2a$10$f53EjA3S5dkmry.AQhteMOKKUHk86UAZdyLo.1GbPVc2cEy7QzvTu',
  'admin@local',
  'Administrator',
  'admin',
  'Main'
)
ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    branch = EXCLUDED.branch,
    updated_at = NOW();

WITH p AS (
  SELECT id AS pid FROM public.products WHERE barcode = '123456789012' LIMIT 1
), b AS (
  SELECT id AS bid FROM public.branches WHERE branch_code = 'MAIN' LIMIT 1
)
INSERT INTO public.inventory (product_id, branch_id, branch, quantity)
SELECT p.pid, b.bid, 'Main', 100
FROM p, b
ON CONFLICT (product_id, branch_id)
DO UPDATE SET quantity = public.inventory.quantity,
              last_updated = NOW();
