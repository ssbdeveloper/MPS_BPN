---
status: active
tags: [design, security, domain/security]
created: 2026-07-11
type: design
---

# Auth + RBAC Enforcement — Design (A-R1)

> Status: **DRAFT untuk review** · 2026-07-11
> Konteks: RBAC layer (matrix, manifest 137 route, resolver, guard) **sudah ada dan benar**.
> Satu-satunya yang rusak: identitas dipercaya dari header `x-user-id`/`x-user-role` (spoofable).
> Dokumen ini hanya menambal identitas + kredensial. Tidak membangun ulang RBAC.

---

## 1. Model token (keputusan inti)

**Hybrid — dua jenis identitas:**

### a. Manusia → token bertanda-tangan, terbit saat login, ber-expiry
- **Terbit SEKALI** saat `/auth/login` sukses — BUKAN di-generate tiap request.
- Tiap request **membawa** token; server **memverifikasi** tanda tangan + expiry
  (HMAC — mikrodetik, stateless, nol query DB untuk identitas).
- **Payload:** `{ sub: user.id, role, name, iat, exp }` — TANPA daftar permission
  (permission bisa berubah kapan pun; resolver existing tetap baca DB per write, tak berubah).
- **Expiry: 12 jam** — menutup satu shift penuh (Day 8h / Night 7h + overtime).
  Expired → login ulang besoknya. Tanpa refresh-token dulu (kesederhanaan > kenyamanan;
  bisa ditambah sliding-renewal nanti kalau terasa mengganggu).
- **Kenapa bukan statik:** bocor = akses permanen sampai rotasi manual; tidak ada batas
  shift; logout tidak bisa dipaksakan. Biaya menambah `exp` = nol. Tidak ada trade-off
  yang membenarkan statik untuk manusia.

### b. Mesin (VBA MS Project, script otomasi) → static service token
- Klien non-browser tidak bisa login interaktif → dapat **API key statik** per klien.
- Disimpan sebagai hash di env: `SERVICE_TOKENS="<sha256-hash>:msproject-vba:ppc_admin,..."`
  (token asli hanya di config klien; server simpan hash-nya).
- Dipresentasikan via header `Authorization: Bearer <token>`.
- Ter-map ke pseudo-user dengan role tetap → masuk resolver RBAC yang sama.
- Revoke = hapus entri + ganti token di klien. Rotasi dijadwalkan manual.

---

## 2. Transport: httpOnly cookie (bukan Bearer di frontend)

- Login sukses → `Set-Cookie: mps_auth=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`
  (+ `Secure` saat HTTPS).
- Frontend & `/api` satu origin di balik nginx → browser kirim cookie otomatis →
  **hampir nol perubahan frontend** (59 file fetch tidak perlu disentuh).
- `POST /auth/logout` → clear cookie.
- JS tidak bisa baca token (httpOnly) → kebal pencurian via XSS terhadap token.
- `sessionStorage.authUser` tetap dipakai UI untuk display/gate visual — tapi bukan
  lagi sumber kepercayaan server.
- Klien mesin pakai `Authorization: Bearer` (middleware cek cookie DULU, lalu header).

## 3. Kredensial: bcrypt dengan migrasi transparan

- Login: verifikasi hash existing (`sha256$…` atau plaintext lama) → bila cocok,
  **re-hash ke bcrypt** (`bcrypt$…`) dan simpan. Tidak ada reset massal, tidak ada
  perubahan skema (kolom `password_hash` menampung prefix apa pun).
- Setelah tanggal cutoff (mis. +30 hari): hapus fallback plaintext & sha256 dari kode —
  akun yang belum pernah login sejak itu di-reset manual oleh admin.

## 4. Middleware & perubahan kode

