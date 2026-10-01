-- 20261001_ews_shift_date_override_guard.sql
-- Integritas data shift override: audit, guard SOW, dan trigger anti-race.
-- Referensi: docs/planning/ews-roster-date-range-shift-hours.md
--
-- Catatan runner: migration ini dijalankan di dalam transaksi oleh runner (database/migrate.js).

-- 1. Schema EWS (jika belum ada) dan tabel audit
CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.shift_definition_audit (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE')),
  shift_definition_id bigint NOT NULL,
  roster_shift_code text NULL,
  effective_date date NOT NULL,
  before jsonb NULL,
  after jsonb NOT NULL,
  affects_today boolean NOT NULL DEFAULT false,
  reason text NULL,
  actor_user_id text NULL,
  actor_name text NULL,
  actor_role text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_definition_audit_date
  ON ews.shift_definition_audit (effective_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_definition_audit_req
  ON ews.shift_definition_audit (request_id);

COMMENT ON TABLE ews.shift_definition_audit IS
  'Audit trail perubahan shift_definition bertanggal (override rentang tanggal EWS).';

-- 2. Helper fungsi pemeriksaan referensi SOW yang memblokir
-- Mengembalikan JSON berisi counts per tabel dan sample baris pemblokir (maks 20).
CREATE OR REPLACE FUNCTION public.ews_sow_blocking_refs(
  p_date date,
  p_shift_family_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cap_count bigint := 0;
  v_sched_count bigint := 0;
  v_batch_count bigint := 0;
  v_ot_count bigint := 0;
  v_samples jsonb := '[]'::jsonb;
  v_total bigint := 0;
BEGIN
  IF p_shift_family_ids IS NULL OR cardinality(p_shift_family_ids) = 0 THEN
    RETURN jsonb_build_object(
      'total', 0,
      'counts', jsonb_build_object(
        'sow_machine_capacity', 0,
        'sow_schedule', 0,
        'sow_schedule_batch', 0,
        'sow_overtime_request', 0
      ),
      'samples', '[]'::jsonb
    );
  END IF;

  -- 1. sow_machine_capacity: is_active = true
  SELECT count(*) INTO v_cap_count
  FROM public.sow_machine_capacity
  WHERE schedule_date = p_date
    AND shift_id = ANY(p_shift_family_ids)
    AND is_active = true;

  -- 2. sow_schedule: schedule_status <> 'CANCELLED'
  SELECT count(*) INTO v_sched_count
  FROM public.sow_schedule
  WHERE schedule_date = p_date
    AND shift_id = ANY(p_shift_family_ids)
    AND schedule_status <> 'CANCELLED';

  -- 3. sow_schedule_batch: batch_status <> 'CANCELLED'
  SELECT count(*) INTO v_batch_count
  FROM public.sow_schedule_batch
  WHERE schedule_date = p_date
    AND shift_id = ANY(p_shift_family_ids)
    AND batch_status <> 'CANCELLED';

  -- 4. sow_overtime_request: request_status IN ('PENDING', 'APPROVED')
  SELECT count(*) INTO v_ot_count
  FROM public.sow_overtime_request
  WHERE overtime_date = p_date
    AND shift_id = ANY(p_shift_family_ids)
    AND request_status IN ('PENDING', 'APPROVED');

  v_total := v_cap_count + v_sched_count + v_batch_count + v_ot_count;

  -- Ambil sampel hingga 20 baris untuk keperluan diagnostik error
  IF v_total > 0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(sample_row)), '[]'::jsonb)
    INTO v_samples
    FROM (
      (
        SELECT 'sow_machine_capacity' AS table_name, id::text AS ref_id, machine_code, 'ACTIVE' AS status
        FROM public.sow_machine_capacity
        WHERE schedule_date = p_date AND shift_id = ANY(p_shift_family_ids) AND is_active = true
        LIMIT 5
      )
      UNION ALL
      (
        SELECT 'sow_schedule' AS table_name, id::text AS ref_id, machine_code, schedule_status AS status
        FROM public.sow_schedule
        WHERE schedule_date = p_date AND shift_id = ANY(p_shift_family_ids) AND schedule_status <> 'CANCELLED'
        LIMIT 5
      )
      UNION ALL
      (
        SELECT 'sow_schedule_batch' AS table_name, id::text AS ref_id, machine_code, batch_status AS status
        FROM public.sow_schedule_batch
        WHERE schedule_date = p_date AND shift_id = ANY(p_shift_family_ids) AND batch_status <> 'CANCELLED'
        LIMIT 5
      )
      UNION ALL
      (
        SELECT 'sow_overtime_request' AS table_name, id::text AS ref_id, NULL::text AS machine_code, request_status AS status
        FROM public.sow_overtime_request
        WHERE overtime_date = p_date AND shift_id = ANY(p_shift_family_ids) AND request_status IN ('PENDING', 'APPROVED')
        LIMIT 5
      )
    ) sample_row;
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'counts', jsonb_build_object(
      'sow_machine_capacity', v_cap_count,
      'sow_schedule', v_sched_count,
      'sow_schedule_batch', v_batch_count,
      'sow_overtime_request', v_ot_count
    ),
    'samples', v_samples
  );
