-- Migration: 0008_operator_mark_ticket_done_and_fix_status.sql
-- Description: Provide mark_ticket_done RPC for single-click operator completion and fix ambiguous queue_id in get_ticket_status

-- 1. Create dedicated mark_ticket_done RPC that can complete tickets directly from WAITING or SERVING
CREATE OR REPLACE FUNCTION public.mark_ticket_done(p_ticket_id UUID)
RETURNS public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ticket public.tickets;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  PERFORM public._require_operator(v_ticket.queue_id);

  UPDATE public.tickets
  SET status = 'COMPLETED',
      serving_operator_id = NULL,
      updated_at = now()
  WHERE id = v_ticket.id
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_ticket_done(UUID) TO authenticated;

-- 2. Grant UPDATE on public.tickets to authenticated (enforced via RLS is_queue_operator)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Operators update queue tickets" ON public.tickets;
  CREATE POLICY "Operators update queue tickets" ON public.tickets
    FOR UPDATE TO authenticated
    USING (public.is_queue_operator(queue_id))
    WITH CHECK (public.is_queue_operator(queue_id));
END $$;

GRANT UPDATE ON public.tickets TO authenticated;

-- 3. Fix ambiguous column reference in get_ticket_status
CREATE OR REPLACE FUNCTION public.get_ticket_status(p_ticket_id UUID)
RETURNS TABLE (
  id UUID,
  queue_id UUID,
  ticket_number INT,
  full_name TEXT,
  status TEXT,
  strikes INT,
  queue_position INT,
  venue_name TEXT,
  title TEXT,
  queue_status TEXT,
  counter_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    t.id,
    t.queue_id,
    t.ticket_number,
    t.full_name,
    t.status,
    t.strikes,
    CASE WHEN t.status = 'WAITING' THEN (
      SELECT count(*)::int + 1
      FROM public.tickets w
      WHERE w.queue_id = t.queue_id
        AND w.status = 'WAITING'
        AND w.sort_order < t.sort_order
    )
    ELSE NULL END AS queue_position,
    COALESCE(q.title, 'Venue') AS venue_name,
    q.title,
    q.status AS queue_status,
    o.counter_name
  FROM public.tickets t
  JOIN public.queues q ON q.id = t.queue_id
  LEFT JOIN public.operators o ON o.id = t.serving_operator_id
  WHERE t.id = p_ticket_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_ticket_status(UUID) TO anon, authenticated;
