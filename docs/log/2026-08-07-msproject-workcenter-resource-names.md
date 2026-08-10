---
title: Workcenter task = kolom Resource Names MS Project (bukan Notes); M5051 Balikpapan tidak dipakai
date: 2026-08-07
tags: [domain/manufacturing, domain/msproject, vba, fe, gantt]
---

# Workcenter bersumber dari Resource Names di MS Project

## Latar belakang (temuan)

- `ms_project_task.workcenter` selama ini diisi dari field **Notes** task di
  MS Project (desain lama `useform.md`: "Notes→workcenter"). Akibatnya nilai
  workcenter campur: kode grup benar (`C5100MPR/FAB/FIT/QIM/BPP`) vs teks
  bebas (`FABRICATION`, `use stock`, `TRAY BODY`, `READY TO SHIPMENT`, dst)
  — semua tergantung apa yang diketik planner di kolom Notes.
- User: kolom **Resource Names** di MS Project yang seharusnya jadi workcenter.
  Resource `M5051*` di `ms_resource` = milik Balikpapan, BUKAN Cikupa — tidak
  dipakai sebagai sumber workcenter. Resource workcenter Cikupa ada di tabel
  `workcenter` (`workcenternew` = `C5100MPR/QIM/BPP/FAB/FIT`, groupname
  `MPR/QIM/BPP/FAB/FIT`, description `Material Preparation/QC/Blasting
  Painting/Fabrication/Fitting`).
- DB: `ms_project_assignment` = 0 baris (assignment/resource per task tidak
  tersimpan), `operations.workcenter` kosong semua, `sow.workcenter` tidak
  menolong task sow_id NULL. Satu-satunya sumber yang benar-benar diisi planner
  di MS Project adalah Resource Names.

## Perubahan

### `tools/msproject-v2/ms_serializer.bas` — MsSafeTaskWorkcenter
- Baca **`ResourceNames`** (kolom Resource Names) sebagai workcenter.
- Fallback ke `Notes` hanya kalau ResourceNames kosong (kompatibilitas data
  lama yang belum diisi Resource Names).

### `tools/msproject-v2/ms_import.bas` — import package
- Workcenter dari server sekarang juga ditulis ke **`t.ResourceNames`**
  (MS Project auto-buat resource bernama kode workcenter, mis. "C5100FAB"),
  bukan hanya Notes. Notes tetap diisi sebagai cadangan.

### `tools/msproject-v2/useform.md`
- Dokumentasi field di-update: `ResourceNames→workcenter` (fallback Notes).

## Efek
- Setelah planner isi kolom Resource Names (mis. `C5100FAB`) di MS Project dan
  Save-to-Server, `ms_project_task.workcenter` terisi kode workcenter yang
  benar — kolom Workcenter di Portfolio Gantt menampilkan kode itu.
- Data lama (dari Notes) tetap bertahan sampai task diisi Resource Names.
- FE Gantt tidak berubah: tetap baca `task.workcenter`.

## Verifikasi
- Tidak ada linter untuk `.bas`; perubahan dibaca ulang manual (ResourceNames
  adalah property Task MS Project yang valid via CallByName `MsObjText`).
- Konsistensi: tidak ada referensi "Notes→workcenter" tersisa selain fallback
  yang disengaja.