END;
$$;

COMMENT ON FUNCTION public.ews_sow_blocking_refs(date, bigint[]) IS
  'Memeriksa keberadaan dependensi SOW aktif yang memblokir perubahan shift override pada tanggal tertentu.';

-- 3. Trigger SOW: memastikan writer SOW hanya menggunakan shift yang ter-resolusi aktif
--    sekaligus mencegah race dengan mutasi override di EWS.
CREATE OR REPLACE FUNCTION public.sow_assert_resolved_shift()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_date date;
  v_is_blocking boolean := false;
  v_resolved boolean := false;
  v_table text := TG_TABLE_NAME;
BEGIN
  -- Evaluasi tanggal dan status blocking sesuai tabel
  IF v_table = 'sow_machine_capacity' THEN
    v_date := NEW.schedule_date;
    v_is_blocking := (NEW.is_active = true);
  ELSIF v_table = 'sow_schedule' THEN
    v_date := NEW.schedule_date;
    v_is_blocking := (NEW.schedule_status <> 'CANCELLED');
  ELSIF v_table = 'sow_schedule_batch' THEN
    v_date := NEW.schedule_date;
    v_is_blocking := (NEW.batch_status <> 'CANCELLED');
  ELSIF v_table = 'sow_overtime_request' THEN
    v_date := NEW.overtime_date;
    v_is_blocking := (NEW.request_status IN ('PENDING', 'APPROVED'));
  END IF;

  -- Jika status tidak memblokir atau shift_id NULL, izinkan
  IF NOT v_is_blocking OR NEW.shift_id IS NULL OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Hanya verifikasi pada INSERT atau ketika ada perubahan tanggal, shift_id, atau transisi status ke blocking
  IF TG_OP = 'UPDATE' THEN
    IF v_table = 'sow_machine_capacity' AND OLD.shift_id = NEW.shift_id AND OLD.schedule_date = NEW.schedule_date AND OLD.is_active = NEW.is_active THEN
      RETURN NEW;
    ELSIF v_table = 'sow_schedule' AND OLD.shift_id = NEW.shift_id AND OLD.schedule_date = NEW.schedule_date AND OLD.schedule_status = NEW.schedule_status THEN
      RETURN NEW;
    ELSIF v_table = 'sow_schedule_batch' AND OLD.shift_id = NEW.shift_id AND OLD.schedule_date = NEW.schedule_date AND OLD.batch_status = NEW.batch_status THEN
      RETURN NEW;
    ELSIF v_table = 'sow_overtime_request' AND OLD.shift_id = NEW.shift_id AND OLD.overtime_date = NEW.overtime_date AND OLD.request_status = NEW.request_status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Ambil KEY SHARE lock pada shift_definition untuk bersaing secara deterministik
  -- dengan FOR UPDATE lock transaksi EWS
  PERFORM 1 FROM public.shift_definition WHERE id = NEW.shift_id FOR KEY SHARE;

  -- Verifikasi apakah shift_id benar-benar shift yang aktif ter-resolusi untuk tanggal target
  SELECT EXISTS (
    SELECT 1 FROM public.resolve_shift_definition(v_date) r
    WHERE r.id = NEW.shift_id
  ) INTO v_resolved;

  IF NOT v_resolved THEN
    RAISE EXCEPTION 'SOW_SHIFT_NOT_RESOLVED: shift_id % bukan shift aktif ter-resolusi untuk tanggal % pada tabel %',
      NEW.shift_id, v_date, v_table
      USING ERRCODE = 'P0409';
  END IF;

  RETURN NEW;
