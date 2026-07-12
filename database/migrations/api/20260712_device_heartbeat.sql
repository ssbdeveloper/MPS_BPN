-- Device fleet heartbeat (app apps/mobile) — feed KPI uptime_tablet.
-- Desain per pelajaran machine_heartbeat: TANPA tabel beat mentah.
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT di sini.

-- 1 baris per device: kondisi terkini (upsert tiap beat).
CREATE TABLE IF NOT EXISTS public.device_status (
    device_id       text PRIMARY KEY,          -- ANDROID_ID
    device_name     text,
    model           text,
    app_version     text,
    android_version text,
    battery_pct     smallint,
    charging        boolean NOT NULL DEFAULT false,
    ip              text,
    interval_sec    integer NOT NULL DEFAULT 60,
    last_seen       timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 1 baris per (hari, device): counter beat — kembar ews.machine_heartbeat_daily.
-- uptime_pct = beats / (86400/interval_sec) dihitung saat dibaca.
CREATE TABLE IF NOT EXISTS ews.device_heartbeat_daily (
    work_date    date    NOT NULL,
    device_id    text    NOT NULL,
    beats        bigint  NOT NULL DEFAULT 0,
    interval_sec integer NOT NULL DEFAULT 60,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (work_date, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_hb_daily_device
    ON ews.device_heartbeat_daily (device_id, work_date DESC);
