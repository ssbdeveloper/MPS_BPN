# Docker Build Performance Analysis: React Vite + Node.js + FastAPI

## Executive Summary

Build Docker project ini lambat terutama karena Docker build context terlalu besar dan cache layer belum optimal. Penyebab paling kuat dari hasil inspeksi repo:

1. `API` tidak punya `.dockerignore`, sehingga `API/node_modules` sekitar 80 MB, `API/uploads`, file log, `.env`, dan folder lain ikut dikirim ke Docker daemon.
2. `API/dockerfile` memakai `npm install --production`, bukan `npm ci --omit=dev`, sehingga dependency install kurang deterministik dan lebih mudah lambat.
3. `docker-compose.yml` punya service `sow_exporter` dengan build context root `.`. Kalau menjalankan `docker compose build` tanpa memilih service, Docker bisa mengirim hampir seluruh repo, termasuk:
   - `react-timesheet/node_modules`: sekitar 241 MB
   - `API/node_modules`: sekitar 80 MB
   - `pythonscript/venv`: sekitar 153 MB
   - `.git`: sekitar 23 MB
   - `database`: sekitar 26 MB
4. FastAPI Dockerfile sudah memisahkan `requirements.txt` dari source, tetapi belum memakai BuildKit cache mount dan belum punya `.dockerignore`.
5. Vite build kemungkinan ikut berat karena semua route/page di `react-timesheet/src/router/index.jsx` di-import eager, termasuk dependency berat seperti `recharts`, `framer-motion`, `@zxing/library`, `qrcode.react`, `react-rnd`, `jspdf`, dan `html-to-image`.

Prioritas perbaikan paling berdampak:

1. Tambahkan `.dockerignore` untuk root, `API`, dan `API/FastAPI`.
2. Ubah Node API build dari `npm install --production` ke `npm ci --omit=dev`.
3. Jangan build semua service saat tidak perlu: gunakan `docker compose build frontend api fastapi`.
4. Ubah `sow_exporter` agar build context menjadi `./pythonscript`, bukan root `.`.
5. Aktifkan BuildKit cache mount untuk `npm` dan `pip`.
6. Optimalkan Vite dengan lazy route dan chunk splitting.

## Current Docker Setup

### Frontend

File: `react-timesheet/Dockerfile`

Kondisi sekarang:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Ini sudah memakai multi-stage build dan `npm ci`, jadi fondasinya cukup baik. Bottleneck utama frontend lebih mungkin berasal dari Vite/Rollup build dan dependency graph, bukan Dockerfile-nya saja.

Catatan:

- `.dockerignore` frontend sudah ada, tetapi belum mengabaikan `dev-dist`, `coverage`, `.env`, dan beberapa cache umum.
- `vite.config.js` memakai `VitePWA`. Workbox akan scan asset hasil build sesuai `globPatterns`, sehingga build bisa bertambah lama kalau output besar.
- `src/router/index.jsx` melakukan eager import banyak halaman. Ini membuat Rollup memproses banyak fitur sekaligus walaupun user tidak membuka semua halaman pada initial load.

### Node API

File: `API/dockerfile`

Kondisi sekarang:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
```

Masalah utama:

- Tidak ada `.dockerignore` di `API`.
- `COPY . .` bisa membawa `node_modules`, `uploads`, log, `.env`, dan folder `FastAPI`.
- Jika `node_modules` lokal ikut tersalin, layer hasil `npm install` bisa tertimpa oleh `node_modules` dari host. Ini berisiko lambat dan bisa rusak karena binary dependency host berbeda dari container Linux.
- `npm install --production` sebaiknya diganti dengan `npm ci --omit=dev` karena project sudah punya `package-lock.json`.
- Nama file `API/dockerfile` sebaiknya distandarkan menjadi `API/Dockerfile`, atau set eksplisit di Compose. Di Windows ini sering tidak terasa, tetapi di environment Linux case-sensitive bisa bermasalah.

### FastAPI

File: `API/FastAPI/Dockerfile`

Kondisi sekarang:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Ini sudah benar secara dasar karena `requirements.txt` di-copy sebelum source code. Masih bisa dibuat lebih cepat dengan:

- `.dockerignore` untuk menghindari file lokal tidak penting.
- BuildKit cache mount untuk cache package pip.
- Menambahkan env Python umum: `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1`.

### docker-compose.yml

Masalah paling besar di Compose:

```yaml
sow_exporter:
  build:
    context: .
    dockerfile: pythonscript/Dockerfile
