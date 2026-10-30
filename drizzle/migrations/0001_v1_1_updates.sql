-- Migration: 0001_v1_1_updates.sql
-- Description: Dynamic buffer sizing, single active ticket constraint, 24-hr queue expiration, queue creation, and atomic clerk actions

-- 1. Single Active Ticket Constraint
-- A user/device can hold at most one active queue ticket globally across queues
DROP INDEX IF EXISTS idx_tickets_single_active_ticket;
CREATE UNIQUE INDEX idx_tickets_single_active_ticket
  ON public.tickets (client_uuid)
  WHERE status IN ('WAITING', 'SERVING');

-- 2. 24-Hour Expiration & Ownership on public.queues
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours');

-- Operator invitations whitelist table
CREATE TABLE IF NOT EXISTS public.operator_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (queue_id, email)
);
GRANT SELECT ON public.operator_invitations TO authenticated;
GRANT ALL ON public.operator_invitations TO service_role;
ALTER TABLE public.operator_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read invitations for their queue" ON public.operator_invitations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.operators WHERE id = auth.uid() AND queue_id = operator_invitations.queue_id));

-- Update handle_new_operator to also check operator_invitations
CREATE OR REPLACE FUNCTION public.handle_new_operator()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_queue_id UUID;
  v_n INT;
BEGIN
  -- Check if user was explicitly invited to a queue
  SELECT queue_id INTO v_queue_id FROM public.operator_invitations WHERE lower(email) = lower(NEW.email) LIMIT 1;
  
  -- If not invited, assign to first queue or user-owned queue
  IF v_queue_id IS NULL THEN
    SELECT id INTO v_queue_id FROM public.queues WHERE owner_id = NEW.id ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_queue_id IS NULL THEN
    SELECT id INTO v_queue_id FROM public.queues ORDER BY created_at LIMIT 1;
  END IF;

  IF v_queue_id IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.operators WHERE queue_id = v_queue_id;
    INSERT INTO public.operators (id, email, queue_id, counter_name, role)
    VALUES (NEW.id, NEW.email, v_queue_id, 'Counter ' || (v_n + 1), CASE WHEN v_n = 0 THEN 'ADMIN' ELSE 'CLERK' END)
    ON CONFLICT (email) DO UPDATE SET queue_id = EXCLUDED.queue_id;
  END IF;

  RETURN NEW;
END $$;

