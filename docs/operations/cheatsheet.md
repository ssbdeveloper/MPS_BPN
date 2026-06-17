# Edit nginx.conf
notepad nginx/nginx.conf

# Test config
docker-compose exec nginx nginx -t

# Reload (no downtime)
docker-compose exec nginx nginx -s reload

# Restart (minimal downtime)
docker-compose restart nginx

# Full restart semua
docker-compose restart

# Rebuild API (kalau edit code)
docker-compose up -d --build api

# Rebuild semua
docker-compose up -d --build
sudo docker compose up -d --build


# 1. Edit file
notepad nginx/nginx.conf

# 2. Test
docker-compose exec nginx nginx -t

# 3. Apply
docker-compose exec nginx nginx -s reload

# 4. Check
docker-compose logs nginx
curl -k https://localhost/health

# File path salah, cek mount
docker-compose exec nginx ls -la /etc/nginx/nginx.conf

# Re-mount
docker-compose down
docker-compose up -d

# Lihat detail error
docker-compose exec nginx nginx -t

# Fix syntax error, lalu test lagi