-- EWS TTS Notification queue
-- ----------------------------------------------------------------------------
-- Antrean audio TTS untuk issue log EWS. Alur:
--   1) API meng-enqueue baris 'queued' saat issue baru ter-generate (syncActions).
--   2) Worker Piper (apps/tts-worker/generate_ews_audio.py) mengubah `message`
--      jadi MP3, menyimpannya, lalu menandai baris 'ready' + path_mp3.
--   3) Halaman notifikasi frontend mem-poll baris 'ready' yang belum `played`,
--      memutarnya, lalu menandai played=true.
-- Idempoten & aman dijalankan ulang.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ews;

CREATE TABLE IF NOT EXISTS ews.tts_notification (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_key          TEXT UNIQUE,                 -- satu audio per issue unik (anti-spam)
    kpi_type           TEXT,
    severity           TEXT,                        -- Critical | Watch
    title              TEXT,                        -- ringkas untuk ditampilkan di UI
    message            TEXT NOT NULL,               -- teks yang diucapkan (lihat buildIssueSpeech)
    path_mp3           TEXT,
    generation_status  TEXT NOT NULL DEFAULT 'queued', -- queued|processing|ready|error
    error_message      TEXT,
    attempts           INT  NOT NULL DEFAULT 0,
    played             BOOLEAN NOT NULL DEFAULT false,
    log_audio          JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ews_tts_status_created
    ON ews.tts_notification (generation_status, created_at);

CREATE INDEX IF NOT EXISTS idx_ews_tts_ready_unplayed
    ON ews.tts_notification (played, generated_at DESC)
    WHERE generation_status = 'ready';

COMMIT;
