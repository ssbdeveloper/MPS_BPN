-- Antrian permintaan operasi SAP staging yang dipicu dari UI (halaman Status Kirim SAP).
--
-- KENAPA ANTRIAN, BUKAN SHELL-OUT LANGSUNG: service `api` = Node Alpine, TIDAK bisa
-- menjalankan mesin bundling/posting Python. Menulis ulang mesin itu di Node = dua
-- implementasi yang pasti melenceng dan salah satunya double-post. Jadi API hanya
-- MENITIP permintaan; worker Python (`jobs/sap_staging/ops_worker.py`, image sama dengan
-- job etl/ews) yang mengeksekusinya lewat script yang SUDAH ada. Satu mesin.
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS public.sap_ops_request (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action       text        NOT NULL,
    params       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status       text        NOT NULL DEFAULT 'QUEUED',
    requested_by text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    result       text,
    error        text,
    CONSTRAINT sap_ops_request_action_ck
      CHECK (action IN ('stage_catchup', 'retry_failed')),
    CONSTRAINT sap_ops_request_status_ck
      CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'ERROR'))
);

-- Worker mengambil QUEUED tertua; UI menampilkan yang teranyar. Dua-duanya butuh index ini.
CREATE INDEX IF NOT EXISTS idx_sap_ops_request_status
    ON public.sap_ops_request (status, id);

-- Idempotensi: cegah dua permintaan aktif untuk aksi yang sama menumpuk (mis. user
-- menekan tombol dua kali). Hanya satu QUEUED/RUNNING per action pada satu waktu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sap_ops_request_active
    ON public.sap_ops_request (action)
    WHERE status IN ('QUEUED', 'RUNNING');
