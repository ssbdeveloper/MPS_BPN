# Panduan Pengguna — EWS (Early Warning System)

> Panduan ini ditulis untuk **pengguna awam** (foreman, supervisor, PPIC, manajemen).
> Tidak perlu paham database atau kode. Tujuannya: bisa **membaca dashboard EWS**,
> mengerti **arti tiap angka**, tahu **dari mana datanya**, dan tahu **apa yang harus dilakukan**
> saat sebuah indikator berwarna merah.

---

## 1. Apa itu EWS?

**EWS (Early Warning System)** adalah papan pemantau (dashboard) yang memberi **peringatan dini**
kalau ada yang tidak beres di lantai produksi — sebelum masalahnya membesar.

EWS **tidak menghukum orang**. Ia menunjukkan **di mana** ada kesenjangan (gap) supaya bisa
segera ditindaklanjuti: apakah masalahnya di **manusia** (input timesheet, kehadiran) atau di
**mesin** (nganggur, data hilang).

Dashboard EWS muncul di halaman **Operations Hub** (papan besar berisi 8 kartu), dan tiap kartu
bisa diklik untuk melihat **halaman Detail**.

---

## 2. Struktur EWS: 8 Indikator, 2 Kelompok

EWS terdiri dari **8 KPI** (Key Performance Indicator / indikator kunci), dibagi jadi **2 baris**:

### Baris 1 — LABOUR (sisi Manusia / Operator)
| KPI | Arti singkat |
|-----|--------------|
| **Uptime Tablet** | Tablet operator online / terhubung |
| **Accuracy Labour** | Data timesheet benar & lengkap |
| **Adoption Labour** | Operator benar-benar mengisi timesheet |
| **OLE** | Seberapa produktif jam kerja operator |

### Baris 2 — MACHINE (sisi Mesin)
| KPI | Arti singkat |
|-----|--------------|
| **Uptime HMI** | Layar/HMI mesin online / terhubung |
| **Accuracy Machine** | Data mesin lengkap & berpasangan |
| **Adoption Machine** | Waktu mesin terpakai produktif, bukan nganggur |
| **OEE** | Seberapa efektif mesin dipakai |

Tiap KPI berupa **persentase (%)**. Semakin tinggi semakin baik. Tiap KPI punya **target**.

---

## 3. Cara Membaca Kartu KPI

Setiap kartu di Operations Hub menampilkan:

```
┌──────────────────────────────┐
│ [ikon]  Adoption Labour      │  ← nama KPI
│                              │
│   66.0%          ▼ Prev 70   │  ← angka besar + panah tren vs kemarin/sebelumnya
│   ▁▂▃▅▆  (garis kecil)     │  ← sparkline: tren 7 hari terakhir
│   Target 95%   CRITICAL      │  ← target + status
└──────────────────────────────┘
```

### Arti WARNA (paling penting)
| Warna | Status | Arti |
|-------|--------|------|
| 🟢 Hijau | **NORMAL** | Sehat, di atas / sama dengan target |
| 🟡 Kuning | **WATCH** | Perlu diperhatikan, mulai turun di bawah target |
| 🔴 Merah | **CRITICAL** | Bermasalah, jauh di bawah target — perlu tindakan |
| ⚪ Abu-abu | **NO DATA** | Belum ada data / belum bisa dihitung saat ini |

### Panah tren (▲ ▼ ■)
- **▲ hijau** = naik dibanding periode sebelumnya (membaik)
- **▼ merah** = turun (memburuk)
- **■ abu-abu** = datar / tidak berubah

### Sparkline (garis kecil)
Grafik mini yang menunjukkan **pergerakan 7 hari terakhir**. Berguna untuk melihat apakah
masalahnya baru muncul hari ini atau sudah berlangsung beberapa hari.

---

## 4. Ambang Warna & Target Tiap KPI

Warna kartu ditentukan otomatis dari angka vs ambang berikut:

