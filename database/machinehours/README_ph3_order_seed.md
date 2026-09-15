# PH3 Order Excel Seed

Template: `database/machinehours/template_ph3.xlsx`

## Command

Generate template baru:

```bash
node database/machinehours/ph3_order_seed.js template
```

Export isi `public.ph3_order` ke Excel supaya bisa diedit:

```bash
node database/machinehours/ph3_order_seed.js export
```

Cek perubahan tanpa commit ke database:

```bash
node database/machinehours/ph3_order_seed.js dry-run
```

Apply perubahan ke database:

```bash
node database/machinehours/ph3_order_seed.js apply
```

Pakai file lain:

```bash
node database/machinehours/ph3_order_seed.js apply --file=D:\path\file.xlsx
```

## Kolom action

- `upsert`: create jika `confirmation_number` belum ada, update jika sudah ada.
- `delete`: hapus row berdasarkan `confirmation_number`.
- `skip`: baris diabaikan.

`confirmation_number` adalah unique key. Untuk `upsert`, minimal isi `confirmation_number` dan `order_no`.
