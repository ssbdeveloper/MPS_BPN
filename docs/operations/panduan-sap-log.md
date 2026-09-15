---
type: ops
tags: [panduan, sap, user-guide, domain/sap]
updated: 2026-07-16
---

# Panduan Halaman SAP LOG

Panduan singkat untuk memantau dan memperbaiki jam kerja mesin yang dikirim ke SAP.
Ditulis untuk pemakai sehari-hari — tidak perlu paham teknis.

---

## 1. Halaman ini untuk apa?

Setiap hari, mesin mencatat jam kerja (siapa mengerjakan order apa, di mesin mana, berapa
lama). Sistem **mengirim data itu ke SAP secara otomatis**. Halaman **SAP LOG** adalah
tempat kamu:

- melihat apa yang **sudah terkirim** dan apa yang **gagal**,
- **melengkapi** data yang kurang (mis. operator belum terisi),
- **mengirim koreksi** untuk hari yang jamnya sudah terlanjur dikirim.

> 📷 **[ Screenshot: Halaman SAP LOG dengan tiga tab di bagian atas ]**

---

## 2. Yang berjalan OTOMATIS (kamu tidak perlu apa-apa)

Untuk keadaan normal, kamu **tidak perlu menekan apa pun**. Sistem sudah:

1. Mengumpulkan jam kerja setiap hari, dikelompokkan per operator / mesin / order.
2. Mengirimnya ke SAP dengan sendirinya.
3. **Hanya mengirim hari yang sudah selesai.** Hari yang masih berjalan (hari ini) ditahan
   dulu sampai besok, supaya jamnya lengkap.

Jadi kalau semua data lengkap dan tidak ada yang gagal, halaman ini cukup **dipantau saja**.

---

## 3. Tiga tab, apa bedanya

| Tab | Isinya | Kapan dibuka |
|---|---|---|
| **SAP Posting** | Status kiriman: berapa terkirim, menunggu, gagal | Untuk memantau & menangani yang gagal |
| **Operator Hours** | Jam per operator per hari (peta warna) | Untuk melengkapi data yang kurang |
| **Corrections** | Koreksi untuk hari yang sudah terkirim | Untuk mengirim koreksi secara manual |

> 📷 **[ Screenshot: Tiga tab — SAP Posting, Operator Hours, Corrections ]**

---

## 4. Membaca tab SAP Posting

Di atas ada empat kartu ringkasan:

- **Posted** — sudah terkirim ke SAP (hijau).
- **Pending** — menunggu giliran dikirim (kuning).
- **Failed** — gagal dikirim, perlu perhatian (merah).
- **Queue total** — total di antrian.

Kalau ada yang **Failed**, muncul kotak **"Needs action"** yang menjelaskan **penyebabnya
dengan bahasa biasa** (bukan kode error), misalnya: "Cost center belum di-set" atau
"Order sudah ditutup di SAP".

> 📷 **[ Screenshot: Kartu ringkasan + kotak "Needs action" yang menampilkan sebab kegagalan ]**

---

## 5. Kapan kamu perlu turun tangan

### Skenario A — Ada kiriman yang GAGAL (Failed)

1. Buka tab **SAP Posting**.
2. Lihat kotak **"Needs action"** — di situ tertulis sebabnya dan apa yang harus diperbaiki.
3. Perbaiki penyebabnya (biasanya di sisi SAP — mis. minta tim SAP mendaftarkan cost center
   atau work center). Sebagian besar kegagalan bukan karena aplikasi ini, tapi data master
   di SAP.
4. Setelah beres, tekan tombol **"Retry failed"** untuk mengirim ulang.

> 📷 **[ Screenshot: Tombol "Retry failed" dan daftar record yang gagal ]**

---

### Skenario B — Jam operator belum lengkap (operator/job kosong)

Kadang mesin mencatat jam kerja tapi **operatornya tidak terbaca** atau **order-nya tidak
cocok**. Data seperti ini tidak bisa dikirim ke SAP sampai dilengkapi.

1. Buka tab **Operator Hours**. Ini peta warna: baris = operator, kolom = tanggal.
   Baris **"No operator"** (merah) menandakan jam kerja tanpa pemilik.
2. **Klik sel** yang mau diperiksa → muncul daftar record hari itu.
3. Pada record yang perlu diperbaiki, tekan tombol **pensil**.
4. Pilih **Operator** (cari nama/SNSSB) atau **Job** (cari order/operasi) yang benar, lalu
   pilih dari daftar.
5. Setelah selesai memperbaiki, buka tab **Corrections** dan tekan **"Stage edited
   records"** supaya perbaikanmu masuk antrian kirim.

> 📷 **[ Screenshot: Peta warna Operator Hours ]**

> 📷 **[ Screenshot: Panel edit — pilih Job / Operator ]**

---

### Skenario C — Koreksi untuk hari yang SUDAH terkirim

Kalau kamu melengkapi data untuk hari yang **jamnya sudah terlanjur dikirim ke SAP**, sistem
tidak mengubah kiriman lama (itu sudah masuk payroll). Sebagai gantinya, tambahan jam itu
menjadi **koreksi** yang harus kamu **kirim manual**.

1. Buka tab **Corrections**.
2. Tekan **"Stage edited records"** — sistem menyiapkan koreksi dari data yang kamu edit.
   Tunggu sebentar, lalu tekan tombol refresh.
3. Koreksi muncul di daftar. **Centang** yang mau dikirim (bisa pilih beberapa).
4. Tekan **"Post selected"**.
5. Sistem **menambahkan** jam itu ke order di SAP — tidak menghapus atau menimpa yang lama.

> 📷 **[ Screenshot: Tab Corrections — daftar koreksi + tombol "Post selected" ]**

**Tips:** cara paling mudah menghindari koreksi adalah **melengkapi data pada hari yang
sama**, sebelum jamnya dikirim otomatis (besoknya). Koreksi hanya perlu untuk perbaikan yang
terlambat.

---

## 6. Fitur bantu di tiap tab

- **Filter status** — tampilkan hanya Posted / Pending / Failed, dll.
- **Filter tanggal (From/To)** — batasi rentang tanggal.
- **Search** — cari berdasarkan nomor order, pegawai, atau mesin.
- **Sort** — urutkan (tanggal terbaru, jam terbanyak, nomor order).
- **Refresh** — muat ulang data terbaru.

> 📷 **[ Screenshot: Baris filter — status, tanggal, search, sort ]**

---

## 7. Arti istilah singkat

| Istilah | Artinya |
|---|---|
| **Posted** | Sudah terkirim ke SAP |
| **Pending** | Menunggu giliran dikirim (otomatis) |
| **Posting** | Sedang dikirim |
| **Failed** | Gagal dikirim — perlu perbaikan |
| **Skipped** | Dilewati (mis. perlu dibatalkan dulu di SAP) |
| **Correction** | Koreksi jam untuk hari yang sudah terkirim — dikirim manual |

---

## 8. Kalau ragu

- Kegagalan yang menyebut **cost center / work center / PERNR / TECO** hampir selalu soal
  **data master di SAP** — sampaikan ke tim SAP, bukan diperbaiki di aplikasi ini.
- Kalau sebuah kiriman **sudah masuk SAP** tapi ternyata salah, itu perlu **dibatalkan
  (storno) di SAP** lebih dulu — aplikasi ini sengaja tidak menimpa data yang sudah dibayar.
- Kalau bingung, catat nomor order + tanggal + pesan yang muncul, lalu tanyakan ke admin.
