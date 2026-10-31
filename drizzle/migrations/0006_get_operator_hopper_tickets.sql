-- Migration: 0006_get_operator_hopper_tickets.sql
-- Description: RPC for operators to load hopper tickets reliably, bypassing restrictive client RLS

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
    AND t.status IN ('WAITING', 'SERVING', 'waiting', 'serving')
  ORDER BY t.sort_order ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_operator_hopper_tickets(UUID) TO authenticated;
