---
type: plan
status: active
updated: 2026-09-05
tags: [performance, api, domain/ops]
---

# API Performance Backlog — Track B

> **Output Track B adalah dokumen ini, bukan kode.** Menemukan endpoint lambat saat mengerjakan
> UI? Tulis satu baris di sini dan lanjutkan. Jangan perbaiki di commit yang sama — aturan
> lengkapnya di [[../../CLAUDE|CLAUDE.md]] bagian 10.
>
> Dokumen ini dirujuk oleh CLAUDE.md dan AGENTS.md sebagai tujuan wajib temuan performa. Sampai
> 2026-09-05 dokumen ini **tidak ada** sementara tiga tempat menyuruh menulis ke sini — temuan
> selama periode itu kemungkinan besar hilang.

## Cara menambah baris

Satu temuan satu baris. Kolom `evidence` tidak boleh kosong dan tidak boleh berisi tebakan:
angka dari `EXPLAIN (ANALYZE, BUFFERS)`, waktu respons yang diukur, atau jumlah baris yang
benar-benar dikembalikan. Tanpa bukti, itu bukan temuan — itu firasat, dan firasat performa di
repo ini sudah pernah salah (lihat `docs/concepts/ukur-dulu-baru-refactor.md`).

`status`: `open` → `triaged` → `approved` → `done` / `wontfix`.

## Backlog

| endpoint | consuming page | symptom | evidence | suspected cause | proposal | risk | effort | status |
|---|---|---|---|---|---|---|---|---|
| _(kosong — isi saat menemukan)_ | | | | | | | | |

## Yang harus dicari, urut kemungkinan

Daftar ini berasal dari pembacaan repo, belum diukur. Perlakukan sebagai hipotesis, bukan
temuan — memindahkannya ke tabel di atas butuh angka.

1. Endpoint mengembalikan seluruh tabel lalu frontend yang memfilter.
2. `SELECT *` pada tabel lebar.
3. N+1 query di dalam loop JavaScript.
4. Filter tanggal non-sargable (`DATE(col) = …`) yang melewati index.
5. `COUNT(*)` penuh untuk paginasi.
6. Join ke view yang mahal.
7. Index hilang di kolom filter panas — repo ini hanya punya dua index trigram dan **tidak ada
   index sama sekali** di `full_name` / `part_name`.
8. Interval polling frontend yang pendek terhadap endpoint mahal.
9. Refresh materialized view sinkron di dalam request.
10. Pool starvation dari `DB_POOL_MAX=5` di belakang pgbouncer transaction pooling.

## Aturan bila perbaikan disetujui

- Angka sebelum dan sesudah, atau tidak ada perubahan.
- `EXPLAIN (ANALYZE, BUFFERS)` untuk setiap query yang disentuh, ditempel di dokumen ini.
- Index baru lewat migration; `CREATE INDEX CONCURRENTLY` di production.
- Perubahan API bersifat aditif dan opt-in (`?fields=`, `?limit=`) — tidak pernah mendefinisikan
  ulang field yang sudah ada.
- Satu PR performa memperbaiki satu angka.
