-- Lapisan KOREKSI MANUAL untuk mch_transaction.
--
-- MASALAH: mch_transaction adalah tabel TURUNAN (etl_mch_transaction_v3 dari
-- mch_productiondata + ph3_order/sow/usernfc). Mengedit langsung = hilang saat
-- --full-rebuild. Mengedit mch_productiondata pun percuma — dia cermin SQL Server
-- yang di-upsert etl_machine_conf tiap sync.
--
-- SOLUSI: koreksi manusia disimpan di sini (dimiliki MPS2, tak ada yang menimpa),
-- lalu ETL MENERAPKANNYA di atas hasil derivasi. Bertahan terhadap dua-duanya:
-- sync cermin SQL Server MAUPUN full-rebuild. Audit (siapa/kapan) bawaan.
--
-- Kunci job disimpan sebagai (order_no, operation_no) — identitas job di ph3_order.
-- Nilai lengkap (confirmation_number, cost_center, dll) SELALU diambil ulang dari
-- ph3_order saat diterapkan, jadi tetap konsisten kalau ph3 berubah. sn_employee
-- untuk koreksi operator (kasus operator tak pernah tap -> tak ada operatorid).
--
-- Runner membungkus transaksi — jangan tulis BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS public.mch_transaction_override (
    proddataid   bigint PRIMARY KEY,
    -- override JOB (opsional): kunci ph3_order pilihan user
    order_no     text,
    operation_no text,
    -- override OPERATOR (opsional): snssb yang ditetapkan manual
    sn_employee  text,
    note         text,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- minimal satu jenis koreksi harus ada
    CONSTRAINT mch_transaction_override_something
      CHECK (order_no IS NOT NULL OR sn_employee IS NOT NULL)
);

COMMENT ON TABLE public.mch_transaction_override IS
  'Koreksi manual yang bertahan re-derivasi ETL. Diterapkan oleh etl_mch_transaction_v3 '
  '(apply_overrides) di atas hasil derivasi. Lihat migration 20260715_mch_transaction_override.';
