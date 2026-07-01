-- Migration: sow_standard_attachments
-- PDF file attachments for sow_standard operations
-- Files stored on filesystem at: /uploads/sow-pdf/{part_number}/{operation_no}/{uuid}.pdf

CREATE TABLE IF NOT EXISTS public.sow_standard_attachments (
    id            bigserial PRIMARY KEY,
    standard_id   bigint NOT NULL REFERENCES public.sow_standard(id) ON DELETE CASCADE,
    filename      text NOT NULL,         -- stored filename on disk (uuid.pdf)
    original_name text NOT NULL,         -- original filename from user upload
    file_path     text NOT NULL,         -- relative path: /uploads/sow-pdf/{part_number}/{op_no}/{uuid}.pdf
    file_size     integer,               -- bytes
    uploaded_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sow_std_attach_standard_id
    ON public.sow_standard_attachments(standard_id);
