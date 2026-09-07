-- Locked Barcode Architecture Migration
-- Purpose: Implement ADD barcode (product identity) + VX barcode (unit identity) for Main Source intake
-- Pattern: ADD barcode is product-level, ONE per product, reusable
--          VX barcode is unit-level, unique per physical item, permanent
-- Execution: Non-destructive, preserves all existing data and flows

-- ============================================================================
-- STEP 1: Add add_item_barcode column to products table
-- ============================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS add_item_barcode TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_products_add_item_barcode ON public.products(add_item_barcode);

COMMENT ON COLUMN public.products.add_item_barcode IS 
'Product-level intake barcode for Main Source. ONE per product, permanent, reusable per unit. Pattern: ADD-xxx-###. Used at intake only. Barcode field remains unchanged for transfer/receive/consume flows.';

-- ============================================================================
-- STEP 2: Create atomic single-unit intake RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_main_source_intake_unit(
  p_add_barcode TEXT,
  p_created_by TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product_uuid UUID;
  v_main_source_branch_id UUID;
  v_vx_barcode TEXT;
  v_serialized_unit_id UUID;
  v_new_inventory_qty INTEGER;
  v_product_name TEXT;
BEGIN
  -- Validate inputs
  IF p_add_barcode IS NULL OR p_add_barcode = '' THEN
    RAISE EXCEPTION 'add_barcode_required';
  END IF;

  IF p_created_by IS NULL OR p_created_by = '' THEN
    RAISE EXCEPTION 'created_by_required';
  END IF;

  -- ========================================================================
  -- LOOKUP: Find product by add_item_barcode
  -- ========================================================================
  SELECT uuid, product_name INTO v_product_uuid, v_product_name
  FROM public.products
  WHERE add_item_barcode = p_add_barcode
  LIMIT 1;

  IF v_product_uuid IS NULL THEN
    RAISE EXCEPTION 'add_barcode_not_found';
  END IF;

  -- ========================================================================
  -- LOOKUP: Find Main Source branch UUID
  -- ========================================================================
  SELECT id INTO v_main_source_branch_id
  FROM public.branches
  WHERE LOWER(TRIM(branch_name)) = LOWER(TRIM('Pasong Buaya'))
  LIMIT 1;

  IF v_main_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'main_source_not_found';
  END IF;

  -- ========================================================================
  -- GENERATE: VX barcode (unit-level, unique, permanent)
  -- Pattern: VX- + 12-char random hex
  -- ========================================================================
  v_vx_barcode := 'VX-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

  -- ========================================================================
  -- CREATE: Serialized unit with VX barcode (atomic with inventory update)
  -- ========================================================================
  BEGIN
    -- Insert serialized unit
    INSERT INTO public.serialized_units (
      id,
      product_id,
      unit_barcode,
      status,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      v_product_uuid,
      v_vx_barcode,
      'AVAILABLE',
      NOW()
    )
    RETURNING id INTO v_serialized_unit_id;

    -- ====================================================================
    -- UPDATE: Inventory (+1 unit)
    -- ====================================================================
    UPDATE public.inventory
    SET quantity = quantity + 1,
        last_updated = NOW()
    WHERE product_id = (SELECT id FROM public.products WHERE uuid = v_product_uuid)
      AND branch_id = v_main_source_branch_id;

    -- If no inventory row exists, create it
    IF NOT FOUND THEN
      INSERT INTO public.inventory (
        uuid,
        product_id,
        branch_id,
        branch,
        quantity,
        last_updated
      )
      VALUES (
        gen_random_uuid(),
        (SELECT id FROM public.products WHERE uuid = v_product_uuid),
        v_main_source_branch_id,
        'Pasong Buaya',
        1,
        NOW()
      );
    END IF;

    -- Get updated inventory quantity
    SELECT quantity INTO v_new_inventory_qty
    FROM public.inventory
    WHERE product_id = (SELECT id FROM public.products WHERE uuid = v_product_uuid)
      AND branch_id = v_main_source_branch_id
    LIMIT 1;

    v_new_inventory_qty := COALESCE(v_new_inventory_qty, 1);

    -- ====================================================================
    -- RECORD: Stock transaction (intake record)
    -- ====================================================================
    INSERT INTO public.stock_transactions (
      uuid,
      product_id,
      branch_id,
      barcode,
      branch,
      type,
      quantity,
      user_name,
      date
    )
    VALUES (
      gen_random_uuid(),
      (SELECT id FROM public.products WHERE uuid = v_product_uuid),
      v_main_source_branch_id,
      v_vx_barcode,
      'Pasong Buaya',
      'TRANSFER_IN',
      1,
      p_created_by,
      NOW()
    );

  EXCEPTION WHEN OTHERS THEN
    -- If any step fails, rollback entire transaction
    RAISE EXCEPTION 'intake_creation_failed: %', SQLERRM;
  END;

  -- ========================================================================
  -- SUCCESS: Return response
  -- ========================================================================
  RETURN jsonb_build_object(
    'success', TRUE,
    'vx_barcode', v_vx_barcode,
    'serialized_unit_id', v_serialized_unit_id,
    'product_uuid', v_product_uuid,
    'product_name', v_product_name,
    'inventory_qty', v_new_inventory_qty,
    'branch_id', v_main_source_branch_id,
    'created_at', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  -- Return error response
  RETURN jsonb_build_object(
    'success', FALSE,
    'error', SQLERRM
  );
END;
$$;

COMMENT ON FUNCTION public.create_main_source_intake_unit(TEXT, TEXT) IS 
'Atomic single-unit Main Source intake. Looks up product by add_item_barcode, creates ONE serialized_unit with VX barcode, updates inventory +1, records stock_transaction. Returns {success, vx_barcode, serialized_unit_id, product_uuid, product_name, inventory_qty}. Prevents concurrent duplicates via UNIQUE constraint on vx_barcode.';

-- ============================================================================
-- STEP 3: Create serialized_units table if not exists
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.serialized_units (
  id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  unit_barcode TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'IN_TRANSIT', 'CONSUMED', 'DISCARDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_serialized_units_product_id ON public.serialized_units(product_id);
CREATE INDEX IF NOT EXISTS idx_serialized_units_unit_barcode ON public.serialized_units(unit_barcode);
CREATE INDEX IF NOT EXISTS idx_serialized_units_status ON public.serialized_units(status);

COMMENT ON TABLE public.serialized_units IS 
'Unit-level serialization for individual items. Stores VX barcodes (unit identity). status lifecycle: AVAILABLE → IN_TRANSIT/CONSUMED/DISCARDED.';

-- ============================================================================
-- VERIFICATION: Ensure backward compatibility
-- ============================================================================
-- The products.barcode field (ABC000001-ABC000019) remains unchanged for transfer/receive/consume flows.
-- The inventory.quantity aggregation remains unchanged.
-- The stock_transactions table continues to track all movements.
-- The serialized_units table now supports VX barcode for fine-grained unit tracking.
-- Existing TRF- transfer flow unaffected.
-- Existing ABC barcode flows unaffected.
-- Existing consume flow unaffected.

-- ============================================================================
-- AUDIT COMMENT
-- ============================================================================
-- Created: 2025-01-01
-- Purpose: Locked barcode architecture for Main Source intake
-- Non-destructive: All existing tables, columns, flows preserved
-- Reversible: Can DROP add_item_barcode column and DROP function if needed
-- Dependencies: None on existing functions
-- Performance: UNIQUE index on add_item_barcode for O(1) lookups
-- Atomicity: Single-unit intake RPC is transaction-safe
