-- Phase 2: serialized item barcode generation for Main Source intake
-- Safe, additive migration. Existing rows are preserved.
-- This does not remove the old ADD- barcode stack or the VX legacy format.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper: generate the new per-item barcode format.
-- Example: AB090120260001
-- Format: [2 letters from product name][DDMMYYYY][0001 sequential, zero-padded]
-- The prefix is derived from the product name and normalized to uppercase.
CREATE OR REPLACE FUNCTION public.generate_serialized_item_barcode(
  p_product_name TEXT,
  p_intake_date DATE,
  p_sequence INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT;
  v_date_part TEXT;
  v_sequence_part TEXT;
BEGIN
  IF trim(COALESCE(p_product_name, '')) = '' THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  IF p_intake_date IS NULL THEN
    RAISE EXCEPTION 'date_required';
  END IF;

  IF p_sequence IS NULL OR p_sequence < 1 THEN
    RAISE EXCEPTION 'sequence_required';
  END IF;

  v_prefix := upper(regexp_replace(trim(p_product_name), '[^A-Za-z]', '', 'g'));
  IF length(v_prefix) < 2 THEN
    v_prefix := left(v_prefix || 'XX', 2);
  END IF;
  v_prefix := left(v_prefix, 2);

  v_date_part := to_char(p_intake_date, 'DDMMYYYY');
  v_sequence_part := lpad(p_sequence::TEXT, 4, '0');

  RETURN v_prefix || v_date_part || v_sequence_part;
END;
$$;

-- Helper: generates the next sequential item barcode for a given product/date.
-- Uses a database-side lock to avoid collisions under concurrent intake.
CREATE OR REPLACE FUNCTION public.next_serialized_item_sequence(
  p_product_uuid UUID,
  p_intake_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sequence INTEGER;
BEGIN
  IF p_product_uuid IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  IF p_intake_date IS NULL THEN
    RAISE EXCEPTION 'date_required';
  END IF;

  -- Lock the product-date sequence range using an advisory lock.
  PERFORM pg_advisory_xact_lock(hashtext(p_product_uuid::TEXT), hashtext(to_char(p_intake_date, 'YYYY-MM-DD')));

  SELECT COALESCE(MAX(CAST(SUBSTRING(unit_barcode, 9, 4) AS INTEGER)), 0)
    INTO v_sequence
  FROM public.serialized_units
  WHERE product_id = (
    SELECT id FROM public.products WHERE uuid = p_product_uuid LIMIT 1
  )
    AND unit_barcode ~ ('^' || left(upper(regexp_replace((SELECT product_name FROM public.products WHERE uuid = p_product_uuid LIMIT 1), '[^A-Za-z]', '', 'g')), 2) || to_char(p_intake_date, 'DDMMYYYY') || '[0-9]{4}$');

  RETURN v_sequence + 1;
END;
$$;

-- Atomic batch intake for a single product/date/quantity.
-- This intentionally preserves the legacy ADD- intake and VX compatibility.
CREATE OR REPLACE FUNCTION public.create_main_source_intake_batch(
  p_product_uuid UUID,
  p_intake_date DATE,
  p_quantity INTEGER,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_main_source_branch_id UUID;
  v_sequence INTEGER := 0;
  v_generated_barcodes TEXT[] := ARRAY[]::TEXT[];
  v_index INTEGER;
  v_inventory_qty INTEGER;
  v_prefix TEXT;
  v_barcode TEXT;
  v_serialized_unit_id UUID;
BEGIN
  IF p_product_uuid IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  IF p_intake_date IS NULL THEN
    RAISE EXCEPTION 'date_required';
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  IF trim(COALESCE(p_created_by, '')) = '' THEN
    p_created_by := 'system';
  END IF;

  SELECT p.id, p.uuid, p.product_name, p.barcode
    INTO v_product
  FROM public.products p
  WHERE p.uuid = p_product_uuid
  LIMIT 1;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'is_active'
  ) THEN
    IF v_product.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'product_inactive';
    END IF;
  END IF;

  IF trim(COALESCE(v_product.product_name, '')) = '' THEN
    RAISE EXCEPTION 'product_name_required';
  END IF;

  v_prefix := upper(regexp_replace(trim(v_product.product_name), '[^A-Za-z]', '', 'g'));
  IF length(v_prefix) < 2 THEN
    RAISE EXCEPTION 'product_name_prefix_invalid';
  END IF;
  v_prefix := left(v_prefix, 2);

  SELECT id INTO v_main_source_branch_id
  FROM public.branches
  WHERE LOWER(TRIM(branch_name)) = LOWER(TRIM('Pasong Buaya Main Source'))
  LIMIT 1;

  IF v_main_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'main_source_not_found';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(unit_barcode, 9, 4) AS INTEGER)), 0)
    INTO v_sequence
  FROM public.serialized_units
  WHERE product_uuid = v_product.uuid
    AND unit_barcode ~ ('^' || v_prefix || to_char(p_intake_date, 'DDMMYYYY') || '[0-9]{4}$');

  v_sequence := v_sequence + 1;

  FOR v_index IN 1..p_quantity LOOP
    v_barcode := public.generate_serialized_item_barcode(v_product.product_name, p_intake_date, v_sequence + (v_index - 1));

    INSERT INTO public.serialized_units (
      product_uuid,
      branch_id,
      unit_barcode,
      status,
      created_at,
      updated_at
    )
    VALUES (
      v_product.uuid,
      v_main_source_branch_id,
      v_barcode,
      'AVAILABLE',
      NOW(),
      NOW()
    )
    ON CONFLICT (unit_barcode) DO NOTHING
    RETURNING id INTO v_serialized_unit_id;

    IF v_serialized_unit_id IS NULL THEN
      RAISE EXCEPTION 'unit_barcode_unique_violation';
    END IF;

    v_generated_barcodes := array_append(v_generated_barcodes, v_barcode);

    INSERT INTO public.stock_transactions (
      uuid,
      product_uuid,
      branch_id,
      barcode,
      branch,
      type,
      quantity,
      user_name,
      date,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      v_product.uuid,
      v_main_source_branch_id,
      v_barcode,
      'Pasong Buaya Main Source',
      'RECEIVE',
      1,
      p_created_by,
      NOW(),
      NOW()
    );
  END LOOP;

  INSERT INTO public.inventory (
    uuid,
    product_uuid,
    branch_id,
    branch,
    quantity,
    last_updated
  )
  VALUES (
    gen_random_uuid(),
    v_product.uuid,
    v_main_source_branch_id,
    'Pasong Buaya Main Source',
    p_quantity,
    NOW()
  )
  ON CONFLICT (product_uuid, branch_id)
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity,
                branch = EXCLUDED.branch,
                last_updated = NOW();

  SELECT quantity INTO v_inventory_qty
  FROM public.inventory
  WHERE product_uuid = v_product.uuid
    AND branch_id = v_main_source_branch_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', TRUE,
    'product_uuid', v_product.uuid,
    'product_name', v_product.product_name,
    'product_barcode', v_product.barcode,
    'inventory_qty', COALESCE(v_inventory_qty, p_quantity),
    'generated_barcodes', to_jsonb(v_generated_barcodes),
    'branch_id', v_main_source_branch_id,
    'intake_date', p_intake_date,
    'created_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.create_main_source_intake_batch(UUID, DATE, INTEGER, TEXT) IS
'Adds new serialized item units for a product/date/quantity at the Main Source branch while preserving legacy ADD- and VX barcode compatibility. Generates new item barcodes in the format XXDDMMYYYY0001 and records stock transactions.';
