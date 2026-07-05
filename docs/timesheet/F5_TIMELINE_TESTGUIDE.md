# F5 — Multi-Day Scheduling Timeline: What Was Built + How To Test

> Fase F5 dari [sow Scheduling master plan.md](./sow%20Scheduling%20master%20plan.md).
> Timeline lintas hari & lintas shift (gaya Gantt) untuk salvaging, dengan
> cross-midnight, kantong batch, overtime, DnD reschedule, dan insight sekilas.
> **Belum di-commit — untuk review.**

---

## 1. Yang dibangun

### Backend (`apps/api/`)
| File | Perubahan |
|---|---|
| `controllers/sowScheduleController.js` | **`rescheduleSchedule`** — pindah jadwal ke mesin/hari/shift lain **dan menghitung ulang** `planned_start/end_datetime` dari shift window target (ditempatkan setelah jam terpakai di slot itu, `getUsedNormalHours(excludeScheduleId)`). Mirror logika `createSchedule`. `planned_hours` tidak diubah → akuntansi I1 utuh. Guard: tolak row `CANCELLED` & `is_overtime`. Transaksional (`FOR UPDATE`). |
| `routes/sowSchedule.js` | `POST /sow-schedule/:id/reschedule` (sebelum `/:id`). |
| `rbac/manifest.js` | daftarkan endpoint reschedule → `sow_scheduling` write. |

> **Kenapa endpoint baru, bukan `updateSchedule`?** `updateSchedule` adalah
> field-set mentah — saat board memindah jadwal, ia meng-update `machine_code`/
> `schedule_date`/`shift_id` **tapi membiarkan `planned_start/end_datetime` basi**.
> Board tak pernah membaca datetime jadi tak terlihat; **timeline membacanya**, jadi
> move wajib menjaga timestamp tetap benar. Board move sekarang **ikut memakai
> endpoint reschedule** ini → datetime konsisten untuk board, timeline, dan report.

### Frontend (`apps/web/`)
| File | Perubahan |
|---|---|
| `services/sowScheduleService.js` | `rescheduleSchedule(id, payload)`. |
| `pages/PPC/salvaging/SchedulingTimeline.jsx` | **BARU** — komponen timeline mandiri (fetch range sendiri, DnD sendiri). |
| `pages/PPC/salvaging/SowSchedulingPage.jsx` | Toggle **Papan ↔ Timeline** di header; board move dialihkan ke `rescheduleSchedule`. |

### Model posisi blok (kunci korektnes)
Blok **direkonstruksi** dari `schedule_date` + shift window + urutan `planned_queue_no`
+ `planned_hours` (bukan mengandalkan `planned_start_datetime` mentah). Alasan:
tangga bebas-tumpang-tindih, cocok **persis** dengan akuntansi kapasitas (I1), dan
kebal terhadap datetime basi/legacy-null (1 baris Mei null).
- **Kantong batch (I1):** mereservasi `batch_capacity_hours` **satu kali** di slot;
  op anggota digambar bersarang di dalam container ungu. Offset slot maju sebesar
  kapasitas kantong, bukan jumlah jam anggota.
- **Cross-midnight (I4):** blok yang jangkauannya melewati tengah malam digambar
  sebagai **satu blok kontinu** melintasi garis pemisah hari (sumbu waktu kontinu,
  tanpa gap antar hari) — dihitung sekali. Ditandai ikon 🌙.
- **Overtime:** pakai `overtime_start/end_datetime` sendiri (NOT NULL), di **track
  ekor** bawah lane, warna amber (approved solid / pending diarsir).
- **Plan ≠ Actual (I3):** timeline ini murni lapisan **rencana**. Tidak ada overlay
  aktual (itu F6). Reschedule tak menyentuh data aktual.

### Insight sekilas (§B7)
Chip ringkas + legenda: total jam plan, OT pending, **jumlah slot over-kapasitas**
(slot band ditint merah), jumlah **mesin idle** (lane dilabeli), jumlah blok
**lintas tengah malam**. Warna status: `emerald/blue` = planned, `amber` = partial,
`red` = unplanned, `violet` = batch, `amber` = overtime.

---

## 2. Cara menjalankan
```bash
cd apps/api && node server.js         # atau npx nodemon server.js
cd apps/web && npm run dev            # http://localhost:5173
```
Buka **Operations Hub → SOW Machine Schedule** (salvaging). Di header ada toggle
**Papan / Timeline**.

---

## 3. Skenario uji

