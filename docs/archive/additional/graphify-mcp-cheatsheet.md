# Graphify MCP — Referensi Tools & Pola Prompt

> Sumber: dokumentasi resmi Graphify Labs (`graphify.com/docs/mcp-tools` dan `graphify.com/docs/cli`), diakses 28 Juli 2026.
> Paket PyPI: **`graphifyy`** (dobel `y`), lisensi Apache 2.0, jalan on-device.

**Catatan penting sebelum lanjut:** nama "graphify" dipakai beberapa proyek berbeda. Dokumen ini khusus **Graphify Labs** (code knowledge graph untuk coding assistant). Jangan tertukar dengan `graphify-ts` (Madar), `safishamsi/graphify`, atau situs agregator `graphify.net` yang cuma mereview MCP server orang lain.

---

## 1. Konsep singkat

Graphify mem-parse repo jadi **knowledge graph** (`graphify-out/graph.json`), lalu MCP server mengekspos graph itu sebagai **10 tools**. Tujuannya: agent membaca struktur kode lewat query graph, bukan grep berulang-ulang.

Setiap hasil query balik sebagai teks dengan sitasi `file:line`, dan setiap edge ditandai salah satu dari:

| Tag | Arti |
|---|---|
| `EXTRACTED` | Relasi terbukti dari AST/parsing |
| `INFERRED` | Relasi disimpulkan, belum tentu benar |
| `AMBIGUOUS` | Tidak pasti, perlu verifikasi manual |

Tag ini yang paling berguna dalam praktik — perlakukan `INFERRED`/`AMBIGUOUS` sebagai hipotesis, bukan fakta.

---

## 2. Setup

```bash
# install CLI
uv tool install graphifyy          # atau: pipx install graphifyy / pip install graphifyy

# daftarkan skill /graphify ke semua AI assistant yang terdeteksi
graphify install
graphify install --platform claude   # spesifik satu assistant
graphify uninstall [--purge]         # --purge ikut hapus graphify-out/
```

Build graph dijalankan **dari dalam assistant**, bukan terminal:

```
/graphify .                 # build penuh
/graphify . --update        # re-scan hanya yang berubah
/graphify . --mode deep     # multi-pass, lebih lambat, lebih banyak INFERRED
```

Output: `graph.json` (mesin), `GRAPH_REPORT.md` (arsitektur), `graph.html` (visual interaktif).

### Menjalankan MCP server

```bash
# stdio (default) — satu assistant, satu graph
python -m graphify.serve graphify-out/graph.json

# HTTP bersama — banyak client / teman satu tim
python -m graphify.serve graphify-out/graph.json --transport http --port 8080

# console script alternatif
graphify-mcp graphify-out/graph.json
```

Transport HTTP bisa dikunci pakai `--api-key` atau env var `GRAPHIFY_API_KEY`.

### Registrasi manual di Claude Code (`.mcp.json` di root project)

```json
{
  "mcpServers": {
    "graphify": {
      "command": "python",
      "args": ["-m", "graphify.serve", "graphify-out/graph.json"]
    }
  }
}
```

---

## 3. Daftar MCP tools

Semua tool menerima parameter opsional **`project_path`** (absolute path ke project lain yang punya `graphify-out/graph.json`), jadi satu server bisa melayani banyak repo sekaligus.

### 3.1 Query & traversal (inti)

| Tool | Fungsi | Parameter |
|---|---|---|
| `query_graph` | Cari graph dengan pertanyaan natural language | `question` (wajib), `mode` (`bfs` default / `dfs`), `depth` (default 3, range 1–6), `token_budget` (default 2000), `context_filter` (mis. `["call","field"]`) |
| `get_node` | Detail lengkap satu node: apa, di mana, community, edges | `label` (wajib) |
| `get_neighbors` | Semua tetangga langsung (1 hop) + detail edge | `label` (wajib), `relation_filter` (opsional) |
| `shortest_path` | Jalur terpendek antara dua konsep | `source`, `target` (wajib), `max_hops` (default 8) |

### 3.2 Struktur & orientasi

| Tool | Fungsi | Parameter |
|---|---|---|
| `get_community` | Semua node dalam satu community/cluster | `community_id` (wajib, 0-indexed by size) |
| `god_nodes` | Node paling terkoneksi — abstraksi inti | `top_n` (default 10) |
| `graph_stats` | Jumlah node, edge, community, breakdown confidence | — |

### 3.3 Pull request (butuh GitHub)

| Tool | Fungsi | Parameter |
|---|---|---|
| `list_prs` | PR terbuka + status CI, review state, blast radius | `base`, `repo` (opsional) |
| `get_pr_impact` | Impact detail satu PR: file, community, jumlah node | `pr_number` (wajib), `repo` |
| `triage_prs` | Semua PR actionable + data impact untuk urutan review | `base`, `repo` (opsional) |

### 3.4 MCP Resources (read-only, ditarik ke context)