| KPI | 🟢 Normal (≥) | 🟡 Watch | 🔴 Critical (<) |
|-----|:---:|:---:|:---:|
| Uptime Tablet | 99% | 98–99% | 98% |
| Uptime HMI | 99% | 98–99% | 98% |
| Accuracy Labour | 98% | 95–98% | 95% |
| Accuracy Machine | 98% | 95–98% | 95% |
| Adoption Labour | 95% | 90–95% | 90% |
| Adoption Machine | 95% | 90–95% | 90% |
| OEE | 80% | 65–80% | 65% |
| OLE | 85% | 70–85% | 70% |

> Contoh: Adoption Labour 66% → di bawah 90% → **CRITICAL (merah)**.

---

## 5. Penjelasan Tiap KPI — Arti, Cara Hitung, Sumber Data

> Rumus ditulis sederhana. Intinya: **hampir semua KPI = "yang bagus" dibagi "total", dikali 100**.

### 5.1 🧑‍🏭 LABOUR (Manusia)

#### **Uptime Tablet** — *target 99%*
- **Arti:** Persentase waktu tablet operator online/terhubung.
- **Status saat ini:** ⚪ **Sedang disiapkan** — belum menampilkan angka (No Data). Akan aktif di tahap berikutnya.
- **Owner:** IT.

#### **Accuracy Labour** — *target 98%*
- **Arti:** Seberapa **benar dan lengkap** data timesheet yang diisi operator (order & operasi valid, siap dikirim ke SAP).
- **Cara hitung:** `(jumlah record timesheet yang valid / total record) × 100`.
- **Contoh baca:** "135 / 135 eligible for SAP" = semua 135 record bersih → 100%.
- **Sumber data:** input **timesheet operator**, dicocokkan dengan **daftar order (SAP)**.
- **Kalau merah:** ada timesheet salah/kurang lengkap (order/operasi tidak cocok). Foreman koreksi datanya.
- **Owner:** Foreman / Supervisor.

#### **Adoption Labour** — *target 95%*
- **Arti:** Apakah operator yang **terjadwal masuk** benar-benar **mengisi timesheet** sesuai jam kerjanya.
- **Cara hitung (progresif):**
  `Adoption = (jumlah jam yang benar-benar diinput / jumlah jam yang seharusnya sudah diinput sampai jam ini) × 100`
  - "Jam yang seharusnya" **tumbuh sepanjang shift** — jam 10 pagi beda dengan jam 3 sore.
  - Operator terjadwal yang **belum input sama sekali** dihitung 0 (menekan angka).
  - Operator **cuti/sakit/izin/off** dikeluarkan dari hitungan (tidak dihukum).
- **Cara baca:** "37/45 sudah input, 8 belum, 46 belum mulai" = dari 45 operator shift siang, 37 sudah mengisi, 8 belum, dan 46 operator shift malam belum mulai kerja.
- **Sumber data:** **jadwal roster operator** + **input timesheet**.
- **Penting:** Angka ini **wajar rendah/merah di siang hari** karena banyak operator baru akan input di sore/akhir shift. Ia **naik sepanjang hari** dan menjadi angka final saat shift tutup.
- **Owner:** Foreman / Supervisor.

#### **OLE (Overall Labour Effectiveness)** — *target 85%*
- **Arti:** Dari total jam yang tercatat operator, berapa persen yang **benar-benar produktif** (mengerjakan order), bukan menunggu/nganggur.
- **Cara hitung:** `(jam produktif / jam tercatat) × 100`.
- **Cara baca:** "42.9h productive / 62.8h recorded" = 42,9 jam produktif dari 62,8 jam tercatat → ±68%.
- **Sumber data:** **input timesheet operator** (jenis aktivitas: produktif vs menunggu/idle ).
-  -"Waiting Job" Dikeluarkan
- **Kalau merah:** banyak waktu operator habis untuk menunggu material/setup, bukan produksi. Cek alur kerja & kesiapan material.
- **Owner:** Foreman / Supervisor / PPIC.

### 5.2 ⚙️ MACHINE (Mesin)

#### **Uptime HMI** — *target 99%*
- **Arti:** Persentase waktu layar/HMI mesin online/terhubung.
- **Status saat ini:** ⚪ **Sedang disiapkan** — belum menampilkan angka (No Data).
- **Owner:** IT.

