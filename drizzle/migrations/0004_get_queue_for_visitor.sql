-- Migration: 0004_get_queue_for_visitor.sql
-- Description: RPC for visitor queue metadata query with public access and RLS assurance

-- 1. Ensure RLS on public.queues allows public select
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Queues are public" ON public.queues;
CREATE POLICY "Queues are public" ON public.queues
  FOR SELECT TO anon, authenticated
  USING (true);

GRANT SELECT ON public.queues TO anon, authenticated;

-- 2. Stored Procedure: get_queue_for_visitor
CREATE OR REPLACE FUNCTION public.get_queue_for_visitor(p_queue_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  venue_name TEXT,
  status TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT q.id, q.title, q.venue_name, COALESCE(q.status, 'OPEN') AS status
  FROM public.queues q
  WHERE q.id = p_queue_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_queue_for_visitor(UUID) TO anon, authenticated;
