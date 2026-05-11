CREATE TABLE IF NOT EXISTS public.tts_notification_order (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path_mp3 TEXT NOT NULL,
    status BOOLEAN NOT NULL DEFAULT false,
    log_audio JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tts_notification_order_status_created
    ON public.tts_notification_order (status, created_at);
