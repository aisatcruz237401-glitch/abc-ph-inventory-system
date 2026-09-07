-- Phase 2 review-only migration for Main Source intake.
-- This file creates a new, isolated RPC used for TRF batch intake.
-- It does not modify any existing transfer RPCs, does not rewrite legacy flows,
-- and does not execute against the live database in this session.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.transfer_headers (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tracking_code TEXT NOT NULL UNIQUE,
  source_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  destination_branch_id UUID NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transfer_items (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  transfer_id BIGINT NOT NULL REFERENCES public.transfer_headers(id) ON DELETE CASCADE,
  product_uuid UUID NOT NULL REFERENCES public.products(uuid) ON DELETE RESTRICT,
  product_barcode TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  item_order INTEGER NOT NULL CHECK (item_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_items_order_unique UNIQUE (transfer_id, item_order),
  CONSTRAINT transfer_items_product_unique UNIQUE (transfer_id, product_uuid)
);

CREATE TABLE IF NOT EXISTS public.transfer_item_units (
  id BIGSERIAL PRIMARY KEY,
  transfer_item_id BIGINT NOT NULL REFERENCES public.transfer_items(id) ON DELETE CASCADE,
  serialized_unit_id UUID NOT NULL REFERENCES public.serialized_units(id) ON DELETE RESTRICT,
  unit_order INTEGER NOT NULL CHECK (unit_order > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_item_units_order_unique UNIQUE (transfer_item_id, unit_order),
  CONSTRAINT transfer_item_units_serialized_unique UNIQUE (transfer_item_id, serialized_unit_id)
);

CREATE TABLE IF NOT EXISTS public.serialized_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_uuid UUID NOT NULL REFERENCES public.products(uuid) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL,
  unit_barcode TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  lot_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT serialized_units_sequence_unique UNIQUE (product_uuid, branch_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_transfer_headers_tracking_code
  ON public.transfer_headers(tracking_code);

CREATE INDEX IF NOT EXISTS idx_transfer_headers_source_date
  ON public.transfer_headers(source_branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_id
  ON public.transfer_items(transfer_id, item_order);

CREATE INDEX IF NOT EXISTS idx_transfer_item_units_transfer_item
  ON public.transfer_item_units(transfer_item_id, unit_order);

CREATE INDEX IF NOT EXISTS idx_serialized_units_product_branch
  ON public.serialized_units(product_uuid, branch_id, status, sequence_number);

CREATE OR REPLACE FUNCTION public.create_main_source_intake_trf(
  p_main_source_branch_id UUID,
  p_items JSONB,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_product_uuid UUID;
  v_product_barcode TEXT;
  v_product_name TEXT;
  v_quantity INTEGER;
  v_source_branch_name TEXT;
  v_tracking_code TEXT;
  v_transfer_id BIGINT;
  v_transfer_item_id BIGINT;
  v_item_order INTEGER := 0;
  v_sequence_number INTEGER;
  v_serialized_unit_id UUID;
  v_vx_barcode TEXT;
  v_inventory_row RECORD;
  v_result_items JSONB := '[]'::JSONB;
  v_result_units JSONB := '[]'::JSONB;
  v_total_qty INTEGER := 0;
BEGIN
  IF p_main_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'main_source_branch_required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  SELECT name INTO v_source_branch_name
  FROM public.branches
  WHERE id = p_main_source_branch_id
    AND status = 'active'
  LIMIT 1;

  IF v_source_branch_name IS NULL THEN
    RAISE EXCEPTION 'main_source_branch_not_found';
  END IF;

  v_tracking_code := 'TRF-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

  -- Validate inputs before writing any rows.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_uuid := NULLIF((v_item->>'product_uuid')::TEXT, '')::UUID;
    v_quantity := NULLIF((v_item->>'quantity')::TEXT, '')::INTEGER;

    IF v_product_uuid IS NULL THEN
      RAISE EXCEPTION 'product_uuid_required';
    END IF;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000 THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;

    SELECT barcode, product_name
      INTO v_product_barcode, v_product_name
    FROM public.products
    WHERE uuid = v_product_uuid
      AND is_active = TRUE;

    IF v_product_barcode IS NULL THEN
      RAISE EXCEPTION 'product_not_found_or_inactive';
    END IF;

    v_total_qty := v_total_qty + v_quantity;
  END LOOP;

  -- Create the batch header if the table is present.
  INSERT INTO public.transfer_headers (
    tracking_code,
    source_branch_id,
    destination_branch_id,
    status,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    v_tracking_code,
    p_main_source_branch_id,
    p_main_source_branch_id,
    'IN_TRANSIT',
    COALESCE(NULLIF(trim(p_created_by), ''), 'system'),
    NOW(),
    NOW()
  )
  RETURNING id INTO v_transfer_id;

  -- Create product rows for the intake batch.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_order := v_item_order + 1;
    v_product_uuid := NULLIF((v_item->>'product_uuid')::TEXT, '')::UUID;
    v_quantity := NULLIF((v_item->>'quantity')::TEXT, '')::INTEGER;

    SELECT barcode, product_name
      INTO v_product_barcode, v_product_name
    FROM public.products
    WHERE uuid = v_product_uuid
      AND is_active = TRUE;

    INSERT INTO public.transfer_items (
      transfer_id,
      product_uuid,
      product_barcode,
      product_name,
      quantity,
      item_order,
      created_at
    )
    VALUES (
      v_transfer_id,
      v_product_uuid,
      v_product_barcode,
      v_product_name,
      v_quantity,
      v_item_order,
      NOW()
    )
    RETURNING id INTO v_transfer_item_id;

    -- Create serialized units for each item quantity and assign VX barcodes.
    FOR v_sequence_number IN 1..v_quantity
    LOOP
      v_vx_barcode := 'VX-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

      INSERT INTO public.serialized_units (
        product_uuid,
        branch_id,
        sequence_number,
        unit_barcode,
        status,
        lot_number,
        created_at,
        updated_at
      )
      VALUES (
        v_product_uuid,
        p_main_source_branch_id,
        COALESCE(
          (
            SELECT MAX(sequence_number)
            FROM public.serialized_units
            WHERE product_uuid = v_product_uuid
              AND branch_id = p_main_source_branch_id
          ),
          0
        ) + v_sequence_number,
        v_vx_barcode,
        'AVAILABLE',
        NULL,
        NOW(),
        NOW()
      )
      RETURNING id INTO v_serialized_unit_id;

      INSERT INTO public.transfer_item_units (
        transfer_item_id,
        serialized_unit_id,
        unit_order,
        created_at
      )
      VALUES (
        v_transfer_item_id,
        v_serialized_unit_id,
        v_sequence_number,
        NOW()
      );

      v_result_units := v_result_units || jsonb_build_array(
        jsonb_build_object(
          'product_uuid', v_product_uuid,
          'branch_id', p_main_source_branch_id,
          'serialized_unit_id', v_serialized_unit_id,
          'unit_barcode', v_vx_barcode,
          'sequence_number',
            COALESCE(
              (
                SELECT MAX(sequence_number)
                FROM public.serialized_units
                WHERE product_uuid = v_product_uuid
                  AND branch_id = p_main_source_branch_id
              ),
              0
            )
        )
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
      v_product_uuid,
      p_main_source_branch_id,
      v_source_branch_name,
      v_quantity,
      NOW()
    )
    ON CONFLICT (product_uuid, branch_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      branch = EXCLUDED.branch,
      last_updated = NOW();

    v_result_items := v_result_items || jsonb_build_array(
      jsonb_build_object(
        'product_uuid', v_product_uuid,
        'product_name', v_product_name,
        'barcode', v_product_barcode,
        'quantity', v_quantity,
        'tracking_code', v_tracking_code
      )
    );
  END LOOP;

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
  SELECT
    v_product_uuid,
    p_main_source_branch_id,
    v_product_barcode,
    v_source_branch_name,
    'TRANSFER_IN',
    v_quantity,
    COALESCE(NULLIF(trim(p_created_by), ''), 'system'),
    NOW(),
    v_tracking_code
  FROM jsonb_to_recordset(p_items) AS x(product_uuid UUID, quantity INTEGER);

  RETURN jsonb_build_object(
    'success', TRUE,
    'tracking_code', v_tracking_code,
    'status', 'IN_TRANSIT',
    'source_branch_id', p_main_source_branch_id,
    'destination_branch_id', p_main_source_branch_id,
    'created_by', COALESCE(NULLIF(trim(p_created_by), ''), 'system'),
    'item_count', jsonb_array_length(p_items),
    'total_quantity', v_total_qty,
    'items', v_result_items,
    'serialized_units', v_result_units
  );
END;
$$;

COMMENT ON FUNCTION public.create_main_source_intake_trf(UUID, JSONB, TEXT) IS
'Phase 2 Main Source intake RPC. Creates a TRF batch, validates products, creates serialized units with VX barcodes, updates Main Source inventory, and writes incoming stock transactions in one atomic transaction.';
