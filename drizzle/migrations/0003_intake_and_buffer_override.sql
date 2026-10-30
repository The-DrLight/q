-- Migration: 0003_intake_and_buffer_override.sql
-- Description: Intake status and dynamic buffer override RPCs and default status checks

-- 1. Ensure buffer_override column exists on public.queues
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS buffer_override INT DEFAULT NULL;

-- 2. Ensure default status is 'OPEN' on public.queues
ALTER TABLE public.queues
  ALTER COLUMN status SET DEFAULT 'OPEN';

-- Fix any legacy queues that might have null or paused without intent
UPDATE public.queues
SET status = 'OPEN'
WHERE status IS NULL;

-- 3. Stored Procedure: set_queue_intake_status
CREATE OR REPLACE FUNCTION public.set_queue_intake_status(
  p_queue_id UUID,
  p_status TEXT
)
RETURNS public.queues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_queue public.queues;
BEGIN
  IF p_status NOT IN ('OPEN', 'PAUSED', 'CLOSED') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  PERFORM public._require_operator(p_queue_id);

  UPDATE public.queues
  SET status = p_status,
      updated_at = now()
  WHERE id = p_queue_id
  RETURNING * INTO v_queue;

  IF v_queue.id IS NULL THEN
    RAISE EXCEPTION 'Queue not found';
  END IF;

  RETURN v_queue;
END $$;

GRANT EXECUTE ON FUNCTION public.set_queue_intake_status(UUID, TEXT) TO authenticated;

-- 4. Stored Procedure: set_queue_buffer_override
CREATE OR REPLACE FUNCTION public.set_queue_buffer_override(
  p_queue_id UUID,
  p_buffer INT
)
RETURNS public.queues LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_queue public.queues;
  v_active_ops INT;
  v_floor INT;
  v_val INT;
BEGIN
  PERFORM public._require_operator(p_queue_id);

  -- Determine formula floor
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

  v_floor := (v_active_ops * 3) + 2;

  -- If p_buffer is NULL or <= floor, reset to NULL (or floor)
  IF p_buffer IS NULL OR p_buffer <= v_floor THEN
    v_val := NULL;
  ELSE
    v_val := LEAST(30, p_buffer); -- Cap at 30
  END IF;

  UPDATE public.queues
  SET buffer_override = v_val
  WHERE id = p_queue_id
  RETURNING * INTO v_queue;

  RETURN v_queue;
END $$;

GRANT EXECUTE ON FUNCTION public.set_queue_buffer_override(UUID, INT) TO authenticated;

-- 5. Update get_dynamic_buffer_size to respect buffer_override if set and >= floor
CREATE OR REPLACE FUNCTION public.get_dynamic_buffer_size(p_queue_id UUID)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_active_ops INT;
  v_floor INT;
  v_override INT;
BEGIN
  SELECT buffer_override INTO v_override
  FROM public.queues
  WHERE id = p_queue_id;

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

  v_floor := (v_active_ops * 3) + 2;

  IF v_override IS NOT NULL AND v_override > v_floor THEN
    RETURN v_override;
  END IF;

  RETURN v_floor;
END $$;

GRANT EXECUTE ON FUNCTION public.get_dynamic_buffer_size(UUID) TO anon, authenticated;
