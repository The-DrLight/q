CREATE TABLE public.queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAUSED','CLOSED')),
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT ON public.queues TO anon, authenticated;
GRANT ALL ON public.queues TO service_role;
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Queues are public" ON public.queues FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.operators (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  queue_id UUID REFERENCES public.queues(id) ON DELETE CASCADE,
  counter_name TEXT NOT NULL DEFAULT 'Counter 1',
  role TEXT NOT NULL DEFAULT 'CLERK' CHECK (role IN ('ADMIN','CLERK')),
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT ON public.operators TO authenticated;
GRANT ALL ON public.operators TO service_role;
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read own row" ON public.operators FOR SELECT TO authenticated USING (id = auth.uid());

CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  ticket_number INT NOT NULL,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  client_uuid TEXT NOT NULL,
  sort_order NUMERIC(14,6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','SERVING','COMPLETED','REVOKED')),
  strikes INT NOT NULL DEFAULT 0,
  serving_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  push_subscription JSONB,
  served_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tickets_queue_order ON public.tickets(queue_id, sort_order) WHERE status = 'WAITING';
CREATE INDEX idx_tickets_client_uuid ON public.tickets(client_uuid, queue_id);
GRANT SELECT ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_queue_operator(_queue UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.operators WHERE id = auth.uid() AND queue_id = _queue)
$$;

CREATE POLICY "Operators read queue tickets" ON public.tickets FOR SELECT TO authenticated
  USING (public.is_queue_operator(queue_id));

CREATE OR REPLACE FUNCTION public.bump_queue_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.queues SET version = version + 1 WHERE id = COALESCE(NEW.queue_id, OLD.queue_id);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_tickets_bump AFTER INSERT OR UPDATE OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.bump_queue_version();

INSERT INTO public.queues (id, venue_name, title) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Lagos Central Office', 'General Service');

CREATE OR REPLACE FUNCTION public.handle_new_operator()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INT; q UUID;
BEGIN
  SELECT count(*) INTO n FROM public.operators;
  SELECT id INTO q FROM public.queues ORDER BY created_at LIMIT 1;
  INSERT INTO public.operators (id, email, queue_id, counter_name, role)
  VALUES (NEW.id, NEW.email, q, 'Counter ' || (n + 1), CASE WHEN n = 0 THEN 'ADMIN' ELSE 'CLERK' END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_operator AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_operator();

CREATE OR REPLACE FUNCTION public.join_queue(p_queue_id UUID, p_full_name TEXT, p_phone_number TEXT, p_client_uuid TEXT, p_push_subscription JSONB DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing UUID; qstatus TEXT; nextnum INT; nextsort NUMERIC; newid UUID;
BEGIN
  IF length(trim(coalesce(p_full_name,''))) = 0 OR length(p_full_name) > 80 THEN RAISE EXCEPTION 'Invalid name'; END IF;
  IF length(coalesce(p_client_uuid,'')) < 8 OR length(p_client_uuid) > 64 THEN RAISE EXCEPTION 'Invalid client'; END IF;
  IF p_phone_number IS NOT NULL AND length(p_phone_number) > 30 THEN RAISE EXCEPTION 'Invalid phone'; END IF;
  SELECT status INTO qstatus FROM public.queues WHERE id = p_queue_id FOR UPDATE;
  IF qstatus IS NULL THEN RAISE EXCEPTION 'Queue not found'; END IF;
  SELECT id INTO existing FROM public.tickets
    WHERE client_uuid = p_client_uuid AND queue_id = p_queue_id AND status IN ('WAITING','SERVING') LIMIT 1;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  IF qstatus <> 'OPEN' THEN RAISE EXCEPTION 'Queue is not accepting new entries'; END IF;
  SELECT COALESCE(MAX(ticket_number),0)+1, COALESCE(MAX(sort_order),0)+1.0 INTO nextnum, nextsort
    FROM public.tickets WHERE queue_id = p_queue_id;
  INSERT INTO public.tickets (queue_id, ticket_number, full_name, phone_number, client_uuid, sort_order, push_subscription)
    VALUES (p_queue_id, nextnum, trim(p_full_name), NULLIF(trim(p_phone_number),''), p_client_uuid, nextsort, p_push_subscription)
    RETURNING id INTO newid;
  RETURN newid;
END $$;

CREATE OR REPLACE FUNCTION public.get_ticket_status(p_ticket_id UUID)
RETURNS TABLE (id UUID, queue_id UUID, ticket_number INT, full_name TEXT, status TEXT, strikes INT,
  queue_position INT, venue_name TEXT, title TEXT, queue_status TEXT, counter_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.queue_id, t.ticket_number, t.full_name, t.status, t.strikes,
    CASE WHEN t.status = 'WAITING' THEN (
      SELECT count(*)::int + 1 FROM public.tickets w
      WHERE w.queue_id = t.queue_id AND w.status = 'WAITING' AND w.sort_order < t.sort_order)
    ELSE NULL END,
    q.venue_name, q.title, q.status, o.counter_name
  FROM public.tickets t JOIN public.queues q ON q.id = t.queue_id
  LEFT JOIN public.operators o ON o.id = t.serving_operator_id
  WHERE t.id = p_ticket_id
$$;

CREATE OR REPLACE FUNCTION public.cancel_ticket(p_ticket_id UUID, p_client_uuid TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tickets SET status = 'REVOKED', serving_operator_id = NULL, updated_at = now()
  WHERE id = p_ticket_id AND client_uuid = p_client_uuid AND status IN ('WAITING','SERVING');
END $$;

CREATE OR REPLACE FUNCTION public._require_operator(_queue UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_queue_operator(_queue) THEN RAISE EXCEPTION 'Not authorized'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.clerk_call_next(p_queue_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid UUID; cur UUID;
BEGIN
  PERFORM public._require_operator(p_queue_id);
  SELECT id INTO cur FROM public.tickets WHERE queue_id = p_queue_id AND status = 'SERVING' AND serving_operator_id = auth.uid() LIMIT 1;
  IF cur IS NOT NULL THEN RETURN cur; END IF;
  SELECT id INTO tid FROM public.tickets
    WHERE queue_id = p_queue_id AND status = 'WAITING'
    ORDER BY sort_order ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF tid IS NULL THEN RETURN NULL; END IF;
  UPDATE public.tickets SET status = 'SERVING', serving_operator_id = auth.uid(), served_at = now(), updated_at = now() WHERE id = tid;
  RETURN tid;
END $$;

CREATE OR REPLACE FUNCTION public._lock_ticket(p_ticket_id UUID)
RETURNS public.tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Ticket not found'; END IF;
  PERFORM public._require_operator(t.queue_id);
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.clerk_mark_done(p_ticket_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets;
BEGIN
  t := public._lock_ticket(p_ticket_id);
  IF t.status <> 'SERVING' THEN RAISE EXCEPTION 'Ticket is not being served'; END IF;
  UPDATE public.tickets SET status = 'COMPLETED', serving_operator_id = NULL, updated_at = now() WHERE id = t.id;
  RETURN public.clerk_call_next(t.queue_id);
END $$;

CREATE OR REPLACE FUNCTION public._sort_behind_buffer(_queue UUID, _exclude UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s5 NUMERIC; s6 NUMERIC; smax NUMERIC;
BEGIN
  SELECT sort_order INTO s5 FROM public.tickets WHERE queue_id = _queue AND status = 'WAITING' AND id <> _exclude ORDER BY sort_order OFFSET 4 LIMIT 1;
  SELECT sort_order INTO s6 FROM public.tickets WHERE queue_id = _queue AND status = 'WAITING' AND id <> _exclude ORDER BY sort_order OFFSET 5 LIMIT 1;
  IF s5 IS NOT NULL AND s6 IS NOT NULL THEN RETURN (s5 + s6) / 2.0; END IF;
  IF s5 IS NOT NULL THEN RETURN s5 + 0.5; END IF;
  SELECT MAX(sort_order) INTO smax FROM public.tickets WHERE queue_id = _queue AND status = 'WAITING' AND id <> _exclude;
  RETURN COALESCE(smax, 0) + 0.5;
END $$;

CREATE OR REPLACE FUNCTION public.clerk_mark_absent(p_ticket_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets; ns INT;
BEGIN
  t := public._lock_ticket(p_ticket_id);
  IF t.status NOT IN ('SERVING','WAITING') THEN RAISE EXCEPTION 'Ticket is not active'; END IF;
  PERFORM 1 FROM public.tickets WHERE queue_id = t.queue_id AND status = 'WAITING' FOR UPDATE;
  ns := t.strikes + 1;
  IF ns >= 3 THEN
    UPDATE public.tickets SET strikes = ns, status = 'REVOKED', serving_operator_id = NULL, updated_at = now() WHERE id = t.id;
  ELSE
    UPDATE public.tickets SET strikes = ns, status = 'WAITING', serving_operator_id = NULL,
      sort_order = public._sort_behind_buffer(t.queue_id, t.id), updated_at = now() WHERE id = t.id;
  END IF;
  IF t.status = 'SERVING' THEN RETURN public.clerk_call_next(t.queue_id); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.clerk_hold_ticket(p_ticket_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets;
BEGIN
  t := public._lock_ticket(p_ticket_id);
  IF t.status <> 'SERVING' THEN RAISE EXCEPTION 'Ticket is not being served'; END IF;
  PERFORM 1 FROM public.tickets WHERE queue_id = t.queue_id AND status = 'WAITING' FOR UPDATE;
  UPDATE public.tickets SET status = 'WAITING', serving_operator_id = NULL,
    sort_order = public._sort_behind_buffer(t.queue_id, t.id), updated_at = now() WHERE id = t.id;
  RETURN public.clerk_call_next(t.queue_id);
END $$;

CREATE OR REPLACE FUNCTION public.clerk_revoke_ticket(p_ticket_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets;
BEGIN
  t := public._lock_ticket(p_ticket_id);
  UPDATE public.tickets SET status = 'REVOKED', serving_operator_id = NULL, updated_at = now() WHERE id = t.id;
  IF t.status = 'SERVING' AND t.serving_operator_id = auth.uid() THEN RETURN public.clerk_call_next(t.queue_id); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.clerk_set_queue_status(p_queue_id UUID, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._require_operator(p_queue_id);
  IF p_status NOT IN ('OPEN','PAUSED','CLOSED') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.queues SET status = p_status WHERE id = p_queue_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._require_operator(UUID), public._lock_ticket(UUID), public._sort_behind_buffer(UUID,UUID), public.bump_queue_version(), public.handle_new_operator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_queue(UUID,TEXT,TEXT,TEXT,JSONB), public.get_ticket_status(UUID), public.cancel_ticket(UUID,TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clerk_call_next(UUID), public.clerk_mark_done(UUID), public.clerk_mark_absent(UUID), public.clerk_hold_ticket(UUID), public.clerk_revoke_ticket(UUID), public.clerk_set_queue_status(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clerk_call_next(UUID), public.clerk_mark_done(UUID), public.clerk_mark_absent(UUID), public.clerk_hold_ticket(UUID), public.clerk_revoke_ticket(UUID), public.clerk_set_queue_status(UUID,TEXT) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queues;