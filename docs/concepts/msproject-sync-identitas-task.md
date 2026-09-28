---
type: concept
tags: [domain/msproject, domain/sap]
---

# Identitas task MS Project harus satu-ke-satu saat sync

`tools/msproject-v2/ms_fields.bas` menyimpan ID server pada `Task.Text10`. Serializer mengirim ID tersebut bersama `local_task_uid`. Di backend, `upsertTasks` memilih update berdasarkan task ID jika tersedia, bukan nama atau outline. Nama dan outline adalah atribut yang dapat berubah, bukan bukti identitas.

Pada kode yang diperiksa 2026-09-28, daftar payload belum memvalidasi keunikan task ID. Dua row yang membawa ID sama dapat memperbarui satu row secara berurutan. Dictionary `planTasks` VBA juga merangkum ID duplikat menjadi satu key, sehingga deactivation diff tidak mendeteksi bahwa banyak row berbagi identitas. Jumlah `tasks_updated` menghitung iterasi update, bukan row unik.

Daftar task web hanya mengambil task aktif. Task yang ada di database tetapi nonaktif memang tidak muncul. Menampilkan task nonaktif sebagai target mapping berisiko menghidupkan versi lama secara konseptual, tanpa memperbaiki identitas atau referensinya.

Invariant yang berlaku sejak 2026-09-28 (backend, `apps/api/services/msProjectSyncIdentity.js`, diuji `msProjectSyncIdentity.test.js`):

- Satu row payload resolve ke tepat satu row task. Dua row payload tidak boleh resolve ke row yang sama. UUID dibandingkan tanpa membedakan huruf besar/kecil, dan alias task_id versus `local_task_uid` ikut dihitung.
- `task_id` harus milik project yang di-sync.
- Task yang dikirim aktif tidak boleh sekaligus ada di `deactivate.task_ids`.
- Pelanggaran ditolak utuh dengan kode error di envelope yang sudah ada. Tidak ada dedupe diam-diam. Pemeriksaan payload berjalan sebelum koneksi DB dibuka. Pemeriksaan DB berjalan sesudah lock dan revisi valid, sebelum UPDATE pertama.
- Task baru tanpa `task_id`, rename, reparent, dan penghapusan eksplisit yang sah tetap diterima.

Preflight VBA (`MsDuplicateTaskIdReport` di `ms_sync.bas`) menolak Text10 ganda sebelum deactivate diff. Preflight ini hanya membantu operator; penjaga yang mengikat semua klien tetap backend. Invariant ini membatasi satu mekanisme kerusakan. Ia tidak menjamin file planner benar: rename sah tetap lolos, dan salinan yang Text10-nya dikosongkan akan menjadi task baru.

Recovery berbeda dari prevention: setelah suatu ID ditimpa, mengaktifkan kembali baris lama tidak otomatis mengembalikan nama, parent, mapping, dependency atau reservasi yang benar. Bandingkan sumber MS Project, snapshot dan referensi, lalu gunakan manifest per task. Snapshot historis bukan izin menghapus perubahan sah sesudah snapshot.

## Asal-usul

- [[log/2026-09-28-scheduling-map-sap-investigasi]]: project MANHAUL 11 unit, revision 4 berisi 11 summary unit; revision 5 tinggal satu summary unit aktif.
- [[log/2026-09-28-scheduling-map-sap-pencegahan]]: implementasi guard dan tes; manifest [[planning/2026-09-28-manhaul-recovery-manifest]].
- [[planning/2026-09-28-scheduling-map-sap-reliability]]: rencana perbaikan dan pembuktian.
- [[planning/mapping-operasi-sap-tahan-sync]] dan [[concepts/reservasi-bay-identitas-dan-kelengkapan]]: mapping dan reservasi tidak boleh rusak oleh sync.