### A. Tampil lintas hari & shift
1. Klik **Timeline**. Default rentang **3 hari** mulai hari ini.
2. Ganti tanggal mulai ke **2026-07-01** (data contoh ada di 2–3 Juli). Blok jadwal
   muncul di lane mesin masing-masing (BBL01, BBL03, dll), diposisikan di jam shift.
3. Toggle **3 hari / 7 hari**, tombol **◀ ▶** geser rentang, **Hari ini** reset,
   **zoom +/-** memperbesar/perkecil skala waktu. Cari mesin mempersempit lane.

### B. Kantong batch (I1)
1. Cari tanggal yang punya batch (mis. **2026-07-02**, BBL01 punya batch #8).
2. Kantong tampil sebagai **container ungu** berisi op-op anggota bersarang.
   Lebar container = `batch_capacity_hours` (bukan jumlah jam anggota). Hover →
   tooltip `used/cap · n ops`. Bila anggota melebihi kapasitas → ikon ⚠️.

### C. Reschedule via DnD (I2)
1. Seret sebuah blok jadwal (yang punya handle) ke **slot shift lain** — mesin
   berbeda atau hari berbeda. Slot yang di-hover ter-highlight biru.
2. Lepas → toast "Jadwal dipindahkan", timeline refetch, blok pindah ke slot baru,
   **ditempatkan setelah jam yang sudah terpakai** di slot itu.
3. Verifikasi datetime ikut benar (backend menghitung ulang):
```bash
# pindah id 40 -> BBL03 / 2026-07-04 / shift 2 (16:00-23:00)
curl -s -X POST http://localhost:3001/sow-schedule/40/reschedule \
  -H "content-type: application/json" -H "x-user-role: administrator" -H "x-user-id: 1" \
  -d '{"machine_code":"BBL03","schedule_date":"2026-07-04","shift_id":2}'
#   => planned_start_datetime "2026-07-04 16:00:00+08", end "...16:30..."
# pindah ke slot yang sudah terisi -> start = setelah jam terpakai (mis. 15:00)
```
> Board (mode Papan) memindah jadwal juga lewat endpoint yang sama — datetime tak
> lagi basi setelah move.

### D. Cross-midnight (I4)
Belum ada shift yang `crosses_midnight=true` di data saat ini (semua `false`), jadi
blok normal belum melewati tengah malam. Untuk membuktikan render kontinu: buat/aktifkan
shift dengan `crosses_midnight=true` (mis. 22:00–06:00) lalu jadwalkan op yang jamnya
mendorong melewati 24:00 → blok tergambar **menerus** melintasi garis hari, ditandai 🌙,
dan chip "Lintas tengah malam" bertambah. (Overtime cross-midnight sudah didukung via
datetime-nya.)

### E. Insight
- Isi sebuah slot melebihi kapasitasnya → band slot **ter-tint merah** & chip
  "Slot over-kapasitas" bertambah.
- Mesin tanpa jadwal di rentang → lane berlabel **Idle**.
- Klik blok apa pun → panel detail kanan (order, op, jam, shift, tanggal, status).

### F. Tidak merusak papan (regresi)
Toggle balik ke **Papan** → board harian lama tetap berfungsi penuh (DnD, batch,
overtime, approval). Akuntansi kapasitas (I1) identik sebelum/sesudah.

---

## 4. Batas / catatan
1. **Rekonstruksi posisi** sengaja mengabaikan `planned_start_datetime` mentah demi
   tangga bebas-tumpang-tindih & konsisten I1. Datetime tetap dijaga benar oleh
   endpoint reschedule untuk konsumen lain (report).
2. **Capacity per hari** di-fetch per tanggal (`getCapacity` single-date) — untuk 3–7
   hari × mesin kecil, ringan. Bila data membesar, pertimbangkan endpoint range.
3. **DnD** memindah **blok tak-berbatch** ke slot shift. Reorder dalam slot &
   drag manpower ke overtime tetap di mode Papan (tak diduplikasi di timeline).
4. **Overlay aktual di timeline (C6)** & **re-plan sadar (C7)** = F6, belum di sini.
5. `is_overtime` schedule ditolak reschedule (overtime dikelola via request-nya).

---

## 5. Acceptance criteria F5 (master plan §8)
- [x] Timeline menampilkan beban lintas hari & lintas shift.
- [x] Cross-midnight = satu blok kontinu, batas hari/shift jelas, tidak dobel (I4).
- [x] DnD berfungsi di timeline; batch digambar sebagai container (I1).
- [x] Insight §B7 terbaca sekilas dengan legenda.
