# MPS2 Deployment Architecture Analysis

> **Date**: 2026-05-09  
> **Current State**: 6-service Docker Compose on single host  
> **Goal**: Evaluate current architecture vs more granular microservice approach

---

## 1. Current Architecture

| Service | Role | Language | Base Image |
|---------|------|----------|------------|
| `db` | PostgreSQL 15 | — | `postgres:15-alpine` |
| `api` | REST + WebSocket backend (14 controllers, 54 routes under `/sow` alone) | Node.js 20 | `node:20-alpine` |
| `frontend` | React SPA served via nginx | JS/React 19 | `nginx:alpine` |
| `nginx` | Reverse proxy + SSL termination | — | `nginx:alpine` |
| `fastapi` | MS Project sync | Python 3.11 | `python:3.11-slim` |
| `sow_exporter` | SOW CSV/TXT export | Python 3.11 | `python:3.11-slim` |

```
                    ┌──────────────┐
                    │   Browser    │
                    └──────┬───────┘
                           │ :443
                    ┌──────▼───────┐
                    │    nginx     │  SSL term · reverse proxy
                    └──┬───────┬───┘
              /api/    │       │    /, /assets
            ┌──────────▼┐  ┌──▼──────────┐
            │    api    │  │  frontend   │
            │  :3001    │  │    :80      │
            └─────┬─────┘  └─────────────┘
                  │
        ┌─────────┼─────────┬──────────────┐
   ┌────▼───┐ ┌───▼────┐ ┌─▼─────────┐
   │   db   │ │fastapi │ │sow_exp.   │
   │  :5432 │ │ :8000  │ │  (batch)  │
   └────────┘ └────────┘ └───────────┘
```

**This is already a modular architecture**, not a "single container for the entire system." Each concern has its own build context, Dockerfile, and runtime container.

---

## 2. Assessment by Dimension

### 2.1 Skalabilitas

| Factor | Current | Score |
|--------|---------|-------|
| Horizontal scaling | Can scale `api`/`frontend` independently via `docker compose up -d --scale api=3` | ⭐⭐⭐⭐ |
| Vertical scaling | Each service gets its own resource allocation | ⭐⭐⭐⭐ |
| DB bottleneck | Single PostgreSQL — all modules share one DB | ⭐⭐ |
| Statelessness | `api` and `frontend` are stateless (except uploads volume) | ⭐⭐⭐⭐ |

**Verdict**: Adequate for internal plant-level deployment (tens to low hundreds of concurrent users). The real bottleneck is the shared PostgreSQL instance, not the container layout.

### 2.2 Maintainability

| Factor | Current | Score |
|--------|---------|-------|
| Code colocation | All API code in `API/controllers/` — easy to navigate | ⭐⭐⭐⭐⭐ |
| Build independence | Change to `api` only rebuilds `api` image | ⭐⭐⭐⭐ |
| Debugging | `docker logs timesheet-api` — single source of truth per service | ⭐⭐⭐⭐ |
| Configuration | One `.env` file at root — shared across all services | ⭐⭐⭐ |

**Verdict**: Good. The single `.env` file is both a strength (simplicity) and a weakness (no per-service isolation).

### 2.3 Complexity

**Current complexity is appropriate for the scale.** The project has:
- 1 team / small number of developers
- ~35 frontend pages across 5 modules (TIMESHEET, MACHINE_H, PPC, PE, WAREHOUSE)
- 1 database
- 1 plant deployment per instance

Adding per-module containers would introduce:
- Inter-service communication complexity (REST/gRPC/message queue)
- Distributed transaction challenges
- Service discovery needs
- More failure modes

### 2.4 Resource Usage

| Service | Approx RAM | Notes |
|---------|-----------|-------|
| `db` | ~300-500 MB | Shared memory 1 GB |
| `api` | ~80-150 MB | Node.js single process |
| `frontend` | ~10-20 MB | Static nginx serving |
| `nginx` | ~10-20 MB | Reverse proxy only |
| `fastapi` | ~80-120 MB | Python uvicorn |
| `sow_exporter` | ~50-80 MB | Batch job |

**Total**: ~600-900 MB for the full stack. This is reasonable for a single host. Splitting into more containers would increase overhead (each microservice needs its own Node/Python runtime, ~50-80 MB minimum per process).

---

## 3. Comparison: Current vs. Per-Module Microservices

### Option A: Current (Modular Monolith API + Separate Frontend)

```
api (Express 14 controllers)
  ├── /timesheet/*
  ├── /sow/*
  ├── /dashboard/*
  ├── /process-control/*
  ├── /machine-hours-*/*
  ├── /consumable/*
  ├── /auth/*
  └── ... (8 more)
```

| Pros | Cons |
|------|------|
| Single process, zero inter-service latency | One process crash affects all modules |
| Simple deployment: `docker compose up -d` | Can't scale Timesheet independently from Dashboard |
| Easy debugging: one log stream | All controllers compete for Node.js event loop |
| Single DB connection pool (20 connections) | Large codebase in one process (2370+ lines per controller) |
| No distributed transaction problems | Module boundaries blur over time |

### Option B: Per-Module Microservices

```
timesheet-api (Express, port 3001)
machine-api    (Express, port 3002)
dashboard-api  (Express, port 3003)
ppc-api        (Express, port 3004)
warehouse-api  (Express, port 3005)
auth-api       (Express, port 3006)

Each with its own:
  - routes/controllers
  - Dockerfile
  - DB connection pool
  - nginx upstream block
```

