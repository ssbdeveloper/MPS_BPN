---
tags: [domain/ops]
---

# Menjalankan API Lokal Dengan Database Remote

Dokumen ini untuk menjalankan `apps/api/server.js` di laptop lokal, tetapi tetap memakai database PostgreSQL remote dari `.env`.

Tujuan utamanya: **jangan mengubah konfigurasi production/Docker** hanya untuk kebutuhan lokal.

## Ringkasan

Di `.env` production/dev repo saat ini database diarahkan ke:

```env
DB_HOST=100.86.231.55
DB_PORT=5433
DB_NAME=ptssb
DB_USER=tag
```

Kalau `node server.js` dijalankan langsung dari lokal, koneksi ke `100.86.231.55:5433` bisa timeout atau gagal karena route Tailscale/proxy belum tersedia untuk proses Node.

Untuk lokal, gunakan tunnel:

```text
API lokal -> 127.0.0.1:15433 -> Tailscale SOCKS5 -> 100.86.231.55:5433
```

Production Docker tetap memakai:

```text
API container -> DB_HOST dari .env -> DB remote
```

## Perintah Yang Direkomendasikan Untuk Lokal

Dari root repo `D:\website\MPS2`:

```powershell
npm run api:local-tunnel
```

Command ini menjalankan script:

```text
scripts/start-api-local-tunnel.ps1
```

Script tersebut akan:

1. Start Tailscale SOCKS5 proxy dari `C:\Users\tee.san\tools\tailscale\tailscale-start.sh`.
2. Start PostgreSQL tunnel lokal:

   ```text
   127.0.0.1:15433 -> 100.86.231.55:5433
   ```

3. Menjalankan API lokal dengan override environment sementara:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=15433
   ```

Override ini hanya berlaku untuk proses terminal itu. File `.env` tidak diubah.

## Jangan Ubah DB_HOST Di .env Untuk Lokal

Biarkan `.env` tetap mengarah ke database remote:

```env
DB_HOST=100.86.231.55
DB_PORT=5433
```

Jangan simpan konfigurasi ini di `.env`:

```env
DB_HOST=127.0.0.1
DB_PORT=15433
```

Nilai `127.0.0.1:15433` hanya dipakai sementara oleh `scripts/start-api-local-tunnel.ps1` saat menjalankan API lokal. Kalau disimpan di `.env`, script bisa salah membaca target tunnel dan membuat tunnel melingkar:

```text
127.0.0.1:15433 -> 127.0.0.1:15433
```

Gejalanya:

```text
Database not ready, retrying in 3s... {
  code: undefined,
  message: 'Connection terminated unexpectedly'
}
```

Jika sudah terlanjur, kembalikan `.env` ke:

```env
DB_HOST=100.86.231.55
DB_PORT=5433
```

Lalu stop proses API/tunnel yang sedang looping dengan `Ctrl+C`, kemudian jalankan ulang:

```powershell
npm run api:local-tunnel
```

## Menjalankan Frontend Lokal

Untuk frontend lokal, pastikan `.env` memakai API lokal:

```env
VITE_API_URL=/api
VITE_API_PROXY_TARGET=http://localhost:3001
```

Lalu jalankan:

```powershell
cd apps/web
npm run dev
```

Alur request frontend:

```text
Browser React localhost:5173
  -> /api
  -> Vite proxy ke http://localhost:3001
  -> API lokal
  -> DB via tunnel 127.0.0.1:15433
```

## Arti Error Umum

### ECONNREFUSED 127.0.0.1:15433

Contoh:

```text
Database not ready, retrying in 3s... {
  code: 'ECONNREFUSED',
  message: 'connect ECONNREFUSED 127.0.0.1:15433'
}
```

Artinya API sudah diarahkan ke tunnel lokal, tetapi tunnel di port `15433` belum hidup atau gagal start.

Coba jalankan dari root repo:

```powershell
npm run api:local-tunnel
```

Kalau masih gagal, pastikan Tailscale SOCKS5 proxy hidup:

```powershell
& "C:\Program Files\Git\bin\bash.exe" "/c/Users/tee.san/tools/tailscale/tailscale-start.sh"
```

Lalu cek port tunnel:

```powershell
Test-NetConnection 127.0.0.1 -Port 15433
```

`TcpTestSucceeded` harus `True`.

### Connection terminated due to connection timeout

Jika muncul saat memakai `DB_HOST=100.86.231.55`, artinya API lokal mencoba konek langsung ke database remote tanpa tunnel.

Solusi lokal: gunakan:

```powershell
npm run api:local-tunnel
```

## Menjalankan API Tanpa npm Script

Kalau ingin manual:

```powershell
& "C:\Program Files\Git\bin\bash.exe" "/c/Users/tee.san/tools/tailscale/tailscale-start.sh"

python scripts/pg_socks_tunnel.py `
  --target-host 100.86.231.55 `
  --target-port 5433 `
  --local-port 15433
```

