# Pembahasan Fitur Block Timesheet Tapping

## Ringkasan

Fitur ini membantu operator mengetahui apakah jam kerja yang direncanakan untuk sebuah job sudah habis atau belum.

Saat operator memilih job, sistem akan membandingkan:

- budget hours dari data SOW, dan
- actual hours yang sudah pernah dipakai dari timesheet.

Jika actual hours sudah mencapai atau melewati budget hours, sistem akan memberi peringatan.

## Yang Dilihat Operator

Saat memilih job:

- Jika budget hours masih tersedia, operator bisa lanjut seperti biasa.
- Jika budget hours kosong atau belum diisi, operator tetap bisa lanjut tanpa peringatan.
- Jika budget hours sudah habis, operator akan melihat peringatan bahwa budget hours telah habis.

## Dampak Ke Tombol Start

Jika budget hours sudah habis:

- tombol Start akan terkunci,
- operator tidak bisa memulai timesheet baru untuk job tersebut,
- operator bisa membuat request tambahan budget hours.

## Request Tambahan Jam

Di halaman menu timesheet akan tersedia tombol request tambahan jam.

Operator bisa mengisi:

- jumlah tambahan jam yang diminta, jika sudah tahu kebutuhannya,
- catatan alasan kenapa butuh tambahan jam.

Request tersebut akan tersimpan dan disiapkan untuk dikirim ke pihak terkait melalui email. 

## Tujuan Fitur

Fitur ini dibuat agar:

- pemakaian actual hours lebih terkontrol,
- job yang sudah melewati plan tidak terus berjalan tanpa informasi,
- kebutuhan tambahan jam punya catatan yang jelas,
- foreman atau admin bisa menindaklanjuti request tambahan jam dengan lebih mudah.
