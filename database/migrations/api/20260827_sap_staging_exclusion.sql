-- Sap staging exclusion: record (segmen sumber) yang TIDAK boleh di-bundle/dikirim ke SAP.
-- Tabel TERPISAH dari sap_staging_source supaya bertahan dari rebuild (yang menghapus
-- provenance) dan di-honor saat staging (fetch skip excluded). Bisa dibatalkan (un-exclude).
CREATE TABLE IF NOT EXISTS public.sap_staging_exclusion (
  source_system text NOT NULL,
  source_row_id text NOT NULL,
  excluded_by   text,
  excluded_at   timestamptz NOT NULL DEFAULT now(),
  note          text,
  PRIMARY KEY (source_system, source_row_id)
);

COMMENT ON TABLE public.sap_staging_exclusion IS
  'Record sumber yang dikecualikan dari bundling/posting SAP (soft delete per record).';
