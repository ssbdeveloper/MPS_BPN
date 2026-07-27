---
type: plan
status: planning
tags: [meta, vault, housekeeping, domain/vault]
updated: 2026-07-24
---

# Pembenahan Obsidian Vault + Pengelolaan .md

> Plan housekeeping vault `docs/`. Dikerjakan nanti oleh owner. Dasar aturan: [[KONVENSI]].
> Peta: [[00-INDEX]] · papan: [[PLANNING]].

## Kenapa

Audit 2026-07-24 (bandingkan `docs/` di disk vs klaim CLAUDE.md) menemukan drift:

- **64 dari 92 file `.md` punya NOL `[[wikilink]]`** — graph Obsidian nyaris tak terbentuk;
  mayoritas dokumen jadi pulau. Terkonsentrasi di `_isolasi/` (17), `operations/` (12),
  `timesheet/` (7), `security/` (5), `Work Instruction/` (5), `sap/` (3), `deployment/` (3).
- **4 folder ada di disk tapi tak disebut CLAUDE.md:** `_isolasi/`, `planning/` (huruf kecil,
  beda dari `PLANNING.md`), `prd/`, `salvaging/`.
- **Dua tempat klaim `docs/` di CLAUDE.md tidak sinkron & tidak lengkap:** "Monorepo
  Structure" (§tree) hanya menyebut `operations/ sap/ frontend/ deployment/ archive/ Work
  Instruction/ security/ timesheet/` — **tak menyebut `concepts/`, `log/`, `planning/`,
  `prd/`, `salvaging/`, `_isolasi/`**. "Dokumentasi & Second Brain" (§SB) menyebut
  `concepts/ log/ KONVENSI PLANNING 00-INDEX` tapi bukan folder lain. Kedua daftar tak
  saling menutup.
- **`00-INDEX.md` sempat stale** (frontmatter 2026-07-11, tak mendaftar konsep mch & log
  07-22+). Sudah sebagian dibetulkan 2026-07-24 saat menulis cluster guard-overlapping —
  tapi masih banyak dokumen yang belum tercapai dari INDEX ≤2 lompatan.

## Keputusan yang harus diambil owner (bukan mekanis)

1. **Aturan wikilink di CLAUDE.md — perkuat atau tidak?** Sekarang kata "wikilink"/`[[]]`
   **tidak muncul** di CLAUDE.md; aturannya cuma di [[KONVENSI]] §2 (satu lompatan jauh).
   Pemicunya "sesi kerja signifikan" (subjektif), bukan "setiap perubahan code". Draf
   penguatan sudah dibuat (lihat riwayat chat 2026-07-24) — perlu di-ACC.
2. **Brainstorming belum punya rumah.** Vault cuma punya `concepts/` (menetap) + `log/`
   (kejadian) + doc rencana `status: draft`. Kalau mau lane `status: brainstorm` atau folder
   `brainstorm/`, itu konvensi BARU → sekalian update [[KONVENSI]] §3.
3. **`_isolasi/` — deadline hapus 2026-09-01** ([[_isolasi/README]]). 17 file, semua nol
   wikilink. Putuskan per file: angkat ke concept/plan aktif, atau buang.

## Backlog kerja (mekanis, setelah keputusan di atas)

- [ ] Samakan klaim `docs/` di CLAUDE.md (§tree + §SB) → satu daftar folder lengkap & benar.
- [ ] Daftarkan folder tak-tertaut ke [[00-INDEX]]: `planning/`, `prd/`, `salvaging/` (dan
      putuskan nasib `_isolasi/`).
- [ ] Target: tiap plan/concept/log **wajib** minimal 1 wikilink + tercapai dari INDEX ≤2 hop.
      Prioritas file "hidup" dulu (plan aktif, concept), bukan arsip.
- [ ] `REFACTOR_PLAN.md` & `MSPROJECT_PWA_LITE_PLAN.md` (root, nol wikilink) → tautkan atau
      tandai `status: superseded`.
- [ ] `log/2026-07-22-ews-uptime-hmi-live.md` — satu-satunya LOG tanpa wikilink → tautkan ke
      konsep/plan EWS.
- [ ] Konsolidasi duplikat cheatsheet: `archive/mpsobsidian/cheatsheet.md` (masih diedit) vs
      `operations/cheatsheet.md` — merge, sisakan satu (anti-drift [[KONVENSI]] §6).
- [ ] Bedakan `docs/planning/` (folder) vs `docs/PLANNING.md` (papan) — nama membingungkan;
      pertimbangkan rename folder atau pindahkan isinya.

## Non-goal (sekarang)

Tidak menyentuh isi teknis dokumen; ini murni struktur + tautan + aturan. Tidak menghapus
apa pun tanpa keputusan owner (khusus `_isolasi/` tunggu deadline).

## Terhubung

[[KONVENSI]] · [[00-INDEX]] · [[PLANNING]] · [[_isolasi/README]]
