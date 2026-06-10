# 🚀 Quick Start Guide - MPS2 Timesheet System

## Setup dalam 5 Menit

### 1. Environment Setup

Buat file `.env` di folder `D:\MPS2\`:

```env
# Database Configuration
DB_NAME=timesheet_db
DB_USER=timesheet_user
DB_PASSWORD=ChangeMeToSecurePassword123!

# API Configuration
PORT=3001
NODE_ENV=production
PLANT_SSB=5071
CORS_ORIGIN=*

# Timezone
TIMEZONE=Asia/Jakarta
```

### 2. SSL Certificate (Development)

```bash
cd D:\MPS2
mkdir -p nginx/ssl
cd nginx/ssl

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -subj "/C=ID/ST=Jakarta/L=Jakarta/O=MPS/CN=ssb.app"

cd ../..
```

### 3. Build & Deploy

```bash
cd D:\MPS2

# Build semua services
docker compose build

# Start semua services
docker compose up -d

# Cek status
docker compose ps
```

### 4. Verifikasi

Buka browser dan akses:
- **Frontend**: https://localhost
- **API Health Check**: https://localhost/timesheet/validation

Abaikan warning SSL certificate (karena self-signed).

## 🛠️ Perintah Berguna

### Lihat Logs
```bash
# Semua services
docker compose logs -f

# Specific service
docker compose logs -f frontend
docker compose logs -f api
docker compose logs -f nginx
```

### Restart Service
```bash
# Restart frontend setelah update code
docker compose restart frontend

# Restart API
docker compose restart api
```

### Update Frontend (Setelah Code Changes)
```bash
# Rebuild dan restart
docker compose build frontend
docker compose up -d frontend
```

### Stop Semua
```bash
docker compose down
```

### Backup Database
```bash
docker exec timesheet-db pg_dump -U timesheet_user timesheet_db > backup_$(date +%Y%m%d).sql
```

## 📂 Struktur Folder

```
MPS2/
├── docker-compose.yml          # Orchestration
├── .env                        # Environment variables (JANGAN COMMIT!)
├── nginx/
│   ├── nginx.conf              # Reverse proxy config
│   └── ssl/                    # SSL certificates
├── API/                        # Node.js Express API
├── react-timesheet/            # React Frontend
└── database/                   # PostgreSQL init scripts
```

## 🔧 Troubleshooting

### Container tidak start?
```bash
# Cek logs untuk error
docker compose logs [service_name]

# Rebuild tanpa cache
docker compose build --no-cache [service_name]
```

### Frontend tidak muncul?
```bash
# Cek build logs
docker compose logs frontend

# Rebuild frontend
docker compose build --no-cache frontend
docker compose up -d frontend
```

### Database connection error?
```bash
# Cek database health
docker compose ps db

# Restart database
docker compose restart db
```

## 📝 Development Workflow

1. **Edit code** di `react-timesheet/src/`
2. **Rebuild frontend**: `docker compose build frontend`
3. **Restart**: `docker compose up -d frontend`
4. **Test**: https://localhost
5. **Commit & Push** ke Git

## 🚨 Catatan Penting

- **JANGAN commit** file `.env` ke Git!
- Gunakan **strong password** untuk production
- Replace **self-signed certificate** dengan real certificate untuk production
- **Backup database** secara regular
- Set `CORS_ORIGIN` ke domain spesifik untuk production (bukan `*`)

## ✅ Checklist Deployment

- [ ] `.env` file dibuat dengan credentials yang aman
- [ ] SSL certificate di-generate
- [ ] Docker images berhasil di-build
- [ ] All containers running (cek dengan `docker compose ps`)
- [ ] Frontend accessible di https://localhost (force HTTPS enabled)
- [ ] API endpoints responding
- [ ] Database migrations applied
- [ ] Backup strategy di-setup

## 🔒 NGINX - Force HTTPS

NGINX sudah dikonfigurasi untuk **selalu force HTTPS**:
- HTTP (port 80) otomatis redirect ke HTTPS (port 443)
- Semua request akan menggunakan SSL/TLS
- Konfigurasi di `nginx/nginx.conf` line 26-30

---

Untuk detail lengkap, lihat [DEPLOYMENT.md](./DEPLOYMENT.md)
