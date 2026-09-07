-- Review-only migration. Do not execute automatically.
-- Multi-product transfers using the existing delivery_transactions architecture.
-- This does not modify or replace create_transfer, receive_transfer, or deliver_stock.

CREATE OR REPLACE FUNCTION public.create_multi_product_delivery_transfer(
  p_from_branch_id UUID,
  p_to_branch_id UUID,
  p_items JSONB,
  p_user TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_product_uuid UUID;
  v_barcode TEXT;
  v_product_name TEXT;
  v_source_name TEXT;
  v_destination_name TEXT;
  v_quantity INTEGER;
  v_source_quantity INTEGER;
  v_tracking_code TEXT;
  v_items JSONB := '[]'::JSONB;
BEGIN
  IF p_from_branch_id IS NULL OR p_to_branch_id IS NULL THEN
    RAISE EXCEPTION 'source_and_destination_required';
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'source_and_destination_must_differ';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  SELECT branch_name INTO v_source_name
  FROM public.branches
  WHERE id = p_from_branch_id;

  SELECT branch_name INTO v_destination_name
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_source_name IS NULL THEN
    RAISE EXCEPTION 'source_branch_not_found';
  END IF;

  IF v_destination_name IS NULL THEN
    RAISE EXCEPTION 'destination_branch_not_found';
  END IF;

  -- One manifest code is shared by every product row in this transfer.
  v_tracking_code := 'TRF-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

  -- Validate and lock every source inventory row before changing anything.
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
    ORDER BY (value->>'product_uuid')::UUID
  LOOP
    v_product_uuid := (v_item->>'product_uuid')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    IF v_product_uuid IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_transfer_item';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) other
      WHERE other->>'product_uuid' = v_product_uuid::TEXT
      GROUP BY other->>'product_uuid'
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'duplicate_products_not_allowed';
    END IF;

    SELECT barcode, product_name
    INTO v_barcode, v_product_name
    FROM public.products
    WHERE uuid = v_product_uuid
      AND is_active = TRUE;

    IF v_barcode IS NULL THEN
      RAISE EXCEPTION 'product_not_found_or_inactive';
    END IF;

    SELECT quantity
    INTO v_source_quantity
    FROM public.inventory
    WHERE product_uuid = v_product_uuid
      AND branch_id = p_from_branch_id
    FOR UPDATE;

    IF v_source_quantity IS NULL OR v_source_quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
  END LOOP;

  -- Each item is an independent delivery row under one shared manifest code.
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    v_product_uuid := (v_item->>'product_uuid')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    SELECT barcode, product_name
    INTO v_barcode, v_product_name
    FROM public.products
    WHERE uuid = v_product_uuid
      AND is_active = TRUE;

    UPDATE public.inventory
    SET quantity = quantity - v_quantity,
        last_updated = NOW()
    WHERE product_uuid = v_product_uuid
      AND branch_id = p_from_branch_id
      AND quantity >= v_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;

    INSERT INTO public.delivery_transactions (
      tracking_code,
      from_branch_id,
      to_branch_id,
      product_uuid,
      barcode,
      quantity,
      status,
      created_by,
      created_at
    )
    VALUES (
      v_tracking_code,
      p_from_branch_id,
      p_to_branch_id,
      v_product_uuid,
      v_barcode,
      v_quantity,
      'IN_TRANSIT',
      COALESCE(NULLIF(trim(p_user), ''), 'system'),
      NOW()
    );

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
      v_product_uuid,
      p_from_branch_id,
      v_barcode,
      v_source_name,
      'TRANSFER_OUT',
      v_quantity,
      COALESCE(NULLIF(trim(p_user), ''), 'system'),
      NOW(),
      v_tracking_code
    );

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_uuid', v_product_uuid,
      'product_name', v_product_name,
      'barcode', v_barcode,
      'quantity', v_quantity
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'tracking_code', v_tracking_code,
    'status', 'IN_TRANSIT',
    'source_branch_id', p_from_branch_id,
    'destination_branch_id', p_to_branch_id,
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_multi_product_delivery_transfer(
  p_tracking_code TEXT,
  p_received_by TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_destination_name TEXT;
  v_items JSONB := '[]'::JSONB;
  v_rows INTEGER := 0;
BEGIN
  IF trim(COALESCE(p_tracking_code, '')) = '' THEN
    RAISE EXCEPTION 'tracking_code_required';
  END IF;

  SELECT COUNT(*) INTO v_rows
  FROM public.delivery_transactions
  WHERE tracking_code = trim(p_tracking_code);

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'transfer_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.delivery_transactions
    WHERE tracking_code = trim(p_tracking_code)
      AND status <> 'IN_TRANSIT'
  ) THEN
    RAISE EXCEPTION 'transfer_not_in_transit';
  END IF;

  -- Lock all rows before changing any destination inventory.
  FOR v_row IN
    SELECT *
    FROM public.delivery_transactions
    WHERE tracking_code = trim(p_tracking_code)
    ORDER BY product_uuid, id
    FOR UPDATE
  LOOP
    SELECT branch_name INTO v_destination_name
    FROM public.branches
    WHERE id = v_row.to_branch_id;

    IF v_destination_name IS NULL THEN
      RAISE EXCEPTION 'destination_branch_not_found';
    END IF;

    INSERT INTO public.inventory (
      product_uuid,
      branch_id,
      branch,
      quantity,
      last_updated
    )
    VALUES (
      v_row.product_uuid,
      v_row.to_branch_id,
      v_destination_name,
      v_row.quantity,
      NOW()
    )
    ON CONFLICT (product_uuid, branch_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      last_updated = NOW();

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
      v_row.product_uuid,
      v_row.to_branch_id,
      v_row.barcode,
      v_destination_name,
      'TRANSFER_IN',
      v_row.quantity,
      COALESCE(NULLIF(trim(p_received_by), ''), 'system'),
      NOW(),
      v_row.tracking_code
    );

    UPDATE public.delivery_transactions
    SET status = 'RECEIVED',
        received_at = NOW(),
        received_by = COALESCE(NULLIF(trim(p_received_by), ''), 'system')
    WHERE id = v_row.id
      AND status = 'IN_TRANSIT';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'transfer_state_transition_failed';
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_uuid', v_row.product_uuid,
      'barcode', v_row.barcode,
      'quantity', v_row.quantity
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'tracking_code', trim(p_tracking_code),
    'status', 'RECEIVED',
    'items', v_items
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_multi_product_delivery_transfer(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_multi_product_delivery_transfer(UUID, UUID, JSONB, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.receive_multi_product_delivery_transfer(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_multi_product_delivery_transfer(TEXT, TEXT) TO service_role;