#### **Accuracy Machine** — *target 98%*
- **Arti:** Apakah setiap **data produksi mesin** punya **pasangan data transaksinya** (data tidak bolong).
- **Cara hitung:** `(record mesin yang berpasangan / total record mesin) × 100`.
- **Cara baca:** "70 / 108 matched machine records" = 70 dari 108 record cocok → ±65%.
- **Sumber data:** **data produksi mesin** vs **data transaksi mesin** (dari sistem mesin/SCADA).
- **Kalau merah:** ada aliran data mesin yang **macet/tertunda** sehingga sebagian data tidak berpasangan. Ini masalah **teknis/ETL**, bukan salah operator — laporkan ke IT/PPIC.
- **Owner:** Foreman / Supervisor.

#### **Adoption Machine** — *target 95%*
- **Arti:** Dari total waktu mesin berjalan, berapa persen yang **produktif** (bukan nganggur atau tak teridentifikasi).
- **Cara hitung:** `Adoption = 100% − Gap%`, dengan `Gap = Unidentified + IDLE`.
  - **Unidentified** = mesin jalan tapi **tidak ada job/operator teridentifikasi**.
  - **IDLE** = mesin dalam kondisi menganggur (**M2**) lebih dari **5 menit**.
- **Cara baca:** "1.48h adoption gap / 146h machine duration" = hanya 1,48 jam gap dari 146 jam → ±99%.
- **Sumber data:** **data produksi mesin** (status tiap mesin per waktu).
- **Owner:** Foreman / Supervisor / PPIC.

#### **OEE (Overall Equipment Effectiveness)** — *target 80%*
- **Arti:** Seberapa efektif mesin dipakai — dari waktu yang dihitung, berapa persen mesin **benar-benar running/produksi**.
- **Cara hitung:** `(jam running / jam terhitung) × 100` (waktu NoJob/Off dikeluarkan).
- **Cara baca:** "2.7h running / 2.8h counted" = 2,7 jam produksi dari 2,8 jam → ±96%.
- **Sumber data:** **data transaksi mesin**.
- **Kalau merah:** banyak downtime/setup panjang. Cek breakdown, setup, kesiapan material.
- **Owner:** Foreman / Supervisor / PPIC.

---

## 6. Konsep Penting yang Wajib Dipahami

### 6.1 "Hari ini" & jam shift
Angka EWS dihitung untuk **hari kerja berjalan (business date)**. Definisi shift:
- **Shift Siang (DAY):** 08:00 – 17:00 (8 jam kerja + 1 jam istirahat).
- **Shift Malam (NIGHT):** 20:00 – 04:00 keesokan hari (7 jam kerja + 1 jam istirahat).
- Check-in sebelum jam 07:00 pagi dianggap masih bagian **hari kemarin**.

### 6.2 Kenapa angka berubah sepanjang hari?
Beberapa KPI (terutama **Adoption Labour**) bersifat **progresif** — tumbuh seiring shift berjalan.
Jadi **wajar** kalau pagi hari terlihat rendah/merah lalu membaik menjelang sore. Angka menjadi
**final saat shift tutup**.

### 6.3 Data tidak real-time per detik
Dashboard diperbarui dari **snapshot yang dihitung otomatis setiap ±10 menit**. Jadi ada jeda
beberapa menit antara kejadian di lapangan dan angka di layar. Ini normal.

### 6.4 Kenapa ada yang "No Data" (abu-abu)?
- **Uptime Tablet & Uptime HMI**: fiturnya sedang disiapkan.
- KPI lain bisa No Data kalau memang belum ada aktivitas pada window tersebut (mis. shift malam belum mulai).

---

## 7. Halaman Detail (klik sebuah kartu)

Mengklik kartu membuka halaman **Detail** yang berisi:

1. **Kotak angka ringkas (tiles)** — pecahan angka utama KPI tsb.
2. **Grafik** — visual sumber masalah (lihat contoh di bawah).
3. **Issue Log** — daftar masalah yang terdeteksi + tingkat keparahan (Critical/Watch) + siapa pemiliknya.
4. **Action Summary** — ringkasan tindakan yang disarankan.

