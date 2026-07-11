# MPS2 Timesheet System - Docker Deployment Guide

## 📋 Architecture Overview

Sistem ini menggunakan **4 Docker containers** yang bekerja bersama:

```
┌─────────────────────────────────────────────────────────┐
│                    NGINX (Port 80/443)                  │
│                  Reverse Proxy & SSL                    │
└──────────┬──────────────┬──────────────┬────────────────┘
           │              │              │
           ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────────┐
    │ Frontend │   │   apps/api    │   │ SPC Dashboard│
    │  React   │   │ Node.js  │   │  Streamlit   │
    │ (Port 80)│   │(Port 3001│   │ (Port 8501)  │
    └──────────┘   └─────┬────┘   └──────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │ PostgreSQL  │
                  │  Database   │
                  │ (Port 5432) │
                  └─────────────┘
```

## 🏗️ Services

### 1. **Database (PostgreSQL 15)**
- **Container**: `timesheet-db`
- **Port**: 5433 → 5432 (internal)
- **Volume**: `postgres_data` (persistent storage)
- **Init Scripts**: tidak ada auto-init — DB baru di-restore dari backup atau
  dibangun dari `database/schema/schema_prod.sql` (dump kanonik) lalu migrasi via
  `node database/migrate.js`. (Catatan 2026-07-11: `init_database.sql` lama sudah dihapus.)

### 2. **API (Node.js Express)**
- **Container**: `timesheet-apps/api`
- **Port**: 3001 (internal only, exposed via nginx)
- **Build**: `./apps/api/Dockerfile`
- **Dependencies**: Database

### 3. **Frontend (React + Vite)**
- **Container**: `timesheet-frontend`
- **Port**: 80 (internal only, exposed via nginx)
- **Build**: `./apps/web/Dockerfile`
- **Multi-stage build**:
  - Stage 1: Build React app dengan Node.js
  - Stage 2: Serve dengan Nginx Alpine

### 4. **NGINX (Reverse Proxy)**
- **Container**: `timesheet-nginx`
- **Ports**:
  - 80 (HTTP → **FORCED redirect** ke HTTPS)
  - 443 (HTTPS - SSL/TLS enabled)
- **Config**: `./infra/nginx/nginx.conf`
- **SSL**: `./infra/nginx/ssl/` (server.crt, server.key)
- **Force HTTPS**: ✅ **ENABLED** - semua HTTP request otomatis redirect ke HTTPS
- **Routes**:
  - `/` → React Frontend (via proxy)
  - `/usernfc/*`, `/timesheet/*`, etc. → API Backend
  - `/spc/*` → Streamlit Dashboard
- **Features**:
  - HTTP/2 support
  - TLS 1.2 & 1.3
  - React Router SPA support (fallback routing)

### 5. **SOW Exporter (Python)**
- **Container**: `sow-exporter`
- **Build**: `./jobs/sow/Dockerfile`
- **Purpose**: Background job untuk export data

## 🚀 Deployment Steps

### Persiapan (First Time)

1. **Clone repository dan masuk ke folder MPS2**
   ```bash
   cd D:\MPS2
   ```

2. **Setup environment variables**

   Buat file `.env` di root folder MPS2:
   ```env
   # Database
   DB_NAME=timesheet_db
   DB_USER=timesheet_user
   DB_PASSWORD=your_secure_password_here

   # apps/api
   PORT=3001
   NODE_ENV=production
   PLANT_SSB=5071
   CORS_ORIGIN=*

   # Timezone - satu-satunya sumber kebenaran timezone aplikasi.
   # Dibaca oleh Express (apps/api/config/timezone.js), job EWS, dan script Python.
   TIMEZONE=Asia/Makassar
   ```

3. **Pastikan SSL certificates ada**
   ```bash
   # Buat self-signed certificate (untuk development)
   mkdir -p infra/nginx/ssl
   cd infra/nginx/ssl
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout server.key -out server.crt \
     -subj "/C=ID/ST=Jakarta/L=Jakarta/O=MPS/CN=ssb.app"
   cd ../..
   ```

   **Note**: NGINX sudah dikonfigurasi untuk **force HTTPS** - semua request HTTP otomatis redirect ke HTTPS.

### Build dan Run

#### Option 1: Build dan Start Semua Services
```bash
# Build semua images
docker compose build

# Start semua containers
docker compose up -d

# Lihat logs
docker compose logs -f
```

#### Option 2: Build Individual Services
```bash
# Build hanya frontend
docker compose build frontend

# Build hanya apps/api
docker compose build api

# Restart service tertentu
docker compose restart frontend
```

### Verifikasi Deployment

1. **Cek status containers**
   ```bash
   docker compose ps
   ```

   Output seharusnya menampilkan semua containers dengan status "Up":
   ```
   NAME                   STATUS
   timesheet-db          Up (healthy)
   timesheet-apps/api         Up
   timesheet-frontend    Up
   timesheet-nginx       Up
   sow-exporter          Up
   ```

2. **Cek logs untuk error**
   ```bash
   # All services
   docker compose logs

   # Specific service
   docker compose logs frontend
   docker compose logs api
   docker compose logs nginx
   ```