```

Kalau menjalankan `docker compose build`, service ini dapat membuat Docker mengirim context root repo. Di repo ini root berisi beberapa folder besar seperti `react-timesheet/node_modules`, `API/node_modules`, `pythonscript/venv`, `.git`, dan `database`.

Rekomendasi:

```yaml
sow_exporter:
  build:
    context: ./pythonscript
    dockerfile: Dockerfile
```

Lalu pastikan file Dockerfile-nya konsisten, misalnya rename `pythonscript/dockerfile` menjadi `pythonscript/Dockerfile`.

## Bottleneck Details

### 1. Docker Build Context Terlalu Besar

Docker tidak langsung menjalankan instruksi `RUN`. Pertama, Docker mengirim build context ke daemon. Kalau context berisi `node_modules`, `venv`, `.git`, upload file, dump, log, dan Excel besar, build terasa lambat bahkan sebelum dependency install dimulai.

Ukuran yang ditemukan:

| Path | Approx size |
| --- | ---: |
| `react-timesheet/node_modules` | 241 MB |
| `API/node_modules` | 80 MB |
| `pythonscript/venv` | 153 MB |
| `.git` | 23 MB |
| `database` | 26 MB |
| `API/uploads` | 2 MB |

Solusi:

- Tambahkan `.dockerignore`.
- Hindari build context root `.` kecuali benar-benar perlu.
- Build service spesifik, bukan semua service.

Contoh command:

```bash
docker compose build frontend api fastapi
```

Untuk melihat ukuran context dan layer:

```bash
docker compose build --progress=plain frontend api fastapi
docker buildx du
docker system df
```

### 2. Dependency Install Tidak Maksimal Cache-nya

#### Node frontend

Frontend sudah benar memakai:

```dockerfile
COPY package*.json ./
RUN npm ci
COPY . .
```

Layer `npm ci` akan cache selama `package.json` dan `package-lock.json` tidak berubah.

Tambahan yang bisa membuat rebuild lebih cepat:

```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci
```

Syarat: BuildKit aktif.

#### Node API

API saat ini memakai:

```dockerfile
RUN npm install --production
```

Lebih baik:

```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
```

Alasan:

- `npm ci` memakai lockfile secara ketat.
- `--omit=dev` menggantikan pola lama `--production`.
- Cache mount mempercepat download package saat rebuild.

#### FastAPI

Saat ini:

```dockerfile
RUN pip install --no-cache-dir -r requirements.txt
```

Untuk build yang sering diulang, gunakan BuildKit cache:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
```

Cache pip tidak masuk ke image layer karena berada di cache mount BuildKit.

### 3. Base Image Selection

#### Node

`node:20-alpine` kecil, tetapi kadang lebih lambat atau bermasalah untuk dependency native karena Alpine memakai musl libc. Untuk API yang memakai dependency seperti `mssql`, `exceljs`, dan package lain, `node:20-slim` sering lebih stabil dan kadang lebih cepat saat install.

Pilihan:

- Pakai `node:20-alpine` jika image size adalah prioritas dan dependency tidak compile native module.
- Pakai `node:20-slim` jika build/install sering bermasalah atau lambat karena native dependency.

#### Python

`python:3.11-slim` sudah cocok. FastAPI dependency saat ini ringan dan `psycopg2-binary` biasanya memakai wheel, jadi tidak perlu build toolchain tambahan.

### 4. Vite Build Process

Indikasi dari source:

- `src/router/index.jsx` meng-import banyak page secara eager.
- Banyak page membawa library berat:
  - `recharts`
  - `framer-motion`
  - `@zxing/library`
  - `qrcode.react`
  - `react-rnd`
  - `jspdf`
  - `html-to-image`
- `vite-plugin-pwa` menjalankan Workbox saat production build.

Rekomendasi:

1. Lazy load route/pages yang jarang dipakai.
2. Pakai `manualChunks` untuk memecah vendor besar.
3. Pastikan asset di `public` yang tidak dipakai tidak ikut tersalin.
4. Pertimbangkan menonaktifkan PWA sementara untuk membandingkan durasi build.