```
apps/api/middleware/authToken.js   (BARU, ±40 baris)
  cookie mps_auth ATAU Bearer → verifikasi → req.user = {id, role, name, via}
  gagal/absen → req.user = null (JANGAN 401 di sini — biar guard yang memutuskan)

apps/api/rbac/rbacGuard.js         (UBAH 2 baris + fase transisi)
  identitas: req.user?.id / req.user?.role
  TRANSISI (selama observasi): bila req.user null → fallback baca header lama
  + log "[RBAC] legacy-header-identity ..." → kelihatan siapa yang belum bertoken
  ENFORCE=1 → fallback header DIHAPUS (identitas hanya dari token)

apps/api/controllers/authController.js
  login: + bcrypt verify/rehash, + set cookie; logout endpoint baru

CORS: dari `*` → daftar origin eksplisit + credentials:true (wajib untuk cookie)
.env baru: AUTH_TOKEN_SECRET (32+ byte acak), SERVICE_TOKENS
```

**Yang TIDAK berubah:** manifest, matrix, resolver, allowlist operator
(POST /timesheet, checkout — tablet NFC tetap anonim by design), UI admin permission,
semua halaman frontend (kecuali tombol logout memanggil endpoint baru).

## 5. Rollout bertahap (tiap fase reversibel)

| Fase | Aksi | Rollback |
|---|---|---|
| 1 | bcrypt + cookie issuance + middleware (guard belum berubah) | revert commit |
| 2 | Guard baca req.user, fallback header + log transisi | revert commit |
| 3 | Observasi ≥1 minggu: pantau `legacy-header-identity` & `would-deny`; mint service token VBA; tambal manifest bolong | — |
| 4 | `RBAC_ENFORCE=1` + hapus fallback header | unset env |
| 5 (terpisah) | Gating READS — keputusan produk, bukan hanya teknis; susun manifest reads dari log dulu | — |

## 5b. Dampak ke alur NFC timesheet (diverifikasi dari kode, 2026-07-11)

**Inti alur NFC TIDAK terpengaruh.** "Login" NFC = `GET /usernfc/nfcid/:id` (read, tidak
digate s/d fase 5) + write yang sudah di-ALLOWLIST (`POST /timesheet`, `PUT /timesheet/
checkout|checkout-unprod|checkoutid`). Identitas operator tercatat di payload
(`serialnumber` = kartu NFC) — filosofi existing, dipertahankan. Panggilan TTS lewat
nginx → fastapi, di luar jangkauan guard Express.

**3 write shopfloor BELUM ter-allowlist** (kandidat 403 saat enforce — putuskan sebelum fase 4):
| Endpoint | Pemicu | Usulan |
|---|---|---|
| `PUT /sow/finish/` | operator menandai operasi selesai (checkout flow) | allowlist (aksi operator) |
| `POST /process-control` + `/items` | entri parameter proses di mesin | allowlist BILA diisi operator; kalau supervisor → biarkan di manifest |
| `PUT /usernfc/mode/:snssb` | toggle mode — pemicu belum dipastikan | konfirmasi dulu |

**Yang memang berubah (by design):** aksi supervisor di tablet — validation, post-to-sap,
PATCH/updateadmin timesheet, CRUD usernfc — hari ini hanya PIN sessionStorage (kosmetik);
setelah enforce butuh login sungguhan. Ini tujuan proyek, bukan efek samping.

## 6. Risiko yang diketahui

- **VBA MS Project** menulis ke `/ms-project` tanpa cookie → wajib service token
  sebelum fase 4 (atau route-nya di-allowlist sementara — kurang disukai).
- **Rotasi `AUTH_TOKEN_SECRET`** = semua sesi manusia logout serentak (diterima; jangan
  rotasi di tengah shift).
- **Jam server** dipakai untuk `exp` — pastikan NTP host API sehat.
- ETL/Python/Lambda **tidak terdampak** (tulis langsung ke DB, bukan via API).
- Reads tetap terbuka sampai fase 5 — enforcement writes TIDAK menutup kebocoran baca.

## 7. Pertanyaan terbuka untuk reviewer

1. Expiry 12 jam OK? (Alternatif: 8h ketat per shift, atau 24h longgar.)
2. Library: `jsonwebtoken` (1 dependency kecil, battle-tested) vs HMAC hand-rolled
   ±30 baris tanpa dependency. Rekomendasi: `jsonwebtoken`.
3. Cutoff penghapusan fallback sha256/plaintext: 30 hari cukup?
4. Daftar origin CORS produksi: apa saja? (nginx origin + IP tablet? — origin tablet
   sama dengan nginx kalau akses via domain/IP yang sama.)
