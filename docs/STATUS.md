---
type: moc
tags: [moc, domain/vault]
updated: 2026-07-27
---

# 📊 Status Board

> Papan status **otomatis** dari frontmatter `status:` tiap dokumen (butuh plugin **Dataview**).
> Hanya dokumen kerja (`type: plan/prd/design/feature`) yang punya status — referensi
> (concept/log/guide/ops/moc) sengaja tidak muncul, memang tak berlifecycle. Sumber kebenaran
> = frontmatter tiap dokumen, bukan papan ini. Aturan status: [[KONVENSI]] §3.

## 🟡 Active — sedang dikerjakan

```dataview
TABLE WITHOUT ID file.link AS "Dokumen", type AS "Tipe", tags AS "Domain"
WHERE status = "active"
SORT file.mtime DESC
```

## 🔵 Planning — antre, belum mulai

```dataview
TABLE WITHOUT ID file.link AS "Dokumen", type AS "Tipe", tags AS "Domain"
WHERE status = "planning"
SORT file.mtime DESC
```

## ✅ Done — semua fase rilis

```dataview
TABLE WITHOUT ID file.link AS "Dokumen", type AS "Tipe", tags AS "Domain"
WHERE status = "done"
SORT file.mtime DESC
```

## 🅿️ Parked — ditunda / superseded

```dataview
TABLE WITHOUT ID file.link AS "Dokumen", type AS "Tipe", tags AS "Domain"
WHERE status = "parked"
SORT file.mtime DESC
```

---

**Terhubung:** [[00-INDEX]] · [[KONVENSI]] · [[PLANNING]]
