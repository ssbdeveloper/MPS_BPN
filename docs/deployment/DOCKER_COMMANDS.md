---
tags: [domain/ops]
---

# Docker Compose Commands Reference

Quick reference untuk Docker Compose commands (v2 syntax: `docker compose`)

## 🏗️ Build Commands

```bash
# Build semua services
docker compose build

# Build specific service
docker compose build frontend
docker compose build api

# Build tanpa cache (force rebuild)
docker compose build --no-cache frontend

# Build dengan pull latest base images
docker compose build --pull
```

## ▶️ Start/Stop Commands

```bash
# Start semua services (detached mode)
docker compose up -d

# Start dengan build
docker compose up -d --build

# Start specific service
docker compose up -d frontend

# Stop semua services
docker compose down

# Stop dan remove volumes (DANGER!)
docker compose down -v

# Restart specific service
docker compose restart frontend

# Restart semua services
docker compose restart
```

## 📊 Monitoring Commands

```bash
# Lihat status containers
docker compose ps

# Lihat logs semua services
docker compose logs

# Lihat logs specific service (follow mode)
docker compose logs -f frontend
docker compose logs -f api
docker compose logs -f nginx

# Lihat logs dengan timestamp
docker compose logs -f -t frontend

# Lihat last 100 lines
docker compose logs --tail=100 frontend

# Resource usage
docker stats
```

## 🔧 Management Commands

```bash
# Execute command di container
docker compose exec frontend sh
docker compose exec api sh
docker compose exec db psql -U timesheet_user -d timesheet_db

# Run one-off command
docker compose run --rm frontend npm run build

# Scale service (if applicable)
docker compose up -d --scale api=3

# Pull latest images
docker compose pull

# View service config
docker compose config
```

## 🗑️ Cleanup Commands

```bash
# Remove stopped containers
docker compose rm

# Remove stopped containers (force)
docker compose rm -f

# Prune unused Docker resources
docker system prune

# Prune everything including volumes (DANGER!)
docker system prune -a --volumes
```

## 🔄 Update Workflow

### Update Frontend (React App)
```bash
# 1. Edit code di apps/web/src/
# 2. Rebuild dan restart
docker compose build frontend
docker compose up -d frontend

# 3. Verify
docker compose logs -f frontend
```

### Update API
```bash
# 1. Edit code di apps/api/
# 2. Rebuild dan restart
docker compose build api
docker compose up -d api

# 3. Verify
docker compose logs -f api
```

### Update NGINX Config
```bash
# 1. Edit infra/nginx/nginx.conf
# 2. Reload config (no downtime)
docker compose exec nginx nginx -s reload

# Or restart nginx container
docker compose restart nginx
```

## 💾 Database Operations

```bash
# Backup database
docker exec timesheet-db pg_dump -U timesheet_user timesheet_db > backup_$(date +%Y%m%d).sql

# Restore database
docker exec -i timesheet-db psql -U timesheet_user -d timesheet_db < backup.sql

# Connect to database
docker compose exec db psql -U timesheet_user -d timesheet_db

# Run SQL file
docker exec -i timesheet-db psql -U timesheet_user -d timesheet_db < migration.sql
```

## 🐛 Debugging Commands

```bash
# Inspect container
docker inspect timesheet-frontend

# View container processes
docker compose top frontend

# Check network
docker network inspect mps2_timesheet-network

# Check volumes
docker volume inspect mps2_postgres_data

# Follow build output
docker compose build --progress=plain frontend

# Verify container health
docker compose ps
```

## 🚀 Production Deploy

```bash
# Full deployment
docker compose build --pull
docker compose down
docker compose up -d

# Check all services are healthy
docker compose ps

# Monitor logs for errors
docker compose logs -f
```

## 🔒 Security Best Practices

```bash
# Never commit .env file!
echo ".env" >> .gitignore

# Use secrets for sensitive data (Docker Swarm)
docker secret create db_password ./db_password.txt

# Scan images for vulnerabilities
docker scan timesheet-frontend:latest
```

## 📝 Notes

- **Docker Compose v2** uses `docker compose` (with space), not `docker-compose` (with dash)
- All commands assume you're in the `D:\MPS2` directory
- Use `-d` flag for detached mode (run in background)
- Use `-f` flag for follow mode (stream logs)
- Check `.env` file for environment variables
- NGINX force HTTPS is enabled by default

## 🔗 Related Files

- `docker-compose.yml` - Service definitions
- `infra/nginx/nginx.conf` - NGINX configuration
- `.env` - Environment variables (GITIGNORE!)
- `scripts/deploy.sh` - Helper script for common tasks
