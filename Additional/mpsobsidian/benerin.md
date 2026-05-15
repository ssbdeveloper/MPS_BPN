Saat user upload PDF:

Jangan tampilkan PDF menggunakan iframe/embed/object/browser PDF viewer
Render halaman PDF menjadi canvas/image preview
Preview PDF harus bisa diperlakukan seperti image:
resize
scale
drag / positioning jika fitur image sudah support
responsive preview
Implementation Direction

Gunakan pdfjs-dist untuk render PDF page ke canvas.

Flow:

Detect file type:
Jika image → gunakan behavior existing
Jika PDF → render PDF page pertama ke canvas
Convert canvas menjadi image preview jika perlu:
canvas.toDataURL("image/png")
atau gunakan canvas langsung sebagai preview
Setelah PDF berubah menjadi image preview, gunakan logic resize yang sama seperti image existing.
PDF Rendering Rules
Default render halaman pertama PDF
Tidak tampilkan toolbar PDF
Tidak tampilkan page navigation
Tidak gunakan iframe/embed/object
Tidak munculkan native PDF viewer browser

UI Behavior
Jika file PDF berhasil dirender, tampilkan hasilnya sebagai image preview
Label tetap boleh menunjukkan bahwa file aslinya PDF
Jika PDF gagal dirender, tampilkan error message yang jelas
Batasi ukuran file jika diperlukan agar performa tetap aman
Expected Result
PDF tidak tampil sebagai viewer
PDF tampil sebagai preview image
Preview PDF bisa di-resize seperti image
Behavior image existing tetap tidak rusak
Compatible dengan React + Vite