`GRAPH_REPORT.md` lengkap, graph stats, god nodes, koneksi lintas-community yang mengejutkan, confidence audit, dan daftar pertanyaan yang disarankan untuk codebase.

---

## 4. Pola prompt yang berguna

Perlu diluruskan dulu: **tidak ada "perintah" MCP yang diketik user**. Tool dipanggil agent. Yang bisa dikontrol adalah cara menulis prompt agar agent memilih tool yang tepat. Sebut nama tool secara eksplisit kalau mau deterministik.

### Orientasi repo baru

```
Pakai graph_stats dan god_nodes (top_n 15) dulu, lalu ringkas
arsitektur repo ini dalam maksimal 10 poin. Jangan buka file
satu-satu sebelum itu.
```

### Impact analysis sebelum refactor

```
Sebelum saya ubah <NamaFungsi>, panggil get_neighbors untuk node itu,
lalu query_graph "apa saja yang bergantung ke <NamaFungsi>" dengan
depth 4. Daftarkan pemanggil langsung dan tidak langsung, pisahkan
mana yang EXTRACTED dan mana yang INFERRED.
```

### Menelusuri satu alur spesifik

```
Pakai query_graph mode dfs, depth 5, question "bagaimana request
login sampai ke tabel session". Jangan melebar ke modul lain.
```

`bfs` = konteks luas, `dfs` = jejak satu rantai. Ini pilihan paling berdampak dan paling sering salah dipakai.

### Menghubungkan dua bagian kode

```
shortest_path dari "AuthService" ke "DatabasePool", max_hops 6.
Jelaskan tiap hop dan tandai hop mana yang INFERRED.
```

### Membatasi jenis relasi (mengurangi noise)

```
query_graph "<pertanyaan>" dengan context_filter ["call"] saja.
Saya tidak butuh relasi field atau import.
```

### Mengontrol ukuran output

```
query_graph ... token_budget 800.
```

Default 2000 token. Turunkan kalau context sudah sesak; naikkan hanya kalau jawaban jelas terpotong.

### Multi-repo dalam satu workspace

```
Jalankan query_graph yang sama dengan project_path
/abs/path/repo-a lalu /abs/path/repo-b, dan bandingkan hasilnya.
```

### Review PR

```
Panggil triage_prs, lalu get_pr_impact untuk 3 PR dengan blast
radius terbesar. Urutkan rekomendasi merge dan sebutkan pasangan
PR yang berisiko konflik.
```

### Verifikasi (wajib)

```
Setiap klaim yang berasal dari edge INFERRED atau AMBIGUOUS,
verifikasi dengan membaca file:line yang dikutip sebelum kamu
simpulkan. Kalau tidak cocok, bilang tidak cocok.
```

---

## 5. Padanan CLI (kalau lebih suka terminal)

```bash
graphify query "apa yang menghubungkan auth ke database?"
graphify query "bagaimana request sampai ke cache?" --dfs
graphify query "..." --context call --budget 1200 --graph path/graph.json

graphify path "UserService" "DatabasePool"
graphify explain "RateLimiter"

graphify prs
graphify prs --triage        # ranking review queue pakai LLM backend
graphify prs --conflicts     # PR yang menyentuh community sama
graphify prs --worktrees
graphify prs 482             # deep dive satu PR

graphify --help              # sisanya: watch, export, git hooks, headless CI
```

---

## 6. Batasan & risiko yang perlu disadari

- **Graph bisa basi.** Semua tool membaca `graph.json` statis. Kalau belum `/graphify . --update`, jawaban agent mencerminkan kode lama. Ini mode kegagalan paling berbahaya karena hasilnya tetap terlihat percaya diri.
- **`INFERRED` bukan bukti.** Berguna sebagai petunjuk, tidak layak jadi dasar keputusan refactor tanpa cek `file:line`.
- **Relasi runtime tidak tertangkap.** Dynamic dispatch, dependency injection, panggilan lewat string/reflection, dan trigger di sisi database umumnya tidak muncul sebagai edge — dan absennya edge tidak berarti tidak ada ketergantungan.
- **`--mode deep` menambah edge INFERRED**, artinya menambah false positive juga, bukan cuma cakupan.
- **Tool PR mengirim metadata repo ke GitHub API.** Untuk repo internal perusahaan, pastikan itu sesuai kebijakan.
- **Transport HTTP tanpa `--api-key` = graph terbuka** ke siapa pun yang bisa menjangkau port tersebut.

---

## 7. Tautan

- MCP tools reference — https://graphify.com/docs/mcp-tools
- CLI reference — https://graphify.com/docs/cli
- Install — https://graphify.com/docs/install
- GitHub — https://github.com/Graphify-Labs/graphify
- Docs MCP server terpisah (tool `search_graphify_docs`, untuk mencari dokumentasi ini dari editor) — https://graphify.com/docs/mcp
