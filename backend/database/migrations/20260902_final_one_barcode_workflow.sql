-- Final one-barcode workflow migration
-- Purpose: create the single physical-item serialized barcode flow without modifying legacy product/add-item information.
-- This file is additive only. It does not rewrite live data, existing barcode values, or older migration files.
-- It is intended for safe code review and staged deployment only, never for direct execution in this session.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generates the permanent serialized barcode for a single physical item.
-- Format: [2 letters from product name][DDMMYYYY][0001..9999]
-- Example: AB010920260001
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

-- Calculates the next sequence value safely for a product/branch/date bucket.
-- The final generated barcode is the single permanent barcode for the physical item.
CREATE OR REPLACE FUNCTION public.next_serialized_item_sequence(
  p_product_uuid UUID,
  p_branch_id UUID,
  p_intake_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  IF p_product_uuid IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_required';
  END IF;

  IF p_intake_date IS NULL THEN
    RAISE EXCEPTION 'date_required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_product_uuid::TEXT),
    hashtext(p_branch_id::TEXT),
    hashtext(to_char(p_intake_date, 'YYYY-MM-DD'))
  );

  SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO v_next
  FROM public.serialized_units
  WHERE product_uuid = p_product_uuid
    AND branch_id = p_branch_id
    AND created_at >= p_intake_date::TIMESTAMPTZ
    AND created_at < (p_intake_date + INTERVAL '1 day')::TIMESTAMPTZ;

  RETURN v_next;
END;
$$;

-- Creates one serialized item row per physical unit.
-- This function is atomic: if any item fails, the whole intake fails and no partial row remains.
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
  v_next_sequence INTEGER;
  v_generated_barcodes TEXT[] := ARRAY[]::TEXT[];
  v_counter INTEGER;
  v_barcode TEXT;
  v_serialized_unit_id UUID;
  v_inventory_qty INTEGER;
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

  SELECT p.id, p.uuid, p.product_name, p.barcode, p.add_item_barcode, p.is_active
    INTO v_product
  FROM public.products p
  WHERE p.uuid = p_product_uuid
  LIMIT 1;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'product_not_found';
  END IF;

  IF v_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'product_inactive';
  END IF;

  IF trim(COALESCE(v_product.product_name, '')) = '' THEN
    RAISE EXCEPTION 'product_name_required';
  END IF;

  SELECT id INTO v_main_source_branch_id
  FROM public.branches
  WHERE LOWER(TRIM(branch_name)) = LOWER(TRIM('Pasong Buaya Main Source'))
  LIMIT 1;

  IF v_main_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'main_source_not_found';
  END IF;

  v_next_sequence := public.next_serialized_item_sequence(p_product_uuid, v_main_source_branch_id, p_intake_date);

  FOR v_counter IN 1..p_quantity LOOP
    v_barcode := public.generate_serialized_item_barcode(
      v_product.product_name,
      p_intake_date,
      v_next_sequence + (v_counter - 1)
    );

    INSERT INTO public.serialized_units (
      product_uuid,
      branch_id,
      sequence_number,
      unit_barcode,
      status,
      created_at,
      updated_at
    )
    VALUES (
      v_product.uuid,
      v_main_source_branch_id,
      v_next_sequence + (v_counter - 1),
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
      product_uuid,
      branch_id,
      barcode,
      branch,
      type,
      quantity,
      user_name,
      date,
      tracking_code
    )
    VALUES (
      v_product.uuid,
      v_main_source_branch_id,
      v_barcode,
      'Pasong Buaya Main Source',
      'RECEIVE',
      1,
      p_created_by,
      p_intake_date,
      NULL
    );
  END LOOP;

  INSERT INTO public.inventory (
    product_uuid,
    branch_id,
    branch,
    quantity,
    last_updated
  )
  VALUES (
    v_product.uuid,
    v_main_source_branch_id,
    'Pasong Buaya Main Source',
    p_quantity,
    NOW()
  )
  ON CONFLICT (product_uuid, branch_id)
  DO UPDATE SET
    quantity = public.inventory.quantity + EXCLUDED.quantity,
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
'Creates one permanent serialized item barcode per physical item at Pasong Buaya Main Source. Each barcode remains fixed through the full lifecycle and is stored in serialized_units.unit_barcode. Product barcode and add_item_barcode remain separate catalog metadata.';

-- NOTE:
-- The final workflow does not create a second operational barcode for the same item.
-- product.barcode remains the product/catalog barcode.
-- products.add_item_barcode remains legacy metadata for compatibility only.
-- serialized_units.unit_barcode is the single physical-item barcode used for intake, transfer, receive, and consume.