-- 3. Dynamic Buffer Calculation Function
-- Queries distinct serving_operator_id on tickets active within last 15 minutes in that queue
-- Formula: Buffer Size = (GREATEST(1, active_operators) * 3) + 2 (defaults to 5 if 1 operator active)
CREATE OR REPLACE FUNCTION public.get_dynamic_buffer_size(p_queue_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_active_ops INT;
BEGIN
  SELECT count(DISTINCT serving_operator_id) INTO v_active_ops
  FROM public.tickets
  WHERE queue_id = p_queue_id
    AND serving_operator_id IS NOT NULL
    AND (
      status = 'SERVING'
      OR (served_at IS NOT NULL AND served_at >= now() - INTERVAL '15 minutes')
      OR (updated_at IS NOT NULL AND updated_at >= now() - INTERVAL '15 minutes')
    );

  IF v_active_ops IS NULL OR v_active_ops < 1 THEN
    v_active_ops := 1;
  END IF;

  RETURN (v_active_ops * 3) + 2;
END $$;

GRANT EXECUTE ON FUNCTION public.get_dynamic_buffer_size(UUID) TO anon, authenticated;

-- 4. Queue Creation Stored Procedure
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

  -- Create queue with 24-hr expiration
  INSERT INTO public.queues (venue_name, title, status, owner_id, expires_at)
  VALUES (p_title, p_title, 'OPEN', auth.uid(), now() + INTERVAL '24 hours')
  RETURNING id INTO v_queue_id;

  -- Provision the creator as ADMIN operator
  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.operators (id, email, queue_id, counter_name, role)
  VALUES (auth.uid(), coalesce(v_user_email, 'admin@q.local'), v_queue_id, 'Counter 1', 'ADMIN')
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

-- 5. Atomic Operator Actions

-- clerk_serve_ticket: Atomically transitions ticket from WAITING to SERVING and assigns operator
CREATE OR REPLACE FUNCTION public.clerk_serve_ticket(p_ticket_id UUID, p_operator_id UUID DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op_id UUID;
  v_ticket public.tickets;
BEGIN
  v_op_id := COALESCE(p_operator_id, auth.uid());
  IF v_op_id IS NULL THEN
    RAISE EXCEPTION 'Operator not identified';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  PERFORM public._require_operator(v_ticket.queue_id);

  IF v_ticket.status = 'SERVING' AND v_ticket.serving_operator_id = v_op_id THEN
    RETURN v_ticket;
  END IF;

  IF v_ticket.status <> 'WAITING' THEN
    RAISE EXCEPTION 'Ticket is not waiting to be served (current status: %)', v_ticket.status;
  END IF;

  UPDATE public.tickets
  SET status = 'SERVING',
      serving_operator_id = v_op_id,
      served_at = now(),
      updated_at = now()
  WHERE id = v_ticket.id
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END $$;

GRANT EXECUTE ON FUNCTION public.clerk_serve_ticket(UUID, UUID) TO authenticated;

-- clerk_complete_ticket: Transitions ticket to COMPLETED and clears serving_operator_id
CREATE OR REPLACE FUNCTION public.clerk_complete_ticket(p_ticket_id UUID, p_operator_id UUID DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ticket public.tickets;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  PERFORM public._require_operator(v_ticket.queue_id);

  IF v_ticket.status <> 'SERVING' THEN
    RAISE EXCEPTION 'Ticket is not currently being served';
  END IF;

  UPDATE public.tickets
  SET status = 'COMPLETED',
      serving_operator_id = NULL,
      updated_at = now()
  WHERE id = v_ticket.id
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END $$;

GRANT EXECUTE ON FUNCTION public.clerk_complete_ticket(UUID, UUID) TO authenticated;

-- clerk_mark_ticket_absent:
-- Increments strikes by 1.
-- If strikes >= 3: sets status = 'REVOKED'.
-- If strikes < 3: gets dynamic buffer size, finds sort_order at offset dynamic_buffer and dynamic_buffer+1,
-- and uses fractional indexing to bump behind buffer.
CREATE OR REPLACE FUNCTION public.clerk_mark_ticket_absent(p_ticket_id UUID)
RETURNS public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ticket public.tickets;
  v_new_strikes INT;
  v_buf INT;
  v_s_at_buf NUMERIC;
  v_s_next NUMERIC;
  v_new_sort NUMERIC;
  v_s_max NUMERIC;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  PERFORM public._require_operator(v_ticket.queue_id);

  IF v_ticket.status NOT IN ('SERVING', 'WAITING') THEN
    RAISE EXCEPTION 'Ticket is not active';
  END IF;

  v_new_strikes := v_ticket.strikes + 1;

  IF v_new_strikes >= 3 THEN
    UPDATE public.tickets
    SET strikes = v_new_strikes,
        status = 'REVOKED',
        serving_operator_id = NULL,
        updated_at = now()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;
  ELSE
    -- Calculate dynamic buffer size
    v_buf := public.get_dynamic_buffer_size(v_ticket.queue_id);

    -- Find sort_order at offset (v_buf - 1) and offset v_buf
    SELECT sort_order INTO v_s_at_buf
    FROM public.tickets
    WHERE queue_id = v_ticket.queue_id AND status = 'WAITING' AND id <> v_ticket.id
    ORDER BY sort_order OFFSET (v_buf - 1) LIMIT 1;

    SELECT sort_order INTO v_s_next
    FROM public.tickets
    WHERE queue_id = v_ticket.queue_id AND status = 'WAITING' AND id <> v_ticket.id
    ORDER BY sort_order OFFSET v_buf LIMIT 1;

    IF v_s_at_buf IS NOT NULL AND v_s_next IS NOT NULL THEN
      v_new_sort := (v_s_at_buf + v_s_next) / 2.0;
    ELSIF v_s_at_buf IS NOT NULL THEN
      v_new_sort := v_s_at_buf + 0.5;
    ELSE
      SELECT MAX(sort_order) INTO v_s_max
      FROM public.tickets
      WHERE queue_id = v_ticket.queue_id AND status = 'WAITING' AND id <> v_ticket.id;
      v_new_sort := COALESCE(v_s_max, 0) + 0.5;
    END IF;

    UPDATE public.tickets
    SET strikes = v_new_strikes,
        status = 'WAITING',
        serving_operator_id = NULL,
        sort_order = v_new_sort,
        updated_at = now()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;
  END IF;

  RETURN v_ticket;
END $$;

GRANT EXECUTE ON FUNCTION public.clerk_mark_ticket_absent(UUID) TO authenticated;
