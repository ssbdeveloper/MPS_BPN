# NGINX Configuration Guide

## 🔒 Force HTTPS - Konfigurasi

NGINX sudah dikonfigurasi untuk **SELALU memaksa HTTPS** pada semua request.

### Konfigurasi Force HTTPS (nginx/nginx.conf)

```nginx
# HTTP Server Block (Port 80)
server {
  listen 80;
  server_name _;
  return 301 https://$host$request_uri;  # ← FORCE REDIRECT KE HTTPS
}

# HTTPS Server Block (Port 443)
server {
  listen 443 ssl http2;
  server_name ssb.app;

  ssl_certificate     /etc/nginx/ssl/server.crt;
  ssl_certificate_key /etc/nginx/ssl/server.key;

  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers on;

  # ... routes configuration ...
}
```

### Cara Kerja Force HTTPS

1. **User akses HTTP** (http://localhost)
   - Request masuk ke port 80
   - NGINX langsung redirect dengan status code `301` (Permanent Redirect)
   - Browser otomatis pindah ke HTTPS

2. **User akses HTTPS** (https://localhost)
   - Request masuk ke port 443
   - SSL/TLS handshake
   - NGINX melayani request dengan SSL encryption

### Verifikasi Force HTTPS

```bash
# Test redirect HTTP ke HTTPS
curl -I http://localhost
# Expected output:
# HTTP/1.1 301 Moved Permanently
# Location: https://localhost/

# Test HTTPS response
curl -k https://localhost
# Expected: React app HTML
```

## 🔀 Routing Configuration

### 1. React Frontend (SPA)
```nginx
location / {
  proxy_pass http://frontend_app;  # → timesheet-frontend:80
  proxy_http_version 1.1;

  # Headers
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # React Router support
  proxy_intercept_errors on;
  error_page 404 = @frontend;
}

location @frontend {
  proxy_pass http://frontend_app;
  # ... headers same as above
}
```

**Penjelasan:**
- Semua request ke `/` (root) di-proxy ke React container
- `error_page 404 = @frontend` untuk support React Router client-side routing
- Request ke `/dashboard`, `/login-timesheet`, dll akan dihandle oleh React Router

### 2. API Backend
```nginx
location ~ ^/(usernfc|workcenter|timesheet|sow|process-category|process-parameter|process-parameter-choicebase|process-control|process-control-item)(/.*)?$ {
  proxy_pass http://api_backend;  # → timesheet-api:3001
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Penjelasan:**
- API endpoints specific: `/usernfc/*`, `/timesheet/*`, etc.
- Regex match untuk support sub-paths
- Proxy ke Express API container pada port 3001

### 3. Streamlit Dashboard
```nginx
location ^~ /spc/ {
  proxy_pass http://spc_dashboard/;  # → spc-dashboard:8501
  proxy_http_version 1.1;

  # WebSocket support untuk Streamlit
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";

  proxy_read_timeout 86400;  # 24 hours
}
```

**Penjelasan:**
- Streamlit dashboard accessible di `/spc/`
- WebSocket support untuk real-time updates
- Long timeout untuk interactive sessions

## 🔧 Upstream Configuration

```nginx
upstream api_backend {
  server timesheet-api:3001;
}

upstream spc_dashboard {
  server spc-dashboard:8501;
}

upstream frontend_app {
  server timesheet-frontend:80;
}
```

**Penjelasan:**
- Upstream blocks define backend servers
- Docker service names digunakan (resolved via Docker DNS)
- Internal container ports

## 🛡️ SSL/TLS Configuration

### Current Setup (Development)
```nginx
ssl_certificate     /etc/nginx/ssl/server.crt;      # Self-signed cert
ssl_certificate_key /etc/nginx/ssl/server.key;      # Private key

ssl_protocols TLSv1.2 TLSv1.3;                      # Modern protocols only
ssl_prefer_server_ciphers on;                        # Server cipher preference
```

### Production Recommendations

```nginx
# Let's Encrypt certificates
ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

# Modern SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256...';
ssl_prefer_server_ciphers off;

# SSL optimizations
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
ssl_session_tickets off;

# HSTS (force HTTPS for 1 year)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

## 📝 Testing Configuration

### Reload NGINX (No Downtime)
```bash
# Test config first
docker compose exec nginx nginx -t

# Reload if OK
docker compose exec nginx nginx -s reload
```

### Restart NGINX Container
```bash
docker compose restart nginx
```

### View NGINX Logs
```bash
# Access logs
docker compose exec nginx tail -f /var/log/nginx/access.log

# Error logs
docker compose exec nginx tail -f /var/log/nginx/error.log

# All logs
docker compose logs -f nginx
```

## 🔍 Troubleshooting

### 1. 502 Bad Gateway
**Penyebab**: Backend container tidak running atau tidak reachable

**Solution**:
```bash
# Check backend status
docker compose ps

# Check backend logs
docker compose logs frontend
docker compose logs api

# Restart backend
docker compose restart frontend
```

### 2. SSL Certificate Error
**Penyebab**: Certificate tidak valid atau expired

**Solution**:
```bash
# Regenerate self-signed cert
cd nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -subj "/C=ID/ST=Jakarta/L=Jakarta/O=MPS/CN=ssb.app"

# Restart NGINX
docker compose restart nginx
```

### 3. React Router 404
**Penyebab**: NGINX tidak fallback ke index.html

**Solution**:
Pastikan ada `error_page 404 = @frontend` di config (sudah ada di setup ini)

### 4. CORS Issues
**Penyebab**: Backend tidak set CORS headers dengan benar

**Solution**:
Check API `.env`:
```env
CORS_ORIGIN=*  # Development
CORS_ORIGIN=https://yourdomain.com  # Production
```

## 📊 Performance Tuning

```nginx
# Worker processes (adjust based on CPU cores)
worker_processes auto;

# Events configuration
events {
  worker_connections 1024;
  use epoll;  # Linux only
  multi_accept on;
}

# HTTP configuration
http {
  # Keepalive
  keepalive_timeout 65;
  keepalive_requests 100;

  # Gzip compression
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_comp_level 6;
  gzip_types text/plain text/css text/xml text/javascript
             application/json application/javascript application/xml+rss;

  # Client body size
  client_max_body_size 100M;

  # Timeouts
  client_body_timeout 12;
  client_header_timeout 12;
  send_timeout 10;
}
```

## 🔗 References

- **Config File**: `nginx/nginx.conf`
- **SSL Certificates**: `nginx/ssl/`
- **Docker Compose**: `docker-compose.yml`
- **NGINX Docs**: https://nginx.org/en/docs/

## ✅ Summary

- ✅ **Force HTTPS**: ENABLED (all HTTP → HTTPS redirect)
- ✅ **SSL/TLS**: TLSv1.2 & TLSv1.3
- ✅ **React SPA**: Client-side routing supported
- ✅ **API Proxy**: Backend API proxied correctly
- ✅ **WebSocket**: Streamlit dashboard support
- ✅ **HTTP/2**: Enabled for better performance

**All traffic is encrypted and secured with HTTPS!** 🔒
