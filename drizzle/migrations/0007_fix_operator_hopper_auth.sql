-- Migration: 0007_fix_operator_hopper_auth.sql
-- Description: Expand operator authorization check to include operator invitations and queues with null owner, and strengthen hopper ticket query

-- 1. Update is_queue_operator helper to:
--    a) Check queues.owner_id = auth.uid() OR queues.owner_id IS NULL (allows unassigned/legacy queues)
--    b) Check queue_operators table
--    c) Check legacy operators table
--    d) Check operator_invitations table matching auth.users email
CREATE OR REPLACE FUNCTION public.is_queue_operator(_queue UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  RETURN EXISTS (
    SELECT 1 FROM public.queues WHERE id = _queue AND (owner_id = auth.uid() OR owner_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.queue_operators WHERE queue_id = _queue AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.operators WHERE queue_id = _queue AND id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.operator_invitations
    WHERE queue_id = _queue AND lower(email) = lower(COALESCE(v_user_email, ''))
  );
END;
$$;

-- 2. Update _require_operator to use is_queue_operator
CREATE OR REPLACE FUNCTION public._require_operator(_queue UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_queue_operator(_queue) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
END $$;

-- 3. Update get_operator_hopper_tickets RPC
-- Allows authorized operators to retrieve WAITING and SERVING tickets for a queue
CREATE OR REPLACE FUNCTION public.get_operator_hopper_tickets(p_queue_id UUID)
RETURNS TABLE (
  id UUID,
  ticket_number INT,
  full_name TEXT,
  phone_number TEXT,
  status TEXT,
  strikes INT,
  sort_order NUMERIC,
  serving_operator_id UUID,
  created_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_operator(p_queue_id);

  RETURN QUERY
  SELECT
    t.id,
    t.ticket_number,
    t.full_name,
    t.phone_number,
    t.status,
    t.strikes,
    t.sort_order,
    t.serving_operator_id,
    t.created_at,
    t.served_at
  FROM public.tickets t
  WHERE t.queue_id = p_queue_id
    AND upper(t.status) IN ('WAITING', 'SERVING')
  ORDER BY t.sort_order ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_operator_hopper_tickets(UUID) TO authenticated;