Buka terminal kedua:

```powershell
$env:DB_HOST="127.0.0.1"
$env:DB_PORT="15433"
cd apps/api
node server.js
```

## Production Docker

Untuk production Docker, jangan gunakan `api:local-tunnel`.

Gunakan flow production seperti biasa:

```bash
scripts/deploy.sh build
scripts/deploy.sh start
```

Docker akan membaca `.env` dan memakai nilai production/default:

```env
DB_HOST=100.86.231.55
DB_PORT=5433
```

Jangan mengganti `.env` menjadi `DB_HOST=127.0.0.1` untuk production, karena `127.0.0.1` di dalam container berarti container itu sendiri, bukan laptop host.

## Script Ping Mesin M5051

Untuk production/server yang route database dan IP mesin sudah direct, gunakan command tanpa tunnel:

```powershell
npm run ping:m5051-machines
```

Untuk mode service/loop setiap 10 detik:

```powershell
npm run ping:m5051-machines:loop
```

Command loop ini setara dengan:

```powershell
node scripts/ping_m5051_machines.js --loop --interval-ms=10000 --retention-days=7
```

Untuk laptop lokal yang butuh Tailscale DB tunnel, gunakan:

```powershell
npm run ping:m5051-machines:tunnel
```

Catatan production Docker:

- Jangan pakai `--use-tunnel` di production.
- Container harus punya binary `ping`.
- Container harus diizinkan melakukan ICMP ping. Jika image Linux tidak mengizinkan ICMP, tambahkan capability `NET_RAW` atau jalankan ping dari host/server scheduler.
- Log akan ditulis ke `public.mch_machine_ping_log`.

### Aman Tidak Jalan Tiap 10 Detik?

Secara teknis aman untuk beban ping-nya, karena script ping unique IP sekali lalu menulis hasilnya per machine. Saat ini data `M5051%` berisi 36 machine dan 9 unique IP.

Yang perlu dijaga adalah pertumbuhan tabel log:

```text
36 row / 10 detik
= 216 row / menit
= 12.960 row / jam
= 311.040 row / hari
```

Karena itu command loop production memakai retention 7 hari:

```text
--retention-days=7
```

Estimasi tabel menjadi sekitar:

```text
311.040 row/hari x 7 hari = 2.177.280 row
```

Ini masih masuk akal untuk PostgreSQL selama index tetap sederhana dan tabel dibersihkan rutin. Jangan disable retention untuk loop 10 detik kecuali memang mau menyimpan histori jangka panjang dan siap maintenance/partition.

### Docker Service Loop 1 Menit

Production Docker memakai service terpisah:

```yaml
machine-ping-worker
```

Service ini menjalankan:

```bash
node scripts/ping_m5051_machines.js --loop --interval-ms=60000 --retention-days=30
```

Artinya:

- ping distinct IP dari `mch_machines` yang `machineid` diawali `M5051`
- 4 ping per IP
- interval 1 menit
- log disimpan ke `public.mch_machine_ping_log`
- log lebih lama dari 30 hari otomatis dibersihkan

Estimasi pertumbuhan log saat ini:

```text
9 unique IP x 1.440 menit/hari = 12.960 row/hari
12.960 x 30 hari = 388.800 row
```

Ini jauh lebih aman daripada interval 10 detik.

Build dan start hanya worker:

```bash
docker compose build machine-ping-worker
docker compose up -d machine-ping-worker
```

Lihat log:

```bash
docker compose logs -f machine-ping-worker
```

Test manual dari container:

```bash
docker compose run --rm machine-ping-worker ping -c 4 192.168.112.62
```

Jika ping gagal dari container tetapi berhasil dari host server, cek hal ini:

- Docker image harus punya binary `ping`; service ini sudah install `iputils`.
- Container perlu izin ICMP; service ini sudah memakai:

  ```yaml
  cap_add:
    - NET_RAW
  ```

- Host server harus punya route ke subnet mesin, misalnya `192.168.112.0/24`.
- Firewall host/network tidak boleh block ICMP dari Docker bridge subnet.

Jika route dari Docker bridge tetap tidak tembus, opsi Linux production:

```yaml
network_mode: host
```

Namun kalau memakai `network_mode: host`, service tidak bisa memakai DNS compose `db`. Untuk mode itu, set `DB_HOST` ke host/DB yang bisa dijangkau langsung dari host network, bukan `db`.

## Catatan Tentang VITE_API_PROXY_TARGET

`VITE_API_PROXY_TARGET` hanya untuk Vite dev server frontend.

Contoh:

```env
VITE_API_PROXY_TARGET=http://localhost:3001
```

Artinya request `/api` dari React lokal akan diteruskan ke API lokal.

Variable ini tidak dipakai untuk koneksi PostgreSQL. Koneksi database API tetap memakai:

```env
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
```