END;
$$;

-- Pasang trigger pada keempat tabel SOW
DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_machine_capacity;
CREATE TRIGGER trg_sow_assert_resolved_shift
  BEFORE INSERT OR UPDATE ON public.sow_machine_capacity
  FOR EACH ROW EXECUTE FUNCTION public.sow_assert_resolved_shift();

DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_schedule;
CREATE TRIGGER trg_sow_assert_resolved_shift
  BEFORE INSERT OR UPDATE ON public.sow_schedule
  FOR EACH ROW EXECUTE FUNCTION public.sow_assert_resolved_shift();

DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_schedule_batch;
CREATE TRIGGER trg_sow_assert_resolved_shift
  BEFORE INSERT OR UPDATE ON public.sow_schedule_batch
  FOR EACH ROW EXECUTE FUNCTION public.sow_assert_resolved_shift();

DROP TRIGGER IF EXISTS trg_sow_assert_resolved_shift ON public.sow_overtime_request;
CREATE TRIGGER trg_sow_assert_resolved_shift
  BEFORE INSERT OR UPDATE ON public.sow_overtime_request
  FOR EACH ROW EXECUTE FUNCTION public.sow_assert_resolved_shift();

-- 4. Trigger penjaga pada public.shift_definition untuk menutup writer SOW shift-rules
--    Mencegah modifikasi atau deaktivasi override bila sudah memiliki referensi SOW.
CREATE OR REPLACE FUNCTION public.shift_definition_assert_sow_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_date date;
  v_family_ids bigint[];
  v_res jsonb;
  v_total bigint;
BEGIN
  -- Hanya berlaku untuk override bertanggal (bukan default)
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default THEN
      RETURN OLD;
    END IF;
    v_date := OLD.effective_date;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_default AND NEW.is_default THEN
      RETURN NEW;
    END IF;
    -- Jika bukan perubahan jam, tanggal, atau is_active, lewati
    IF OLD.start_time = NEW.start_time AND OLD.end_time = NEW.end_time AND
       OLD.crosses_midnight = NEW.crosses_midnight AND OLD.is_active = NEW.is_active AND
       OLD.effective_date IS NOT DISTINCT FROM NEW.effective_date THEN
      RETURN NEW;
    END IF;
    v_date := COALESCE(OLD.effective_date, NEW.effective_date);
  END IF;

  IF v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Cari seluruh id shift dalam keluarga kode yang sama
  SELECT array_agg(id) INTO v_family_ids
  FROM public.shift_definition
  WHERE lower(shift_code) = lower(COALESCE(OLD.shift_code, NEW.shift_code));

  v_res := public.ews_sow_blocking_refs(v_date, v_family_ids);
  v_total := (v_res->>'total')::bigint;

  IF v_total > 0 THEN
    RAISE EXCEPTION 'SOW_REFERENCE_CONFLICT: shift override tanggal % terikat % referensi SOW aktif',
      v_date, v_total
      USING ERRCODE = 'P0409', DETAIL = v_res::text;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_shift_definition_assert_sow_guard ON public.shift_definition;
CREATE TRIGGER trg_shift_definition_assert_sow_guard
  BEFORE UPDATE OR DELETE ON public.shift_definition
  FOR EACH ROW EXECUTE FUNCTION public.shift_definition_assert_sow_guard();