### Contoh: Detail **Adoption Machine** (2 grafik)
- **Grafik kiri — "Gap Adoption per Mesin (menit)":** batang per mesin, diurutkan dari yang paling
  bermasalah. Warna **merah = Unidentified**, **kuning (amber) = IDLE**. Tinggi batang = total menit
  waktu terbuang mesin itu.
- **Grafik kanan — "Adoption % per Mesin":** persentase adoption tiap mesin dibanding **target 95%**
  (garis putus-putus). Merah = di bawah 90%. Ini menunjukkan mesin mana yang **paling buruk secara
  proporsional** (bukan sekadar banyak menit).
- **Kartu insight di atas** memberi kesimpulan otomatis, mis. "IDLE = 92% dari total gap → masalahnya
  mesin nganggur, bukan input operator."

### Contoh: Detail **Adoption Labour** (tabel operator)
- **Kotak ringkas:** Sudah Input / Belum Log / Belum Mulai / Cuti-Izin-Off.
- **Tabel operator:** daftar operator, yang **belum input tampil di atas**, lengkap dengan nama, shift,
  jam yang sudah diinput, jam yang diharapkan, gap, dan status (badge **"Belum Log"** merah).
- Tombol **"Hanya yang bermasalah"** untuk menyaring hanya operator yang perlu ditindaklanjuti.

---

## 8. Siapa Menindaklanjuti Apa (Owner)

| KPI | Pemilik / Penanggung jawab |
|-----|----------------------------|
| Uptime Tablet, Uptime HMI | **IT** |
| Accuracy Labour, Accuracy Machine | **Foreman / Supervisor** |
| Adoption Labour | **Foreman / Supervisor** |
| Adoption Machine, OEE, OLE | **Foreman / Supervisor / PPIC** |

Kalau sebuah KPI **merah**, pemilik di atas yang pertama harus menindak. EWS akan
mengeskalasi otomatis kalau masalah dibiarkan terlalu lama.

---

## 9. Pertanyaan yang Sering Muncul (FAQ)

**T: Kenapa Adoption Labour merah padahal operator kerja?**
J: Karena bersifat progresif dan tanpa masa tenggang — operator yang belum sempat input dihitung 0
dulu. Angka akan naik sendiri saat mereka mengisi timesheet, dan final saat shift tutup.

**T: Kenapa Accuracy Machine tiba-tiba merah?**
J: Biasanya karena aliran data mesin (transaksi) **tertunda/macet**, sehingga sebagian data produksi
belum berpasangan. Ini masalah teknis (IT/ETL), bukan kesalahan operator. Akan pulih sendiri setelah
aliran data normal.

**T: Angka di dashboard beda dengan yang saya hitung manual, kenapa?**
J: Dashboard memakai snapshot ±10 menit lalu, dan menghitung per **business date** (termasuk aturan
shift malam yang melewati tengah malam). Perbedaan kecil itu wajar karena beda waktu potret data.

**T: Kartu abu-abu (No Data), rusak?**
J: Tidak. Uptime Tablet/HMI memang sedang disiapkan. KPI lain bisa No Data kalau belum ada aktivitas
pada periode itu.

**T: Kalau saya cuti/sakit, apakah menurunkan Adoption?**
J: Tidak. Status cuti/sakit/izin/off dikeluarkan dari perhitungan.

---

## 10. Ringkasan Sumber Data

| KPI | Sumber utama |
|-----|--------------|
| Accuracy Labour | Input timesheet operator + daftar order SAP |
| Adoption Labour | Jadwal roster operator + input timesheet |
| OLE | Input timesheet operator (produktif vs menunggu) |
| Accuracy Machine | Data produksi mesin vs data transaksi mesin |
| Adoption Machine | Data produksi mesin (status per waktu) |
| OEE | Data transaksi mesin |
| Uptime Tablet / HMI | (dalam pengembangan) status koneksi perangkat |

---

> **Intinya:** hijau = aman, kuning = awasi, merah = tindak. Klik kartu untuk tahu **siapa/mesin mana**
> penyebabnya. Angka pagi hari belum tentu buruk — beberapa memang tumbuh sepanjang shift.