Contoh lazy route:

```jsx
import React, { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const WelcomePage = lazy(() => import('../pages/WelcomePage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const SowCreatePage = lazy(() => import('../pages/PE/SowCreatePage'));
const ComponentTrackingPage = lazy(() => import('../pages/PPC/ComponentTrackingPage'));

function withSuspense(Component) {
  return (
    <Suspense fallback={<div />}>
      <Component />
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: '/', element: withSuspense(WelcomePage) },
  { path: '/dashboard', element: withSuspense(DashboardPage) },
  { path: '/sow/create', element: withSuspense(SowCreatePage) },
  { path: '/component-tracking', element: withSuspense(ComponentTrackingPage) },
]);

export default router;
```

Contoh `manualChunks` di `vite.config.js`:

```js
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['ssb.png'],
      manifest: {
        name: 'TIMESHEET SSB',
        short_name: 'TIMESHEET SSB',
        theme_color: '#007bff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
    }),
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          dnd: ['@dnd-kit/core', '@dnd-kit/modifiers', '@dnd-kit/sortable'],
          export: ['jspdf', 'html-to-image', 'qrcode.react'],
          scanner: ['@zxing/library'],
        },
      },
    },
  },
});
```

Catatan: `manualChunks` tidak selalu mempercepat build secara drastis, tetapi membantu output bundle lebih rapi dan caching browser lebih baik. Percepatan build yang lebih terasa biasanya dari lazy import dan mengurangi dependency yang diproses setiap build.

## Recommended Refactored Files

### `react-timesheet/.dockerignore`

```dockerignore
node_modules
dist
dev-dist
.git
.gitignore
.env
.env.*
!.env.example
.vscode
coverage
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
```

### `react-timesheet/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### `API/.dockerignore`

```dockerignore
node_modules
FastAPI
uploads
*.log
*.out.log
*.err.log
.env
.env.*
!.env.example
.git
.gitignore
npm-debug.log*
yarn-debug.log*
coverage
```

### `API/Dockerfile`

Rename `API/dockerfile` menjadi `API/Dockerfile`, atau set `dockerfile: dockerfile` secara eksplisit di Compose. Versi yang disarankan:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY . .

RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 3001
CMD ["node", "server.js"]
```

Jika ingin tetap Alpine:

```dockerfile
FROM node:20-alpine AS deps
```

Tetapi untuk API, `node:20-slim` biasanya lebih aman untuk compatibility.

### `API/FastAPI/.dockerignore`

```dockerignore
__pycache__
*.pyc
*.pyo
*.pyd
.Python
.env
.env.*
!.env.example
.venv
venv
dist
build
*.log
.pytest_cache
.mypy_cache
```

### `API/FastAPI/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.7

FROM python:3.11-slim AS runner

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Root `.dockerignore`

Ini penting jika masih ada service dengan context root `.`.

```dockerignore
.git
.gitignore
.env
.env.*
!.env.example

node_modules
**/node_modules
**/dist
**/dev-dist
**/coverage

venv
**/venv
**/.venv
**/__pycache__
**/*.pyc

*.log
*.out.log
*.err.log
*.dump
*.xlsx

backups
export
database
db
API/uploads
nginx/ssl
```

Catatan: jangan ignore folder seperti `database` atau `db` jika memang ada Dockerfile yang membutuhkan file dari sana saat build. Dari Compose saat ini, file database lebih terlihat sebagai runtime/data concern, bukan build artifact.

### `docker-compose.yml` Build Section

Rekomendasi untuk service build:

```yaml
services:
  api:
    build:
      context: ./API
      dockerfile: Dockerfile

  frontend:
    build:
      context: ./react-timesheet
      dockerfile: Dockerfile
      args:
        VITE_API_URL: /api

  fastapi:
    build:
      context: ./API/FastAPI
      dockerfile: Dockerfile

  sow_exporter:
    build:
      context: ./pythonscript
      dockerfile: Dockerfile
```

Kalau `sow_exporter` tidak diperlukan saat build aplikasi utama, build hanya service utama:

```bash
docker compose build frontend api fastapi
```

