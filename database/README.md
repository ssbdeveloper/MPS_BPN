# Database

- `schema/` stores schema dumps and baseline SQL.
- `migrations/` stores runnable migration SQL grouped by source/domain.
- `migrations/legacy/` stores older migration scripts that were previously in `database/`.
- `seeds/` stores seed/import SQL, CSV, and helper scripts.
- Domain folders such as `machinehours/` and `toolsmanagement/` remain grouped by data ownership.
