---
type: log
date: 2026-09-05
tags: [meta, gate, domain/ops, domain/vault]
---

# Audit + perombakan kontrak agen: CLAUDE.md, AGENTS.md, dan gate T0

Sesi audit atas permintaan owner: apakah CLAUDE.md dan AGENTS.md sudah layak jadi aturan baku.
Jawabannya tidak — strukturnya bagus tapi hampir seluruh penegakannya fiktif. Sesi ini menulis
ulang kontraknya dan membangun penegakan yang benar-benar jalan.

## Yang ditemukan (diverifikasi ke repo, bukan pembacaan dokumen)

1. **T0 tidak ada.** `CLAUDE.md` mengklaim gate berjalan "in pre-commit and CI". `.git/hooks/`
   hanya punya `post-checkout` dan `post-commit`; `.github/workflows/` hanya
   `android-heartbeat.yml`. Dokumen melanggar kalimatnya sendiri: *"an unenforced rule is a
   suggestion"*.
2. **`gate.mjs` tidak pernah bisa lulus.** `npm --prefix apps/web run lint` = **105 error**.
   Selama gate memanggil `eslint .`, setiap commit gagal.
3. **Gate memeriksa file utuh, bukan diff.** `deslop --all` = **1.722 error di 115 dari 177
   file**. Menyentuh satu baris di 65% file mana pun akan memblokir commit karena pelanggaran
   warisan. Ini penyebab paling masuk akal kenapa hook tidak pernah dipasang.
4. **AGENTS.md sudah drift lagi.** STOP list CLAUDE.md 7 item, salinan di AGENTS.md hanya 5 —
   yang hilang justru "jangan hapus file / rename komponen lintas halaman" dan "jangan ubah
   business behaviour saat task-nya UI". Kebijakan "mirror manual" gagal persis seperti
   pendahulunya.
5. **Referensi mati.** `.claude/commands/` tidak ada (6 command fiktif).
   `docs/planning/API-PERF-BACKLOG.md` tidak ada padahal dirujuk 3× sebagai tujuan wajib.
6. **Test tidak disebut sama sekali** — padahal `vitest` terpasang, 10 file test, 43 test hijau.
   DoD memverifikasi focus ring dan viewport tapi nol verifikasi kebenaran angka, di sistem yang
   memposting jam ke SAP.
7. **DoD bisa lulus dengan index kosong** — `deslop --staged` membaca `git diff --cached`; tanpa
   `git add`, hasilnya "0 file checked" lalu `gate passed`.
8. **Deskripsi Track A guard salah** — dokumen bilang hanya `fetch(`; sebenarnya juga `axios`,
   `WebSocket`, `EventSource`, dan **`setInterval(`**, serta membatasi diff ke `apps/web/` +
   `docs/`.
9. **`apps/web/src/OperationsHubIcon.jsx` tidak bisa di-parse** — 13 baris potongan JSX tanpa
   import/komponen/export, ter-commit. ESLint mencatatnya sebagai `parse-error`.
10. **BLOCKER TERBESAR — mesin penegaknya tidak ada di git.** `scripts/` dihapus dari index di
    commit `65e5afc` dan tidak pernah dikembalikan; `docs/` hanya punya **4 file** ter-track dari
    ratusan. Di `HEAD` tidak ada `gate.mjs`, `deslop.mjs`, `deploy.sh`, tidak ada satu pun
    `docs/standards/*` maupun `docs/concepts/*`. Semua aturan menunjuk file yang hanya ada di
    satu mesin. `.claude/` juga di-gitignore.

## Yang dikerjakan

**Tooling (baru / ditulis ulang):**

- `scripts/deslop.mjs` — sekarang **diff-aware**. Mode `--staged`/`--range` hanya memeriksa baris
  yang ditambah/diubah. File baru diperiksa penuh. Aturan level-file (C13 panjang, C14 className
  duplikat) jadi *warning* di file lama, *error* di file baru. Uji: menambah satu baris bersih ke
  `ReconciliationPanel.jsx` (68 error warisan) → **0 error**; file baru yang melanggar → diblokir.
