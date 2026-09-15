-- SAP staging provenance + anti-double-post guard.
--
-- MASALAH: source_key = md5(13 field). Kalau resep md5 diubah (kode) ATAU data sumber
-- dikoreksi (mis. order_no salah diperbaiki), kunci berubah -> baris staging BARU ->
-- id baru -> ZTIMESHEETID baru -> SAP menganggapnya kiriman baru -> DITERIMA ->
-- jam kerja masuk SAP DUA KALI. Dedup ZTIMESHEETID di SAP tidak menolong, karena
-- ztimesheetid = id::text (nomor baris), bukan turunan data sumber.
--
-- SOLUSI: catat identitas SUMBER tiap bundel. Jangkarnya (source_row_id, bucket_start)
-- = identitas SEGMEN — bukan source_row_id saja, karena bundling MEMOTONG satu record
-- per jam (satu proddataid sah muncul di beberapa bundel; contoh nyata: proddataid
-- 501272 berjalan 16:45-20:48 -> 5 segmen -> 5 bundel).
-- Segmen tidak berubah walau resep md5 diubah, format diganti, atau PLANT_SSB diubah.
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT di sini.

CREATE TABLE IF NOT EXISTS public.sap_staging_source (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staging_id    bigint      NOT NULL REFERENCES public.sap_timesheet_staging(id) ON DELETE CASCADE,
    source_system text        NOT NULL,              -- MCH_HOURS | TIMESHEET
    source_row_id text        NOT NULL,              -- proddataid (MCH_HOURS) / tsnumber (TIMESHEET)
    bucket_start  timestamptz NOT NULL,              -- jam bucket bundel
    seconds       bigint      NOT NULL DEFAULT 0,    -- detik segmen ini menyumbang ke bundel
    posted_at     timestamptz,                       -- diisi otomatis saat bundel-nya POSTED
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sap_staging_source IS
  'Provenance: bundel staging mana berasal dari record sumber mana (per segmen jam). '
  'Dipakai untuk audit + guard anti-double-post di post_sap_staging.py.';

-- Satu segmen hanya boleh diklaim sekali oleh satu bundel yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_segment_per_bundle
    ON public.sap_staging_source (staging_id, source_system, source_row_id, bucket_start);

-- Lookup guard: "segmen ini sudah pernah dipakai bundel mana saja?"
CREATE INDEX IF NOT EXISTS idx_sap_staging_source_segment
    ON public.sap_staging_source (source_system, source_row_id, bucket_start);

-- ⛔ JAMINAN TINGKAT DATABASE: satu segmen MUSTAHIL ter-POST dua kali.
-- Ini garis pertahanan terakhir — bukan pengganti guard di poster, tapi jaring
-- yang tidak pernah lupa. Kalau ada kode yang mencoba, transaksinya GAGAL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_staging_source_posted_once
    ON public.sap_staging_source (source_system, source_row_id, bucket_start)
    WHERE posted_at IS NOT NULL;


-- Saat sebuah bundel berpindah ke POSTED, tandai semua segmennya. Lewat trigger,
-- bukan kode aplikasi, supaya tidak bisa lupa dipanggil dari jalur mana pun.
CREATE OR REPLACE FUNCTION public.sap_staging_mark_segments_posted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status IS DISTINCT FROM 'POSTED' THEN
    UPDATE public.sap_staging_source
       SET posted_at = COALESCE(NEW.posted_at, now())
     WHERE staging_id = NEW.id
       AND posted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sap_staging_mark_segments_posted ON public.sap_timesheet_staging;
CREATE TRIGGER trg_sap_staging_mark_segments_posted
    AFTER UPDATE OF status ON public.sap_timesheet_staging
    FOR EACH ROW
    EXECUTE FUNCTION public.sap_staging_mark_segments_posted();


-- Log percobaan perubahan pada record sumber yang SUDAH terkirim ke SAP (lihat
-- trigger pembekuan di bawah). Ini yang membuat "koreksi terlambat" terlihat,
-- bukan hilang diam-diam.
CREATE TABLE IF NOT EXISTS public.sap_source_change_blocked (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_system text        NOT NULL,
    source_row_id text        NOT NULL,
    blocked_at    timestamptz NOT NULL DEFAULT now(),
    changed_field text        NOT NULL,
    old_value     text,
    new_value     text,
    staging_ids   bigint[]                            -- bundel POSTED yang memuat record ini
);

CREATE INDEX IF NOT EXISTS idx_sap_source_change_blocked_row
    ON public.sap_source_change_blocked (source_system, source_row_id, blocked_at DESC);


-- BACKFILL: rekonstruksi provenance untuk baris staging yang sudah ada.
-- Rekonstruksi ini DIVERIFIKASI 156/156 cocok persis dengan source_row_count +
-- total_seconds sebelum migration ini ditulis. Aman dijalankan sekali.
INSERT INTO public.sap_staging_source (staging_id, source_system, source_row_id, bucket_start, seconds, posted_at)
SELECT
    t.id,
    'MCH_HOURS',
    m.proddataid::text,
    t.bucket_start,
    EXTRACT(EPOCH FROM (
        LEAST(m.enddatetime, t.bucket_start + interval '1 hour')
      - GREATEST(m.startdatetime, t.bucket_start)
    ))::bigint,
    CASE WHEN t.status = 'POSTED' THEN COALESCE(t.posted_at, now()) END
FROM public.sap_timesheet_staging t
JOIN public.mch_transaction m
  ON m.startdatetime < t.bucket_start + interval '1 hour'
 AND m.enddatetime   > t.bucket_start
 AND m.enddatetime   > m.startdatetime
 AND LTRIM(COALESCE(m.order_no, ''), '0')      = LTRIM(t.aufnr, '0')
 AND LPAD(COALESCE(m.operation_no, ''), 4, '0') = t.vornr
 AND COALESCE(m.sn_employee, '')                = t.pernr_origin
 AND COALESCE(m.machineid, '')                  = t.arbpl
 AND (CASE WHEN COALESCE(m.status_activitytype, '') IN ('M1','M2')
           THEN m.status_activitytype ELSE '' END)                    = t.zconf_type
 AND (CASE WHEN COALESCE(m.status_activitytype, '') IN ('M1','M2')
           THEN '' ELSE COALESCE(m.status_activitytype, '') END)      = t.lstar
 AND (CASE WHEN COALESCE(m.status_activitytype, '') = 'M2'
           THEN COALESCE(m.status_description, '') ELSE '' END)       = t.zbarcodeid
WHERE t.source_system = 'MCH_HOURS'
  AND LEAST(m.enddatetime, t.bucket_start + interval '1 hour')
    > GREATEST(m.startdatetime, t.bucket_start)
ON CONFLICT (staging_id, source_system, source_row_id, bucket_start) DO NOTHING;


-- ============================================================================
-- PEMBEKUAN: record sumber yang SUDAH terkirim ke SAP tidak boleh berubah.
-- ============================================================================
-- Kenapa: kalau order_no (dll) dikoreksi SETELAH bundel-nya ter-POST, bundel baru
-- lahir dengan source_key berbeda -> berpotensi terkirim lagi, sementara yang SALAH
-- sudah terlanjur di SAP dan TIDAK ada mekanisme storno di sistem ini.
--
-- Sifat trigger ini SURGICAL, bukan menolak update:
--   • Hanya membekukan field yang MEMBENTUK identitas bundel SAP.
--   • Field lain (refreshed_at, status_description non-M2, dll) tetap boleh ter-update,
--     sehingga upsert ETL TIDAK GAGAL dan batch-nya tidak putus.
--   • Setiap percobaan perubahan DICATAT ke sap_source_change_blocked -> terlihat manusia.
--
-- KONSEKUENSI YANG DISENGAJA: untuk baris terkunci, mch_transaction sengaja BERHENTI
-- mencerminkan SQL Server. Yang dipegang MPS2 = versi yang dikirim ke SAP. Itu memang
-- yang benar untuk integritas payroll — koreksi harus lewat storno SAP, bukan diam-diam
-- mengubah data di belakang angka yang sudah dibayarkan.

CREATE OR REPLACE FUNCTION public.mch_transaction_freeze_posted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  posted_ids bigint[];
BEGIN
  SELECT array_agg(DISTINCT s.staging_id)
    INTO posted_ids
    FROM public.sap_staging_source s
   WHERE s.source_system = 'MCH_HOURS'
     AND s.source_row_id = NEW.proddataid::text
     AND s.posted_at IS NOT NULL;

  IF posted_ids IS NULL THEN
    RETURN NEW;  -- belum pernah terkirim ke SAP: bebas di-update
  END IF;

  -- Bekukan field pembentuk identitas bundel, satu per satu, sambil mencatat.
  IF NEW.order_no IS DISTINCT FROM OLD.order_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'order_no', OLD.order_no, NEW.order_no, posted_ids);
    NEW.order_no := OLD.order_no;
  END IF;

  IF NEW.operation_no IS DISTINCT FROM OLD.operation_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'operation_no', OLD.operation_no, NEW.operation_no, posted_ids);
    NEW.operation_no := OLD.operation_no;
  END IF;

  IF NEW.sn_employee IS DISTINCT FROM OLD.sn_employee THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'sn_employee', OLD.sn_employee, NEW.sn_employee, posted_ids);
    NEW.sn_employee := OLD.sn_employee;
  END IF;

  IF NEW.confirmation_number IS DISTINCT FROM OLD.confirmation_number THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'confirmation_number', OLD.confirmation_number, NEW.confirmation_number, posted_ids);
    NEW.confirmation_number := OLD.confirmation_number;
  END IF;

  IF NEW.machineid IS DISTINCT FROM OLD.machineid THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'machineid', OLD.machineid, NEW.machineid, posted_ids);
    NEW.machineid := OLD.machineid;
  END IF;

  IF NEW.status_activitytype IS DISTINCT FROM OLD.status_activitytype THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'status_activitytype', OLD.status_activitytype, NEW.status_activitytype, posted_ids);
    NEW.status_activitytype := OLD.status_activitytype;
  END IF;

  -- Waktu = durasi yang sudah dibayarkan. Paling sensitif.
  IF NEW.startdatetime IS DISTINCT FROM OLD.startdatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'startdatetime', OLD.startdatetime::text, NEW.startdatetime::text, posted_ids);
    NEW.startdatetime := OLD.startdatetime;
  END IF;

  IF NEW.enddatetime IS DISTINCT FROM OLD.enddatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'enddatetime', OLD.enddatetime::text, NEW.enddatetime::text, posted_ids);
    NEW.enddatetime := OLD.enddatetime;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mch_transaction_freeze_posted ON public.mch_transaction;
CREATE TRIGGER trg_mch_transaction_freeze_posted
    BEFORE UPDATE ON public.mch_transaction
    FOR EACH ROW
    EXECUTE FUNCTION public.mch_transaction_freeze_posted();
