CREATE OR REPLACE FUNCTION public.create_assigned_delivery_reservation(
  p_source_branch_id UUID,
  p_destination_branch_id UUID,
  p_items JSONB,
  p_created_by TEXT DEFAULT 'system',
  p_assigned_delivery_personnel_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer_id BIGINT;
  v_transfer_item_id BIGINT;
  v_tracking_code TEXT;
  v_item JSONB;
  v_item_order INTEGER;
  v_product_uuid UUID;
  v_product_name TEXT;
  v_product_barcode TEXT;
  v_unit TEXT;
  v_source_branch_name TEXT;
  v_destination_branch_name TEXT;
  v_quantity INTEGER;
  v_unit_id UUID;
  v_unit_order INTEGER;
  v_result_items JSONB := '[]'::JSONB;
  v_unit_ids UUID[] := ARRAY[]::UUID[];
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

  IF p_assigned_delivery_personnel_id IS NULL
     OR p_assigned_delivery_personnel_id <= 0 THEN
    RAISE EXCEPTION 'assigned_delivery_personnel_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_assigned_delivery_personnel_id
      AND role = 'delivery_personnel'
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'assigned_delivery_personnel_not_active';
  END IF;

  -- Lock each unit before checking active reservations. The existing partial
  -- unique index on transfer_item_units is the final concurrency guard.
  FOR v_item, v_item_order IN
    SELECT value, ordinality::INTEGER
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    v_product_uuid := (v_item->>'product_uuid')::UUID;

    IF v_product_uuid IS NULL THEN
      RAISE EXCEPTION 'product_uuid_required';
    END IF;

    IF jsonb_typeof(v_item->'serialized_unit_ids') <> 'array'
       OR jsonb_array_length(v_item->'serialized_unit_ids') = 0 THEN
      RAISE EXCEPTION 'serialized_unit_ids_required';
    END IF;

    v_quantity := jsonb_array_length(v_item->'serialized_unit_ids');
    IF v_quantity > 1000 THEN
      RAISE EXCEPTION 'too_many_serialized_units';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE uuid = v_product_uuid
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'product_not_found_or_inactive';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_item->'serialized_unit_ids') unit_value
      GROUP BY unit_value
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'duplicate_serialized_units_not_allowed';
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

      IF EXISTS (
        SELECT 1
        FROM public.transfer_item_units tiu
        JOIN public.transfer_items ti ON ti.id = tiu.transfer_item_id
        JOIN public.transfer_headers th ON th.id = ti.transfer_id
        WHERE tiu.serialized_unit_id = v_unit_id
          AND tiu.is_active = TRUE
          AND th.status IN ('PENDING_PICKUP', 'IN_TRANSIT', 'PARTIALLY_RECEIVED')
      ) THEN
        RAISE EXCEPTION 'serialized_unit_already_reserved_for_active_delivery';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.serialized_units
        WHERE id = v_unit_id
          AND product_uuid = v_product_uuid
          AND branch_id = p_source_branch_id
          AND status = 'AVAILABLE'
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM public.serialized_units
          WHERE id = v_unit_id
            AND product_uuid <> v_product_uuid
        ) THEN
          RAISE EXCEPTION 'serialized_unit_product_mismatch';
        ELSIF EXISTS (
          SELECT 1
          FROM public.serialized_units
          WHERE id = v_unit_id
            AND branch_id <> p_source_branch_id
        ) THEN
          RAISE EXCEPTION 'serialized_unit_source_branch_mismatch';
        ELSE
          RAISE EXCEPTION 'serialized_unit_not_available';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  v_tracking_code := 'TRF-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));

  INSERT INTO public.transfer_headers (
    tracking_code,
    source_branch_id,
    destination_branch_id,
    status,
    created_by,
    assigned_delivery_personnel_id
  )
  VALUES (
    v_tracking_code,
    p_source_branch_id,
    p_destination_branch_id,
    'PENDING_PICKUP',
    COALESCE(NULLIF(trim(p_created_by), ''), 'system'),
    p_assigned_delivery_personnel_id
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
    RETURNING id INTO v_transfer_item_id;

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
        v_transfer_item_id,
        v_unit_id,
        v_unit_order,
        TRUE
      );
    END LOOP;

    v_result_items := v_result_items || jsonb_build_array(
      jsonb_build_object(
        'product_uuid', v_product_uuid,
        'product_name', v_product_name,
        'unit', v_unit,
        'barcode', v_product_barcode,
        'quantity', v_quantity,
        'item_order', v_item_order,
        'serialized_unit_ids', v_item->'serialized_unit_ids'
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
    'status', 'PENDING_PICKUP',
    'assigned_delivery_personnel_id', p_assigned_delivery_personnel_id,
    'items', v_result_items
  );
END;
$$;
