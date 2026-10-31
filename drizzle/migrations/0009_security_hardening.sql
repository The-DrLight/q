-- Migration: 0009_security_hardening.sql
-- Description: Sanitize join_queue inputs (strip HTML/tags), restrict desk RPC execution, and reinforce security

CREATE OR REPLACE FUNCTION public.join_queue(
  p_queue_id UUID,
  p_full_name TEXT,
  p_phone_number TEXT,
  p_client_uuid TEXT,
  p_push_subscription JSONB DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing UUID;
  v_qstatus TEXT;
  v_nextnum INT;
  v_nextsort NUMERIC;
  v_newid UUID;
  v_sanitized_name TEXT;
  v_sanitized_phone TEXT;
BEGIN
  -- Strip HTML tags and control characters
  v_sanitized_name := regexp_replace(COALESCE(p_full_name, ''), '<[^>]*>', '', 'g');
  v_sanitized_name := trim(v_sanitized_name);

  v_sanitized_phone := regexp_replace(COALESCE(p_phone_number, ''), '<[^>]*>', '', 'g');
  v_sanitized_phone := trim(v_sanitized_phone);

  IF length(v_sanitized_name) = 0 OR length(v_sanitized_name) > 80 THEN
    RAISE EXCEPTION 'Invalid name: must be 1-80 characters without HTML tags';
  END IF;

  IF length(coalesce(p_client_uuid, '')) < 8 OR length(p_client_uuid) > 64 THEN
    RAISE EXCEPTION 'Invalid client identifier';
  END IF;

  IF length(v_sanitized_phone) > 30 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  SELECT status INTO v_qstatus FROM public.queues WHERE id = p_queue_id FOR UPDATE;
  IF v_qstatus IS NULL THEN
    RAISE EXCEPTION 'Queue not found';
  END IF;

  -- Block if already holding an active ticket globally across any queue
  SELECT id INTO v_existing FROM public.tickets
  WHERE client_uuid = p_client_uuid AND status IN ('WAITING', 'SERVING')
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_qstatus <> 'OPEN' THEN
    RAISE EXCEPTION 'Queue is not accepting new entries';
  END IF;

  SELECT COALESCE(MAX(ticket_number), 0) + 1, COALESCE(MAX(sort_order), 0) + 1.0
  INTO v_nextnum, v_nextsort
  FROM public.tickets
  WHERE queue_id = p_queue_id;

  INSERT INTO public.tickets (
    queue_id,
    ticket_number,
    full_name,
    phone_number,
    client_uuid,
    sort_order,
    push_subscription
  )
  VALUES (
    p_queue_id,
    v_nextnum,
    v_sanitized_name,
    NULLIF(v_sanitized_phone, ''),
    p_client_uuid,
    v_nextsort,
    p_push_subscription
  )
  RETURNING id INTO v_newid;

  RETURN v_newid;
END $$;

GRANT EXECUTE ON FUNCTION public.join_queue(UUID, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_ticket_done(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_operator_hopper_tickets(UUID) FROM anon;
