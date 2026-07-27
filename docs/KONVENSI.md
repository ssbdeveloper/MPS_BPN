---
type: ops
tags: [konvensi, meta, domain/vault]
updated: 2026-07-11
---

# Konvensi Vault — cara manusia & AI memakai second brain ini

> Rulebook singkat. Kalau ragu format, tiru dokumen yang sudah ada.

## 1. Empat lapisan

| Lapisan | Folder | Peran |
|---|---|---|
| Papan kerja | [[PLANNING]] | Apa yang aktif/menunggu/backlog/done — satu baris per rencana |
| Rencana & desain | `security/`, `salvaging/`, `timesheet/`, dll | Niat + alasan. Frontmatter `status:` |
| Log keputusan | `log/YYYY-MM-DD-topik.md` | **Memori episodik** — apa yang terjadi, kenapa, apa yang pending |
| Konsep | `concepts/` | **Memori semantik** — pengetahuan yang tetap benar, satu konsep per note, terus di-update |

## 2. Aturan link (yang membuat graph berguna)

- **Log → rencana yang dieksekusi + konsep yang tersentuh.** ("Sesi ini menjalankan [[REFACTOR_PLAN]], mengubah pemahaman di [[concepts/payroll-data-path]].")
- **Rencana → konsep yang jadi dasarnya.** Desain tanpa link ke konsep = tanda konsepnya belum ditulis.
- **Konsep → konsep terkait + log asal-usulnya.** Bagian "Asal-usul" menaut ke log tempat pengetahuan itu didapat.
- Semua dokumen harus tercapai dari [[00-INDEX]] dalam ≤ 2 lompatan.
- Link boleh menunjuk note yang belum ada — itu penanda "layak ditulis", bukan error.

## 3. Frontmatter (supaya bisa difilter mesin & Obsidian)

```yaml
type: plan | prd | design | feature | concept | log | uat | ops | moc
status: planning | active | done | parked   # HANYA dok kerja (plan/prd/design/feature); referensi tak berstatus
date: YYYY-MM-DD                                                    # untuk log
tags: [..]
```

**Status rencana bertahap:** `done` hanya bila SEMUA fase sudah rilis; sebagian fase rilis = `active`; `planning` = belum ada fase yang rilis.

**Tag domain (nested, di `tags:`):** satu domain utama per dokumen, maksimal dua bila lintas-domain.
`domain/ews` · `domain/sow` · `domain/timesheet` · `domain/sap` · `domain/msproject` · `domain/security` · `domain/ops` · `domain/vault`

## 4. Cara AI memakai vault ini (instruksi untuk sesi AI)

1. **Sebelum mendesain/menjawab soal sistem:** cari note `concepts/` dan log terkait dulu
   (grep). Jangan melitigasi ulang keputusan yang sudah tercatat — rujuk lognya.
2. **Setelah sesi kerja signifikan:** tulis `log/YYYY-MM-DD-topik.md` (keputusan, eksekusi,
   pending user), update baris [[PLANNING]], dan **update note konsep yang tersentuh** —
   kalau sesi mengubah pemahaman sistem, konsepnya yang diubah, bukan hanya lognya.
3. **Menemukan pengetahuan baru yang menetap** (bukan kejadian)? → buat/update
   `concepts/<nama>.md`, bukan menguburnya di log.
4. Status dokumen di frontmatter adalah sumber kebenaran; PLANNING hanya daftar link.

## 5. Cara MANUSIA me-review perjalanan development

- **Kronologis:** buka folder `log/` urut nama — itu timeline proyek.
- **Per topik:** buka note konsep → panel **Backlinks** Obsidian menampilkan semua
  log/rencana yang pernah menyentuhnya = sejarah topik itu.
- **Graph view:** node besar = konsep hub; klaster = domain (EWS, salvaging, payroll).
- Tidak butuh plugin apa pun. (Dataview opsional untuk tabel otomatis; AI tidak
  memakainya — AI pakai grep.)

## 6. Anti-pola

- ❌ Transkrip percakapan mentah di vault (noise; log = ringkasan keputusan).
- ❌ Pengetahuan menetap hanya di log ("di log 07-11 kan sudah ditulis…") — angkat ke concepts.
- ❌ Dua dokumen untuk satu kebenaran (penyakit drift — lihat riwayat schema dumps).
- ❌ Rencana tanpa `status:` di frontmatter.
