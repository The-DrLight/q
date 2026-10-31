-- Migration: 0005_fix_ticket_rls_and_get_ticket_status.sql
-- Description: Ensure anonymous users can read their ticket and RPC get_ticket_status is accessible to anon

-- 1. Grant EXECUTE on get_ticket_status and join_queue to anon, authenticated
GRANT EXECUTE ON FUNCTION public.get_ticket_status(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(UUID, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- 2. Allow anonymous users to select from public.tickets (e.g. for direct select fallback)
-- Since tickets contain ticket_number, full_name, status, etc., we allow SELECT on tickets for anon and authenticated
DROP POLICY IF EXISTS "Public can read tickets" ON public.tickets;
CREATE POLICY "Public can read tickets" ON public.tickets
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.tickets TO anon, authenticated;