- `scripts/lint-gate.mjs` (baru) — ratchet ESLint terhadap `scripts/lint-baseline.json`. Gagal
  hanya bila sebuah file **bertambah** error. Unitnya per (file, rule) sehingga tahan geseran
  baris. Baseline: 65 error di 29 file.
- `scripts/mirror.mjs` (baru) — memverifikasi blok `<!-- MIRROR:id -->` di AGENTS.md identik
  dengan CLAUDE.md. `--fix` menulis ulang dari sumber. Duplikasi berhenti jadi janji, jadi T0.
- `scripts/gate.mjs` — urutan baru: mirror → design contract → (track-a) → **eslint ratchet** →
  **tests** → build. Tiga langkah terakhir dilewati bila diff tidak menyentuh `apps/web`.
  Memperingatkan bila index kosong.
- `scripts/hooks/pre-commit` — memanggil `gate.mjs --fast`. **Sudah dipasang** ke
  `.git/hooks/pre-commit`.
- `.github/workflows/gate.yml` (baru) — gate diff-scoped pada PR dan push, plus laporan utang
  yang tidak memblokir.
- `apps/web/eslint.config.js` — `dev-dist` dan `coverage` masuk `globalIgnores` (output build
  ikut di-lint, 40 dari 105 error datang dari sana).

**Dokumen aturan:**

- `CLAUDE.md` ditulis ulang: verifikasi tier table, blocker git di §3, STOP list jadi 8 item
  (menambah "jangan melemahkan gate"), DoD menuntut test + staging + pencatatan konsep, §7 baru
  soal pelaporan jujur dan prosedur revert, §11 baru soal ratchet + angka utang, §12 aturan
  bahasa, pembagian wewenang dengan KONVENSI.
- `AGENTS.md` ditulis ulang: pointer tipis + **empat blok mirror** yang dicek mesin. Bagian
  History mencatat kegagalan mirror manual supaya alasannya tidak hilang lagi.
- `.claude/commands/` — 6 command yang selama ini fiktif kini ditulis: `/spec`, `/ui-audit`,
  `/ui-component`, `/ui-page`, `/deslop`, `/api-perf`.
- `docs/planning/API-PERF-BACKLOG.md` (baru) dan `docs/planning/UI-DEBT.md` (baru, berisi angka
  utang per rule dan 10 file terparah).
- `docs/standards/anti-slop.md` — §6 Tests, §7 "Debt that is not yours".
- `docs/KONVENSI.md` — pembagian wewenang dengan CLAUDE.md; kewajiban update `concepts/`
  ditegaskan sebagai bagian DoD.
- `.gitignore` — `.claude/commands/` boleh di-track.

## Verifikasi

| Uji | Hasil |
|---|---|
| `node scripts/mirror.mjs` | 4 blok identik |
| mirror drift dibuat sengaja | terdeteksi, `--fix` mengembalikan byte-identical |
| file baru melanggar, di-stage | diblokir (C1, C3, C7) |
| satu baris bersih di file legacy 68-error | 0 error, 1 warning informatif |
| `node scripts/gate.mjs --fast` (4 file ter-stage) | **lulus**, 4 langkah, 43 test hijau |

## Pending — keputusan owner

1. **`scripts/` dan `docs/` harus di-commit** supaya gate ada di clone lain dan CI bisa jalan.
   Sampai itu terjadi `.github/workflows/gate.yml` akan gagal di run pertama. Ini keputusan
   manusia karena mempublikasikan dokumen ke remote GitHub publik — perlu disaring dulu
   (`docs/security/`, `docs/my raw task/`, `tools/*.7z`, `samples/`, `.hermes/`).
2. **Hapus `apps/web/src/OperationsHubIcon.jsx`?** Menghapus file ada di STOP list.
3. **`assets/travelcard.html` vs `templates/travel-card.html`** — dua travel card, cek mana yang
   mati.

Terkait: [[../planning/UI-DEBT]] · [[../planning/API-PERF-BACKLOG]] · [[../KONVENSI]] ·
[[../concepts/codebase-memory-graph-accuracy]]