## BuildKit Setup

Cache mount membutuhkan BuildKit. Docker Desktop modern biasanya sudah aktif, tetapi untuk memastikan:

### PowerShell

```powershell
$env:DOCKER_BUILDKIT=1
$env:COMPOSE_DOCKER_CLI_BUILD=1
docker compose build --progress=plain frontend api fastapi
```

### Bash

```bash
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose build --progress=plain frontend api fastapi
```

## Dependency-Specific Recommendations

### npm frontend

1. Tetap gunakan `npm ci`.
2. Pastikan `package-lock.json` committed dan tidak berubah tanpa alasan.
3. Hapus dependency mencurigakan di `react-timesheet/package.json`:

```json
"18": "^0.0.0"
```

Dependency bernama `"18"` terlihat tidak normal. Jika tidak sengaja ter-install, hapus:

```bash
cd react-timesheet
npm uninstall 18
```

4. Jika build Vite tetap berat, jalankan:

```bash
npm run build -- --debug
```

5. Untuk melihat bundle besar:

```bash
npm install -D rollup-plugin-visualizer
```

Tambahkan sementara di `vite.config.js`:

```js
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  react(),
  visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true }),
]
```

### npm Node API

1. Ganti `npm install --production` ke:

```bash
npm ci --omit=dev
```

2. Jangan copy `node_modules` dari host.
3. Jangan copy `.env` ke image. Compose sudah mengirim env lewat `environment`.
4. Pertimbangkan `node:20-slim` jika install di Alpine sering lama atau error.

### pip FastAPI

1. Tetap pin versi dependency di `requirements.txt`.
2. Gunakan BuildKit cache mount.
3. Jika ada dependency Python yang mulai compile dari source, tambahkan wheel pin atau pilih image yang punya wheel compatible.

## Practical Diagnostic Checklist

Jalankan ini untuk melihat bagian mana yang paling lama:

```bash
docker compose build --progress=plain frontend api fastapi
```

Perhatikan log:

- Lama di `load build context`: masalah `.dockerignore` atau context terlalu besar.
- Lama di `npm ci`: masalah network/cache/package dependency.
- Lama di `pip install`: masalah network/cache/wheel Python.
- Lama di `npm run build`: masalah Vite/Rollup/dependency graph/source size.

Build service satu per satu:

```bash
docker compose build --progress=plain frontend
docker compose build --progress=plain api
docker compose build --progress=plain fastapi
```

Cek image size:

```bash
docker images
docker system df
```

Cek cache:

```bash
docker buildx du
```

## Expected Impact

Perbaikan paling terasa:

1. `.dockerignore` pada `API` dan root: mengurangi waktu `load build context`, terutama jika sebelumnya context mengirim `node_modules` dan `venv`.
2. `npm ci --omit=dev` pada API: install lebih stabil dan cache-friendly.
3. Build service spesifik: menghindari build `sow_exporter` dan root context saat tidak diperlukan.
4. BuildKit cache mount: rebuild dependency lebih cepat setelah build pertama.
5. Lazy route Vite: mengurangi beban Rollup untuk initial bundle dan bisa memperbaiki waktu build frontend.

## Confirmed Current State (Audit 2026-05-06)

### Directory Sizes (confirmed)
| Path | Size |
|------|------|
| `react-timesheet\node_modules` | 300.6 MB |
| `pythonscript\venv` | 153.1 MB |
| `API\node_modules` | 80.1 MB |
| `database` | 26.6 MB |
| `.git` | 23.1 MB |
| `API\uploads` | 2.2 MB |

### File State
| Item | Status | Problem |
|------|--------|---------|
| Root `.dockerignore` | **Missing** | `sow_exporter` context root `.` sends 584+ MB |
| `API\.dockerignore` | **Missing** | `build: ./API` sends 80+ MB node_modules |
| `API\FastAPI\.dockerignore` | **Missing** | No exclusions for pycache, venv etc |
| `react-timesheet\.dockerignore` | **Exists but incomplete** | Missing `dev-dist`, `coverage`, `.env` |
| `API\dockerfile` (lowercase) | **Exists** | Uses `npm install --production`, no multi-stage |
| `API\Dockerfile` (uppercase) | **Missing** | compose `build: ./API` looks for `Dockerfile` |
| `pythonscript\dockerfile` (lowercase) | **Exists** | compose expects `pythonscript/Dockerfile` |
| `docker-compose.yml` `sow_exporter` | **context: `.`** | Sends entire repo (584 MB+) to Docker daemon |
| BuildKit cache mount | **None** | No `--mount=type=cache` in any Dockerfile |