3. **Test aplikasi**
   - HTTP: http://localhost (akan redirect ke HTTPS)
   - HTTPS: https://localhost
   - apps/api Health: https://localhost/timesheet/validation (contoh endpoint)

## 🔄 Update & Maintenance

### Update Frontend (React App)

1. **Rebuild image setelah code changes**
   ```bash
   cd D:\MPS2
   docker compose build frontend
   docker compose up -d frontend
   ```

2. **Atau rebuild dan restart sekaligus**
   ```bash
   docker compose up -d --build frontend
   ```

### Update API

```bash
docker compose build api
docker compose up -d api
```

### Update Database

```bash
# Backup dulu sebelum update
docker exec timesheet-db pg_dump -U timesheet_user timesheet_db > backup_$(date +%Y%m%d).sql

# Update schema (jika ada migration script)
docker exec -i timesheet-db psql -U timesheet_user -d timesheet_db < new_migration.sql
```

### Update NGINX Config

```bash
# Edit infra/nginx/nginx.conf
# Kemudian reload config tanpa downtime
docker compose exec nginx nginx -s reload
```

## 🛠️ Troubleshooting

### Frontend tidak muncul (404 atau blank page)

1. Cek apakah React build berhasil:
   ```bash
   docker compose logs frontend
   ```

2. Cek apakah nginx proxy ke frontend:
   ```bash
   docker compose logs nginx | grep frontend
   ```

3. Rebuild frontend container:
   ```bash
   docker compose build --no-cache frontend
   docker compose up -d frontend
   ```

### apps/api tidak bisa connect ke database

1. Cek database health:
   ```bash
   docker compose ps db
   ```

2. Test koneksi dari apps/api container:
   ```bash
   docker compose exec api sh
   # Di dalam container
   nc -zv db 5432
   ```

3. Restart database dan apps/api:
   ```bash
   docker compose restart db apps/api
   ```

### SSL/HTTPS issues

1. Regenerate self-signed certificate
2. Atau gunakan Let's Encrypt untuk production:
   ```bash
   # Install certbot
   # Generate certificate untuk domain
   certbot certonly --standalone -d yourdomain.com
   # Copy ke infra/nginx/ssl/
   ```

### Memory/Resource issues

1. Lihat resource usage:
   ```bash
   docker stats
   ```

2. Limit resources di docker compose.yml:
   ```yaml
   services:
     frontend:
       deploy:
         resources:
           limits:
             memory: 512M
   ```

## 📁 File Structure

```
MPS2/
├── docker compose.yml          # Main orchestration file
├── .env                        # Environment variables
├── DEPLOYMENT.md              # This file
│
├── apps/api/
│   ├── Dockerfile             # apps/api container config
│   ├── server.js              # Express server
│   └── package.json
│
├── apps/web/
│   ├── Dockerfile             # Frontend multi-stage build
│   ├── .dockerignore          # Files to exclude from build
│   ├── package.json
│   ├── vite.config.js
│   └── src/                   # React source code
│
├── infra/nginx/
│   ├── nginx.conf             # NGINX reverse proxy config
│   └── ssl/                   # SSL certificates
│       ├── server.crt
│       └── server.key
│
├── database/
│   ├── schema/schema_prod.sql # dump kanonik (regenerate dari prod)
│   ├── migrations/api/        # migration files (ledger: schema_migrations)
│   └── migrate.js             # migration runner
│
└── backups/                   # Database backups
```

## 🔐 Security Notes

1. **Change default passwords** di `.env` file
2. Gunakan **real SSL certificates** untuk production (Let's Encrypt)
3. Set **CORS_ORIGIN** ke domain spesifik, bukan `*`
4. Gunakan **secrets** untuk sensitive data di production
5. **Regularly backup** database ke external storage

## 📝 Notes

### React App Build Process

Frontend menggunakan **multi-stage Docker build**:
1. **Stage 1 (Builder)**: Build React app dengan Vite
   - Install dependencies
   - Run `npm run build` → output ke `dist/`
2. **Stage 2 (Production)**: Serve dengan Nginx Alpine
   - Copy `dist/` ke `/usr/share/infra/nginx/html`
   - Lightweight image (~50MB vs ~1GB dengan Node)

### Environment Variables in React

Karena React di-build saat Docker build (bukan runtime), environment variables harus di-hardcode atau use runtime config:

**Option 1: Build-time (Current)**
- Set apps/api base URL di code: `/apps/api` (relative path)
- NGINX proxy `/apps/api/*` ke backend

**Option 2: Runtime config**
- Inject config.js saat container start
- Load config di React app

### Production Deployment Checklist

- [ ] Update `.env` dengan real credentials
- [ ] Generate proper SSL certificates
- [ ] Set CORS_ORIGIN ke domain spesifik
- [ ] Setup automated database backups
- [ ] Configure monitoring (e.g., Prometheus + Grafana)
- [ ] Setup log aggregation
- [ ] Test disaster recovery procedures
- [ ] Document rollback procedures

## 🆘 Support

Untuk issues atau questions:
1. Check logs: `docker compose logs [service]`
2. Restart service: `docker compose restart [service]`
3. Rebuild: `docker compose build --no-cache [service]`
4. Contact: [Your contact info]
