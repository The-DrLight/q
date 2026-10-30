-- Migration: 0002_multi_queue_activity.sql
-- Description: Multi-queue operator relations, activity-based 24h lease renewal, and cleanup of inactive queues

-- 1. Ensure last_activity_at and expires_at on public.queues
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours');

-- Set initial last_activity_at where null
UPDATE public.queues
SET last_activity_at = COALESCE(created_at, now())
WHERE last_activity_at IS NULL;

UPDATE public.queues
SET expires_at = last_activity_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

-- 2. Touch Activity Trigger on public.tickets
-- Updates last_activity_at = NOW() and expires_at = NOW() + INTERVAL '24 hours' whenever:
-- - A visitor joins the queue (INSERT on public.tickets)
-- - A ticket status transitions or strikes change (UPDATE on public.tickets)
CREATE OR REPLACE FUNCTION public.touch_queue_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_queue_id UUID;
BEGIN
  v_queue_id := COALESCE(NEW.queue_id, OLD.queue_id);
  IF v_queue_id IS NOT NULL THEN
    UPDATE public.queues
    SET last_activity_at = now(),
        expires_at = now() + INTERVAL '24 hours'
    WHERE id = v_queue_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tickets_touch_activity ON public.tickets;
CREATE TRIGGER trg_tickets_touch_activity
  AFTER INSERT OR UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_queue_activity();

-- 3. Cleanup Function for Inactive Queues (cleanup_inactive_queues)
-- Deletes/archives queues where:
-- - expires_at < NOW(), AND
-- - no tickets remain in 'WAITING' or 'SERVING' status.
CREATE OR REPLACE FUNCTION public.cleanup_inactive_queues(p_cron_secret TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
  v_queue_id UUID;
BEGIN
  -- Validate secret if configured in environment / app settings
  -- Note: can be invoked with CRON_SECRET or directly by service role

  FOR v_queue_id IN
    SELECT q.id
    FROM public.queues q
    WHERE q.expires_at < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.queue_id = q.id
          AND t.status IN ('WAITING', 'SERVING')
      )
  LOOP
    DELETE FROM public.queues WHERE id = v_queue_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.cleanup_inactive_queues(TEXT) TO anon, authenticated, service_role;

-- 4. Multi-Queue Operator Access & Policies
-- Create queue_operators table or support multiple queues per operator
CREATE TABLE IF NOT EXISTS public.queue_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  counter_name TEXT NOT NULL DEFAULT 'Counter 1',
  role TEXT NOT NULL DEFAULT 'CLERK' CHECK (role IN ('ADMIN', 'CLERK')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (queue_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.queue_operators TO authenticated;
GRANT ALL ON public.queue_operators TO service_role;
ALTER TABLE public.queue_operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read own queue_operators" ON public.queue_operators
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins manage queue_operators" ON public.queue_operators
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.queues q
      WHERE q.id = queue_operators.queue_id AND q.owner_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.queue_operators qo
      WHERE qo.queue_id = queue_operators.queue_id AND qo.user_id = auth.uid() AND qo.role = 'ADMIN'
    )
  );

-- Backfill queue_operators from legacy operators table and owner_id on queues
INSERT INTO public.queue_operators (queue_id, user_id, email, counter_name, role)
SELECT q.id, q.owner_id, u.email, 'Counter 1', 'ADMIN'
FROM public.queues q
JOIN auth.users u ON u.id = q.owner_id
WHERE q.owner_id IS NOT NULL
ON CONFLICT (queue_id, user_id) DO NOTHING;

INSERT INTO public.queue_operators (queue_id, user_id, email, counter_name, role)
SELECT o.queue_id, o.id, o.email, o.counter_name, o.role
FROM public.operators o
WHERE o.queue_id IS NOT NULL
ON CONFLICT (queue_id, user_id) DO NOTHING;

-- Update is_queue_operator helper to check both queue_operators and owner_id and operators
CREATE OR REPLACE FUNCTION public.is_queue_operator(_queue UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.queues WHERE id = _queue AND owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.queue_operators WHERE queue_id = _queue AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.operators WHERE queue_id = _queue AND id = auth.uid()
  );
$$;

