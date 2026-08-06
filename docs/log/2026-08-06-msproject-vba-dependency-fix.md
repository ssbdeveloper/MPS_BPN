---
title: Fix VBA import dependency gagal (CallByName + mapping SS/SF)
date: 2026-08-06
tags: [domain/msproject, vba, fix]
---

# Fix VBA: dependency predecessor tidak ter-import

## Gejala

OpenFromServer (import) sukses tapi MsgBox lapor "Dependencies failed: 5"
(contoh project "contoh project-rev3"). SaveToServer justru berhasil —
5 dependency tersimpan di DB (ms_project_dependency, 15:12:24) dengan
predecessor/successor task_id valid.

## Investigasi

1. Package API benar: 5 deps, semua pred/succ task ada di daftar tasks,
   `is_summary=False` (bukan masalah link ke summary task).
2. Save jalan karena arah save hanya BACA `TaskDependencies` di
   `MsDependenciesJsonArray` (ms_serializer.bas).
3. Import gagal karena arah import TULIS `TaskDependencies.Add` lewat
   `CallByName` (ms_import.bas `MsTryAddTaskDependency`) — CallByName dengan
   argumen object COM (predTask) tidak andal, error ditelan diam-diam oleh
   `On Error Resume Next` + `Err.Clear`.

## Perbaikan

- `tools/msproject-v2/ms_import.bas` `MsTryAddTaskDependency`: ganti
  `CallByName dependencies, "Add", VbMethod, predTask, ...` →
  `dependencies.Add predTask, ...` (pemanggilan langsung).
- `tools/msproject-v2/ms_import.bas` `MsLinkTypeValue` + `tools/msproject-v2/ms_serializer.bas`
  `MsDependencyTypeCode`: betulkan mapping enum `pjTaskLinkType` —
  sebelumnya SS=3/SF=2 (tertukar), seharusnya `pjStartToStart=2 (SS)`,
  `pjStartToFinish=3 (SF)`.

## Perbaikan lanjutan (masih failed setelah fix CallByName)

User test project id 5b06dbf1 (130 deps) masih "Dependencies failed". Package
API diverifikasi bersih (semua pred/succ task ada, bukan summary, tidak ada
task_id NULL/duplikat). Root cause kedua di sisi VBA:

- `taskById` menyimpan **`t.ID`** (nomor baris MS Project) lalu dipakai
  `ActiveProject.Tasks(taskById(...))` — ID nomor baris **bergeser** setelah
  `MsSetTaskOutlineLevel` menjalankan OutlineIndent/Outdent, sehingga
  referensi dependency menunjuk task yang salah/kosong → Add gagal.
- Fix: simpan **object Task langsung** di dictionary
  (`Set taskById(task_id) = t`), ambil balik `Set succTask = taskById(...)`.
  Ikut diperbaiki fallback assignment `ActiveProject.Tasks(taskById(...))`
  → `taskById(...)` langsung.
- Error dependency TIDAK lagi ditelan diam-diam: `mDepFirstError` menyimpan
  pesan error pertama + ditampilkan di MsgBox summary ("Error pertama: ...").

## Perbaikan ketiga (error asli terungkap)

MsgBox menampilkan error asli: `Add(Fastener -> Painting): The argument value
is not valid` — terjadi di SEMUA 130 dependency (semua FS/lag 0). Bukan
masalah task spesifik, tapi cara pemanggilan `Add`:

- `dependencies` dideklarasikan `Object` (late binding) + `CallByName` →
  argumen Task/Type/Lag diterjemahkan tidak andal → MS Project menolak
  "argument value is not valid".
- `lag` dikirim sebagai angka (Long) — contoh resmi MS Project
  `TaskDependencies.Add(From, Type, Lag)` memakai string durasi (`"2d"`).
- Fix: early binding (`Dim dependencies As TaskDependencies` +
  `succTask.TaskDependencies`), lag sebagai string (`CStr(lagMinutes) & "m"`),
  fallback tanpa lag (default FS/0) bila dengan lag tetap error.

## Verifikasi

- Baca ulang kedua .bas: sintaks valid, mapping 0=FF 1=FS 2=SS 3=SF konsisten
  di kedua arah, semua penggunaan `taskById` konsisten sebagai Task object.
- Belum diuji live di MS Project — user perlu re-import modul di VBE lalu
  OpenFromServer ulang. Kalau masih gagal, MsgBox sekarang menampilkan
  "Error pertama: ..." yang bisa dilaporkan untuk diagnosa lanjut.
