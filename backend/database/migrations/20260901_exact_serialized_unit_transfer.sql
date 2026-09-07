-- Replace quantity-based multi-product selection with exact serialized-unit selection.
-- Existing tables and the RPC signature are preserved for receiving compatibility.

CREATE OR REPLACE FUNCTION public.create_multi_product_transfer(
  p_source_branch_id UUID,
  p_destination_branch_id UUID,
  p_items JSONB,
  p_created_by TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id BIGINT;
  v_item_id BIGINT;
  v_tracking_code TEXT;
  v_item JSONB;
  v_item_order INTEGER;
  v_product_uuid UUID;
  v_unit_id UUID;
  v_unit_order INTEGER;
  v_quantity INTEGER;
  v_product_barcode TEXT;
  v_product_name TEXT;
  v_unit_barcode TEXT;
  v_unit TEXT;
  v_source_branch_name TEXT;
  v_destination_branch_name TEXT;
  v_inventory_quantity INTEGER;
  v_update_rows INTEGER;
  v_units JSONB;
  v_unit_ids UUID[] := ARRAY[]::UUID[];
  v_result_items JSONB := '[]'::JSONB;
BEGIN
  IF p_source_branch_id IS NULL OR p_destination_branch_id IS NULL THEN
    RAISE EXCEPTION 'source_and_destination_required';
  END IF;

  IF p_source_branch_id = p_destination_branch_id THEN
    RAISE EXCEPTION 'source_and_destination_must_differ';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  SELECT branch_name INTO v_source_branch_name
  FROM public.branches
  WHERE id = p_source_branch_id;

  IF v_source_branch_name IS NULL THEN
    RAISE EXCEPTION 'source_branch_not_found';
  END IF;

  SELECT branch_name INTO v_destination_branch_name
  FROM public.branches
  WHERE id = p_destination_branch_id;

  IF v_destination_branch_name IS NULL THEN
    RAISE EXCEPTION 'destination_branch_not_found';
  END IF;

  -- Validate and lock every requested unit before creating any transfer rows.
  -- PostgreSQL rolls back the whole function transaction if any validation fails.
  FOR v_item, v_item_order IN
    SELECT value, ordinality::INTEGER
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    v_product_uuid := (v_item->>'product_uuid')::UUID;

    IF jsonb_typeof(v_item->'serialized_unit_ids') <> 'array'
       OR jsonb_array_length(v_item->'serialized_unit_ids') = 0 THEN
      RAISE EXCEPTION 'serialized_unit_ids_required';
    END IF;

    v_quantity := jsonb_array_length(v_item->'serialized_unit_ids');
    IF v_quantity > 1000 THEN
      RAISE EXCEPTION 'too_many_serialized_units';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_item->'serialized_unit_ids') unit_value
      GROUP BY unit_value
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'duplicate_serialized_units_not_allowed';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE uuid = v_product_uuid
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'product_not_found_or_inactive';
    END IF;

    SELECT quantity INTO v_inventory_quantity
    FROM public.inventory
    WHERE product_uuid = v_product_uuid
      AND branch_id = p_source_branch_id
    FOR UPDATE;

    IF v_inventory_quantity IS NULL OR v_inventory_quantity < v_quantity THEN
      RAISE EXCEPTION 'insufficient_aggregate_stock';
    END IF;

    FOR v_unit_id, v_unit_order IN
      SELECT value::UUID, ordinality::INTEGER
      FROM jsonb_array_elements_text(v_item->'serialized_unit_ids') WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      IF v_unit_id = ANY(v_unit_ids) THEN
        RAISE EXCEPTION 'duplicate_serialized_units_not_allowed';
      END IF;
      v_unit_ids := array_append(v_unit_ids, v_unit_id);

      PERFORM 1
      FROM public.serialized_units
      WHERE id = v_unit_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'serialized_unit_not_found';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.serialized_units
        WHERE id = v_unit_id
          AND product_uuid = v_product_uuid
          AND branch_id = p_source_branch_id
          AND status = 'AVAILABLE'
      ) THEN
        IF EXISTS (SELECT 1 FROM public.serialized_units WHERE id = v_unit_id AND product_uuid <> v_product_uuid) THEN
          RAISE EXCEPTION 'serialized_unit_product_mismatch';
        ELSIF EXISTS (SELECT 1 FROM public.serialized_units WHERE id = v_unit_id AND branch_id <> p_source_branch_id) THEN
          RAISE EXCEPTION 'serialized_unit_source_branch_mismatch';
        ELSE
          RAISE EXCEPTION 'serialized_unit_not_available';
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.transfer_item_units tiu
        JOIN public.transfer_items ti ON ti.id = tiu.transfer_item_id
        JOIN public.transfer_headers th ON th.id = ti.transfer_id
        WHERE tiu.serialized_unit_id = v_unit_id
          AND tiu.is_active = TRUE
          AND th.status = 'IN_TRANSIT'
      ) THEN
        RAISE EXCEPTION 'serialized_unit_already_in_active_transfer';
      END IF;
    END LOOP;
  END LOOP;

  v_tracking_code := 'TRF-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

  INSERT INTO public.transfer_headers (
    tracking_code,
    source_branch_id,
    destination_branch_id,
    status,
    created_by
  )
  VALUES (
    v_tracking_code,
    p_source_branch_id,
    p_destination_branch_id,
    'IN_TRANSIT',
    COALESCE(NULLIF(trim(p_created_by), ''), 'system')
  )
  RETURNING id INTO v_transfer_id;

  FOR v_item, v_item_order IN
    SELECT value, ordinality::INTEGER
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    v_product_uuid := (v_item->>'product_uuid')::UUID;
    v_quantity := jsonb_array_length(v_item->'serialized_unit_ids');

    SELECT product_name, barcode, unit
    INTO v_product_name, v_product_barcode, v_unit
    FROM public.products
    WHERE uuid = v_product_uuid
      AND is_active = TRUE;

    INSERT INTO public.transfer_items (
      transfer_id,
      product_uuid,
      barcode,
      quantity,
      item_order
    )
    VALUES (
      v_transfer_id,
      v_product_uuid,
      v_product_barcode,
      v_quantity,
      v_item_order
    )
    RETURNING id INTO v_item_id;

    v_units := '[]'::JSONB;
    v_unit_order := 0;

    FOR v_unit_id, v_unit_order IN
      SELECT value::UUID, ordinality::INTEGER
      FROM jsonb_array_elements_text(v_item->'serialized_unit_ids') WITH ORDINALITY
      ORDER BY ordinality
    LOOP
      INSERT INTO public.transfer_item_units (
        transfer_item_id,
        serialized_unit_id,
        unit_order,
        is_active
      )
      VALUES (
        v_item_id,
        v_unit_id,
        v_unit_order,
        TRUE
      );

      SELECT unit_barcode INTO v_unit_barcode
      FROM public.serialized_units
      WHERE id = v_unit_id;
      v_units := v_units || jsonb_build_array(v_unit_barcode);
    END LOOP;

    UPDATE public.serialized_units
    SET status = 'IN_TRANSIT',
        updated_at = NOW()
    WHERE id IN (
      SELECT value::UUID
      FROM jsonb_array_elements_text(v_item->'serialized_unit_ids')
    )
      AND product_uuid = v_product_uuid
      AND branch_id = p_source_branch_id
      AND status = 'AVAILABLE';

    GET DIAGNOSTICS v_update_rows = ROW_COUNT;
    IF v_update_rows <> v_quantity THEN
      RAISE EXCEPTION 'serialized_unit_state_transition_failed';
    END IF;

    UPDATE public.inventory
    SET quantity = quantity - v_quantity,
        last_updated = NOW()
    WHERE product_uuid = v_product_uuid
      AND branch_id = p_source_branch_id;

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
      p_source_branch_id,
      v_product_barcode,
      v_source_branch_name,
      'TRANSFER_OUT',
      v_quantity,
      COALESCE(NULLIF(trim(p_created_by), ''), 'system'),
      NOW(),
      v_tracking_code
    );

    v_result_items := v_result_items || jsonb_build_array(
      jsonb_build_object(
        'product_uuid', v_product_uuid,
        'product_name', v_product_name,
        'unit', v_unit,
        'barcode', v_product_barcode,
        'quantity', v_quantity,
        'item_order', v_item_order,
        'serialized_unit_ids', v_item->'serialized_unit_ids',
        'unit_barcodes', v_units
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'tracking_code', v_tracking_code,
    'source_branch_id', p_source_branch_id,
    'source_branch', v_source_branch_name,
    'destination_branch_id', p_destination_branch_id,
    'destination_branch', v_destination_branch_name,
    'status', 'IN_TRANSIT',
    'items', v_result_items
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_multi_product_transfer(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_multi_product_transfer(UUID, UUID, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.create_multi_product_transfer(UUID, UUID, JSONB, TEXT) IS
'Atomic exact serialized-unit transfer. p_items contains product_uuid and serialized_unit_ids; one TRF header links every requested unit through transfer_item_units.';