## Root Cause Summary

Docker build lambat karena 3 penyebab utama yang saling memperparah:

1. **Build context raksasa**: `sow_exporter` pakai `context: .` → Docker mengirim ~584 MB ke daemon setiap build, termasuk `react-timesheet/node_modules` (301 MB), `pythonscript/venv` (153 MB), `.git` (23 MB), `database` (27 MB). Ini terjadi BAHKAN sebelum `RUN` pertama dieksekusi.

2. **Missing .dockerignore**: `API/` dan `API/FastAPI/` tidak punya `.dockerignore`. `COPY . .` di Dockerfile API ikut menyalin `node_modules` host (80 MB), `FastAPI/`, `uploads/`, `.env` ke dalam image.

3. **Dependency install tidak cache-optimized**: Tidak ada BuildKit cache mount (`--mount=type=cache`), sehingga setiap rebuild harus download ulang semua npm/pip packages. `npm install --production` di API Dockerfile tidak deterministik (seharusnya `npm ci --omit=dev`).

## Concrete Action Steps

### Step 1: Create root `.dockerignore`
```
D:\website\MPS2\.dockerignore
```
Ini mencegah `sow_exporter` mengirim seluruh repo. Lihat contoh di section "Root `.dockerignore`" di atas.

### Step 2: Create `API\.dockerignore`
```
D:\website\MPS2\API\.dockerignore
```
Blokir `node_modules`, `FastAPI`, `uploads`, `.env`, log files.

### Step 3: Create `API\FastAPI\.dockerignore`
```
D:\website\MPS2\API\FastAPI\.dockerignore
```
Blokir `__pycache__`, `venv`, `.env`, build artifacts.

### Step 4: Update `react-timesheet\.dockerignore`
Tambahkan `dev-dist`, `coverage`, `.env`, `.env.*`.

### Step 5: Rename & rewrite `API\dockerfile` → `API\Dockerfile`
- Ganti `npm install --production` → `npm ci --omit=dev`
- Tambahkan multi-stage build (stage 1: install, stage 2: copy source)
- Tambahkan BuildKit cache mount: `--mount=type=cache,target=/root/.npm`
- Tambahkan `USER node` untuk security

### Step 6: Rename `pythonscript\dockerfile` → `pythonscript\Dockerfile`
Atau set eksplisit di compose: `dockerfile: dockerfile`

### Step 7: Update `docker-compose.yml`
```yaml
sow_exporter:
  build:
    context: ./pythonscript
    dockerfile: Dockerfile
```
Dan tambahkan `dockerfile: Dockerfile` secara eksplisit untuk service `api`.

### Step 8: Add BuildKit cache mounts
Semua Dockerfile tambahkan `# syntax=docker/dockerfile:1.7` di baris pertama, lalu:
- Frontend: `RUN --mount=type=cache,target=/root/.npm npm ci`
- API: `RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev`
- FastAPI: `RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt`

### Step 9: Update `react-timesheet\Dockerfile`
- Tambahkan `# syntax=docker/dockerfile:1.7`
- Pisahkan stage deps agar `npm ci` hasilnya bisa di-cache terpisah dari source code
- Tambahkan `--mount=type=cache`

### Step 10: Verify with
```powershell
$env:DOCKER_BUILDKIT=1
$env:COMPOSE_DOCKER_CLI_BUILD=1
docker compose build --progress=plain frontend api fastapi
```

### Estimated Impact
| Optimasi | Perkiraan penghematan |
|----------|----------------------|
| `.dockerignore` API + root | **30-60 detik** (context load) |
| Build service spesifik (skip sow_exporter) | **20-40 detik** |
| BuildKit cache mount (rebuild) | **15-30 detik** per rebuild |
| `npm ci` (lebih deterministik) | **5-15 detik** |
| Multi-stage API Dockerfile | Layer cache lebih baik |