| Pros | Cons |
|------|------|
| Independent scaling per module | **15+ containers** to manage |
| Isolated crash radius | Each needs its own DB pool (5-10 connections × 6 = 30-60 DB connections minimum) |
| Smaller codebases per service | Cross-module queries become complex (e.g., Dashboard needs data from Sow + Timesheet + Machine Hours) |
| Teams could own individual services | Inter-service API calls add latency and failure points |
| Independent deploy cadence | Need service discovery / API gateway |
| | Build/deploy pipeline complexity multiplies |

---

## 4. Cross-Module Dependency Analysis

A key argument against splitting: **the modules are highly interdependent**.

| Feature | Reads from | Writes to |
|---------|-----------|-----------|
| Dashboard | `sow`, `timesheet_transaction`, `processcontroldata`, `mch_productiondata` | — |
| Timesheet Validation | `timesheet_transaction`, `processcontroldata` | `timesheet_transaction` |
| Machine Hours Validation | SQL Server `ProductionData`, `ph3_order` | — |
| Component Tracking | `sow`, `buffer_transaction`, `components` | `buffer_transaction` |
| SOW Create | `components`, `sow_standard`, `workcenter` | `sow` |
| Receiving Shipment | `components`, `receiving_orders` | `receiving_orders` |
| Consumable Control | `consumable_stock`, `consumable_ticket` | `consumable_ticket` |

**All modules share `sow` and `timesheet_transaction` tables.** Splitting them across services would mean either:
- Duplicated read access to shared tables (data consistency risk)
- Inter-service API calls for cross-module data (latency + failure)

---

## 5. Recommendation

### Keep the current modular-but-cohesive architecture.

The current design is **not** a "single container monolith" — it's a **well-structured modular monolith with independent frontend/backend deployment**. This is the right pattern for:

1. **Team size**: 1-3 developers
2. **Deployment**: Single plant, 4 instances (Balikpapan, Sebamban, Kuala Kencana, Cikupa)
3. **Data model**: Heavily shared tables across modules
4. **Current scale**: Internal manufacturing system, not public SaaS

### When to consider splitting

Only if these thresholds are crossed:

| Trigger | Threshold |
|---------|-----------|
| Team size | > 8 developers working on different modules simultaneously |
| Deploy frequency | Different modules need independent deploy cadence (e.g., Timesheet weekly vs Dashboard monthly) |
| Scale | Single `api` instance can't handle load (currently serving tens of users, not thousands) |
| Organizational | Different teams own different modules with different priorities |

---

## 6. Incremental Improvements (Do Now)

These improvements can be made **without splitting services**:

### 6.1 DB Connection Pool Tuning
```yaml
# Currently max: 20 for all 14 controllers
# Recommendation: bump to 30 to handle connection spikes
# In API/server.js
const pool = new Pool({
  max: 30,  # was 20
  idleTimeoutMillis: 30000,
});
```

### 6.2 Per-Module Health Checks
```javascript
// Add to server.js
app.get('/health/:module', (req, res) => {
  // Check if sow table accessible, etc.
});
```

### 6.3 Structured Logging
```bash
# Use docker compose logs with service filtering
docker compose logs -f api | grep -E '\[ERROR\]|\[WARN\]'
```

### 6.4 Optional: Separate the Dashboard
The Dashboard is the best candidate for a separate service because:
- It's read-only (no write contention)
- It's the most query-intensive module
- It could benefit from a read replica

```yaml
# Optional future: dashboard-api service
dashboard-api:
  build: ./API
  environment:
    - DB_HOST=db-replica  # read-only replica
  expose: ["3002"]
  command: ["node", "dashboard-server.js"]  # only mounts dashboard routes
```

### 6.5 CI/CD Improvements
```yaml
# GitHub Actions / GitLab CI strategy
# Build only changed services
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      api: ${{ steps.filter.outputs.api }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - uses: dorny/paths-filter@v2
        id: filter
        with:
          filters: |
            api: 'API/**'
            frontend: 'react-timesheet/**'
```

---

## 7. Risk Matrix

| Risk | Current Architecture | If Split Per Module |
|------|---------------------|---------------------|
| Single point of failure (API) | **Medium** — one API process | Low — module crash isolated |
| Database contention | **Low** — single pool, managed | **High** — multiple pools competing |
| Cross-module data inconsistency | **None** — same process | **High** — eventual consistency needed |
| Deployment complexity | **Low** | **High** — 6+ more Dockerfiles, nginx configs |
| Debugging difficulty | **Low** — single log stream | **Medium** — distributed tracing needed |
| Code coupling | **Medium** — controllers can import each other | **Low** — forced by service boundary |
| Resource overhead | **Low** — 1 Node.js runtime | **High** — 6+ Node.js runtimes |

---

## 8. Final Verdict

> **Stay with the current architecture.** It is already modular (6 services), appropriately scoped for the team size and deployment scale, and avoids the complexity tax of distributed systems without sacrificing the key benefits.

The current design follows the **"modular monolith"** pattern — the most appropriate architecture for internal manufacturing systems:
- Deploy as one logical unit
- Develop with clear module boundaries in code
- Scale vertically first, horizontally when needed
- Extract services only when the data model or organizational structure demands it

**The single biggest improvement to the current deployment is not splitting containers — it's optimizing the Docker build context (already addressed in `refactor.md`) and tuning database connections.**