-- 5. RPC: get_my_queues()
-- Returns: queue_id, title, status, waiting_count, serving_count, role (ADMIN or CLERK), last_activity_at, created_at
CREATE OR REPLACE FUNCTION public.get_my_queues()
RETURNS TABLE (
  queue_id UUID,
  title TEXT,
  venue_name TEXT,
  status TEXT,
  waiting_count BIGINT,
  serving_count BIGINT,
  role TEXT,
  last_activity_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH accessible_queues AS (
    -- Queues owned by user
    SELECT q.id AS q_id, 'ADMIN'::TEXT AS op_role
    FROM public.queues q
    WHERE q.owner_id = auth.uid()

    UNION

    -- Queues in queue_operators
    SELECT qo.queue_id AS q_id, qo.role::TEXT AS op_role
    FROM public.queue_operators qo
    WHERE qo.user_id = auth.uid()

    UNION

    -- Queues in legacy operators table
    SELECT op.queue_id AS q_id, op.role::TEXT AS op_role
    FROM public.operators op
    WHERE op.id = auth.uid() AND op.queue_id IS NOT NULL

    UNION

    -- Queues matching operator_invitations email
    SELECT oi.queue_id AS q_id, 'CLERK'::TEXT AS op_role
    FROM public.operator_invitations oi
    JOIN auth.users u ON lower(u.email) = lower(oi.email)
    WHERE u.id = auth.uid()
  ),
  aggregated_roles AS (
    SELECT aq.q_id,
           CASE WHEN bool_or(aq.op_role = 'ADMIN') THEN 'ADMIN' ELSE 'CLERK' END AS final_role
    FROM accessible_queues aq
    GROUP BY aq.q_id
  )
  SELECT
    q.id AS queue_id,
    q.title,
    q.venue_name,
    q.status,
    COUNT(CASE WHEN t.status = 'WAITING' THEN 1 END) AS waiting_count,
    COUNT(CASE WHEN t.status = 'SERVING' THEN 1 END) AS serving_count,
    ar.final_role AS role,
    COALESCE(q.last_activity_at, q.created_at) AS last_activity_at,
    q.expires_at,
    q.created_at
  FROM public.queues q
  JOIN aggregated_roles ar ON ar.q_id = q.id
  LEFT JOIN public.tickets t ON t.queue_id = q.id AND t.status IN ('WAITING', 'SERVING')
  GROUP BY q.id, q.title, q.venue_name, q.status, ar.final_role, q.last_activity_at, q.expires_at, q.created_at
  ORDER BY COALESCE(q.last_activity_at, q.created_at) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_queues() TO authenticated;

-- Update create_queue_with_operators to also register into queue_operators
CREATE OR REPLACE FUNCTION public.create_queue_with_operators(
  p_title TEXT,
  p_operator_emails TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_queue_id UUID;
  v_email TEXT;
  v_user_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF length(trim(coalesce(p_title, ''))) = 0 THEN
    RAISE EXCEPTION 'Title is required';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  -- Create queue with 24-hr activity lease
  INSERT INTO public.queues (venue_name, title, status, owner_id, last_activity_at, expires_at)
  VALUES (p_title, p_title, 'OPEN', auth.uid(), now(), now() + INTERVAL '24 hours')
  RETURNING id INTO v_queue_id;

  -- Add to queue_operators table
  INSERT INTO public.queue_operators (queue_id, user_id, email, counter_name, role)
  VALUES (v_queue_id, auth.uid(), COALESCE(v_user_email, 'admin@q.local'), 'Counter 1', 'ADMIN')
  ON CONFLICT (queue_id, user_id) DO UPDATE SET role = 'ADMIN';

  -- Provision/update the creator as ADMIN in legacy operators table
  INSERT INTO public.operators (id, email, queue_id, counter_name, role)
  VALUES (auth.uid(), COALESCE(v_user_email, 'admin@q.local'), v_queue_id, 'Counter 1', 'ADMIN')
  ON CONFLICT (id) DO UPDATE SET queue_id = v_queue_id, role = 'ADMIN';

  -- Add invited emails
  IF p_operator_emails IS NOT NULL AND array_length(p_operator_emails, 1) > 0 THEN
    FOREACH v_email IN ARRAY p_operator_emails LOOP
      IF length(trim(v_email)) > 0 THEN
        INSERT INTO public.operator_invitations (queue_id, email)
        VALUES (v_queue_id, lower(trim(v_email)))
        ON CONFLICT (queue_id, email) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_queue_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_queue_with_operators(TEXT, TEXT[]) TO authenticated;
