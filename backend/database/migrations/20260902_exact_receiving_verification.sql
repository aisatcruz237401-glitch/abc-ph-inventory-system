-- Exact serialized-item receiving verification contract.
-- This migration is intentionally additive and review-only for the live Supabase environment.
-- It is designed to support the exact-unit receiving workflow without silently altering the
-- running schema. It must be reviewed and applied to Supabase before the live flow is considered complete.

CREATE OR REPLACE FUNCTION public.get_transfer_expected_unit_barcodes(
  p_tracking_code TEXT
)
RETURNS TABLE (
  transfer_id BIGINT,
  transfer_item_id BIGINT,
  product_uuid UUID,
  serialized_unit_id UUID,
  unit_barcode TEXT,
  unit_order INTEGER,
  branch_id UUID,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    th.id AS transfer_id,
    ti.id AS transfer_item_id,
    ti.product_uuid,
    su.id AS serialized_unit_id,
    su.unit_barcode,
    tiu.unit_order,
    su.branch_id,
    su.status
  FROM public.transfer_headers th
  JOIN public.transfer_items ti
    ON ti.transfer_id = th.id
  JOIN public.transfer_item_units tiu
    ON tiu.transfer_item_id = ti.id
  JOIN public.serialized_units su
    ON su.id = tiu.serialized_unit_id
  WHERE th.tracking_code = trim(COALESCE(p_tracking_code, ''))
    AND th.status = 'IN_TRANSIT'
    AND su.status = 'IN_TRANSIT'
  ORDER BY ti.item_order, tiu.unit_order;
END;
$$;

COMMENT ON FUNCTION public.get_transfer_expected_unit_barcodes(TEXT) IS
'Returns the exact serialized unit barcode set expected for a TRF batch during receiving verification.';

CREATE OR REPLACE FUNCTION public.validate_transfer_scan(
  p_tracking_code TEXT,
  p_scanned_barcodes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected JSONB := '[]'::JSONB;
  v_scanned JSONB := '[]'::JSONB;
  v_wrong JSONB := '[]'::JSONB;
  v_missing JSONB := '[]'::JSONB;
  v_duplicate JSONB := '[]'::JSONB;
  v_unit_barcode TEXT;
  v_expected_set TEXT[];
  v_scanned_clean TEXT[];
  v_duplicate_count INTEGER;
BEGIN
  IF trim(COALESCE(p_tracking_code, '')) = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'tracking_code_required');
  END IF;

  SELECT array_agg(DISTINCT unit_barcode ORDER BY unit_barcode)
    INTO v_expected_set
  FROM public.get_transfer_expected_unit_barcodes(p_tracking_code);

  IF v_expected_set IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'transfer_has_no_expected_units');
  END IF;

  v_expected := to_jsonb(v_expected_set);

  IF p_scanned_barcodes IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'no_scanned_units',
      'expected_items', v_expected,
      'missing_items', v_expected
    );
  END IF;

  SELECT array_agg(DISTINCT value ORDER BY value)
    INTO v_scanned_clean
  FROM unnest(p_scanned_barcodes) AS value
  WHERE trim(COALESCE(value, '')) <> '';

  v_scanned := to_jsonb(COALESCE(v_scanned_clean, ARRAY[]::TEXT[]));

  SELECT array_agg(value ORDER BY value)
    INTO v_duplicate_count
  FROM (
    SELECT value
    FROM unnest(COALESCE(v_scanned_clean, ARRAY[]::TEXT[])) AS value
    GROUP BY value
    HAVING COUNT(*) > 1
  ) t;

  IF v_duplicate_count IS NOT NULL THEN
    v_duplicate := to_jsonb(v_duplicate_count);
  END IF;

  SELECT array_agg(value ORDER BY value)
    INTO v_wrong
  FROM (
    SELECT DISTINCT value
    FROM unnest(COALESCE(v_scanned_clean, ARRAY[]::TEXT[])) AS value
    WHERE value IS NOT NULL
      AND NOT (value = ANY (v_expected_set))
  ) t;

  SELECT array_agg(value ORDER BY value)
    INTO v_missing
  FROM (
    SELECT DISTINCT value
    FROM unnest(COALESCE(v_expected_set, ARRAY[]::TEXT[])) AS value
    WHERE value IS NOT NULL
      AND NOT (value = ANY (COALESCE(v_scanned_clean, ARRAY[]::TEXT[])))
  ) t;

  RETURN jsonb_build_object(
    'success',
    (COALESCE(array_length(v_wrong, 1), 0) = 0 AND COALESCE(array_length(v_duplicate, 1), 0) = 0 AND COALESCE(array_length(v_missing, 1), 0) = 0),
    'message',
      CASE
        WHEN COALESCE(array_length(v_wrong, 1), 0) > 0 THEN 'WRONG ITEM'
        WHEN COALESCE(array_length(v_duplicate, 1), 0) > 0 THEN 'DUPLICATE'
        WHEN COALESCE(array_length(v_missing, 1), 0) > 0 THEN 'MISSING ITEMS'
        ELSE 'OK'
      END,
    'expected_items', v_expected,
    'scanned_items', v_scanned,
    'wrong_items', COALESCE(v_wrong, '[]'::JSONB),
    'duplicate_items', COALESCE(v_duplicate, '[]'::JSONB),
    'missing_items', COALESCE(v_missing, '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public.validate_transfer_scan(TEXT, TEXT[]) IS
'Checks a scanned list against the exact expected serialized unit barcodes for a TRF, returning wrong-item, duplicate, and missing-item details.';
