---
title: ID user bocor ke kolom "created by" reservasi bay
date: 2026-08-04
tags: [domain/msproject, domain/security]
---

# ID user tampil sebagai "37" di reservasi bay

Owner melaporkan kolom *created by* pada reservasi bay menampilkan angka `37`, bukan nama.

## Diagnosis

`37` adalah `users.id` milik `mell.sandy`. Sebaran nilai `created_by` menunjukkan tiga generasi:

| Nilai | Periode | Asal |
|---|---|---|
| `web-manufacturing` | 18 Jun | aktor hardcode di `cancelBaySchedule` |
| `2`, `37` | 28–31 Jul | **ID user** |
| `Tee San` | 4 Agu | nama, setelah perbaikan Fase 0 |

Penyebabnya helper lama di `SchedulingAreaPage`:

```js
function readLoginActor() {
  if (user.id != null && user.id !== '') return String(user.id);  // ID DULUAN
  return user.username || user.name || undefined;
}
```

`user.id` selalu ada, jadi cabang nama praktis mati. Nilainya dikirim di **body payload** —
yang berarti juga bisa dipalsukan klien.

Bukan bug yang masih aktif: `readLoginActor` sudah hilang saat Fase 5, dan sejak Fase 0 aktor
diambil dari sesi dengan urutan `x-user-name` dulu, baru `x-user-id` (anomali A-14). Baris
`Tee San` tertanggal 4 Agu adalah buktinya.

## Perbaikan

**Data:** 8 baris ber-`created_by` numerik di-backfill ke nama lewat `users.id`. `web-manufacturing`
sengaja dibiarkan — itu aktor sistem, bukan orang.

**Struktur** (migrasi `20260804c_bay_schedule_actor_user_id.sql`): kolom
`created_by_user_id` / `updated_by_user_id` dengan FK ke `public.users(id)` `ON DELETE SET NULL`,
plus index parsial (Postgres tidak mengindeks kolom FK otomatis). Backfill mencocokkan
`users.name` lalu `users.username`; keduanya terverifikasi UNIK (38/38).

Kolom teks `created_by`/`updated_by` **dipertahankan**, tidak di-drop: aktor non-user tidak punya
baris di `users`, dan teks itu jadi jejak historis bila user-nya kelak dihapus.

**Kode:** controller menambahkan `actor_user_id` dari header sesi — **tidak pernah dari body**,
karena body itulah celah aslinya. Ketiga INSERT dan keempat UPDATE/CANCEL `ms_project_bay_schedule`
mengisi kolom baru. `listBaySchedules` mengembalikan `created_by_name` /`updated_by_name` =
`coalesce(users.name, created_by)`. UI membaca `created_by_name` dengan `created_by` sebagai
cadangan, di empat titik: badge peta, modal detail, daftar penghuni bay, tooltip timeline.

Efeknya: ganti nama di `users` otomatis ikut ke seluruh reservasi lama, dan ID tidak bisa bocor ke
layar lagi.

## Sisa

`ms_project_bay_schedule.status` masih tanpa aturan kepemilikan — siapa pun yang punya feature
`bay_scheduling` bisa membatalkan reservasi siapa pun. Sekarang penegakannya sudah MUNGKIN
(`created_by_user_id` ber-FK), tinggal disepakati aturannya.
