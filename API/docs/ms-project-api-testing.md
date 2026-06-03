# MS Project API Testing

Base URL examples:

```bash
BASE_URL=http://localhost:3001/ms-project
```

Run the migration manually before write tests:

```bash
psql "$DATABASE_URL" -f API/migrations/20260603_create_ms_project_integration.sql
```

Do not run write tests against production unless the target project/resource rows are test data.

## 1. Health

```bash
curl "$BASE_URL/health"
```

## 2. Refresh Resources

First refresh:

```bash
curl -X POST "$BASE_URL/resources/refresh" \
  -H "Content-Type: application/json" \
  -d '{"sources":["WORKCENTER","MACHINE","EMPLOYEE"]}'
```

Run the same request again and verify `created` does not grow unexpectedly.

## 3. Search Resources

```bash
curl "$BASE_URL/resources?active=true&category=PERSON&limit=10"
curl "$BASE_URL/resources?active=true&category=MACHINE&limit=10"
curl "$BASE_URL/resources?active=true&category=WORKCENTER&limit=10"
```

Copy returned `resource_id` values for publish/sync tests.

## 4. Publish New Project

Replace resource UUIDs before running.

```bash
curl -X POST "$BASE_URL/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "project": {
      "project_name": "MS Project API Test",
      "description": "Temporary integration test",
      "status": "ACTIVE"
    },
    "project_resources": [
      { "resource_id": "00000000-0000-0000-0000-000000000001" },
      { "resource_id": "00000000-0000-0000-0000-000000000002" }
    ],
    "tasks": [
      {
        "local_task_uid": "1",
        "task_name": "Summary",
        "outline_level": 1,
        "outline_number": "1",
        "is_summary": true
      },
      {
        "local_task_uid": "2",
        "parent_local_task_uid": "1",
        "task_name": "Operation A",
        "outline_level": 2,
        "outline_number": "1.1",
        "plan_start": "2026-06-03T08:00:00+07:00",
        "plan_finish": "2026-06-03T16:00:00+07:00",
        "duration_minutes": 480,
        "planned_work_minutes": 480
      },
      {
        "local_task_uid": "3",
        "parent_local_task_uid": "1",
        "task_name": "Operation B",
        "outline_level": 2,
        "outline_number": "1.2",
        "plan_start": "2026-06-04T08:00:00+07:00",
        "plan_finish": "2026-06-04T16:00:00+07:00",
        "duration_minutes": 480,
        "planned_work_minutes": 480
      }
    ],
    "assignments": [
      {
        "local_assignment_uid": "10",
        "local_task_uid": "2",
        "resource_id": "00000000-0000-0000-0000-000000000001",
        "assignment_units": 1.0,
        "planned_work_minutes": 480,
        "assignment_start": "2026-06-03T08:00:00+07:00",
        "assignment_finish": "2026-06-03T16:00:00+07:00"
      },
      {
        "local_assignment_uid": "11",
        "local_task_uid": "3",
        "resource_id": "00000000-0000-0000-0000-000000000002",
        "assignment_units": 1.0,
        "planned_work_minutes": 480,
        "assignment_start": "2026-06-04T08:00:00+07:00",
        "assignment_finish": "2026-06-04T16:00:00+07:00"
      }
    ],
    "dependencies": [
      {
        "local_dependency_key": "2|3|FS|0",
        "predecessor_local_task_uid": "2",
        "successor_local_task_uid": "3",
        "dependency_type": "FS",
        "lag_minutes": 0
      }
    ]
  }'
```

Save `project_id`, `revision_no`, `task_mappings`, `assignment_mappings`, and `dependency_mappings`.

## 5. Sync Existing Project

Replace IDs and revision number from the publish response.

```bash
curl -X PUT "$BASE_URL/projects/PROJECT_UUID/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "project": {
      "project_id": "PROJECT_UUID",
      "project_name": "MS Project API Test",
      "last_known_revision_no": 1
    },
    "project_resources": [
      { "resource_id": "00000000-0000-0000-0000-000000000001" },
      { "resource_id": "00000000-0000-0000-0000-000000000002" }
    ],
    "tasks": [
      {
        "task_id": "TASK_UUID",
        "local_task_uid": "2",
        "task_name": "Operation A Updated",
        "plan_start": "2026-06-03T09:00:00+07:00",
        "plan_finish": "2026-06-03T17:00:00+07:00",
        "duration_minutes": 480,
        "planned_work_minutes": 480
      }
    ],
    "assignments": [],
    "dependencies": []
  }'
```

Run the same sync with an old `last_known_revision_no` to verify `409 PROJECT_REVISION_CONFLICT`.

## 6. Explicit Deactivate

```bash
curl -X PUT "$BASE_URL/projects/PROJECT_UUID/sync" \
  -H "Content-Type: application/json" \
  -d '{
    "project": {
      "project_id": "PROJECT_UUID",
      "last_known_revision_no": 2
    },
    "project_resources": [],
    "tasks": [],
    "assignments": [],
    "dependencies": [],
    "deactivate": {
      "assignment_ids": ["ASSIGNMENT_UUID"],
      "dependency_ids": ["DEPENDENCY_UUID"],
      "task_ids": ["TASK_UUID"],
      "resource_ids": []
    }
  }'
```

## 7. Project Resource Team

```bash
curl "$BASE_URL/projects/PROJECT_UUID/resources"

curl -X POST "$BASE_URL/projects/PROJECT_UUID/resources" \
  -H "Content-Type: application/json" \
  -d '{"resource_ids":["RESOURCE_UUID"]}'

curl -X DELETE "$BASE_URL/projects/PROJECT_UUID/resources/RESOURCE_UUID"
```

Deactivate should return `409` if the resource is still used by active assignments.

## 8. Package and Bulk Load

```bash
curl "$BASE_URL/projects/PROJECT_UUID/package"

curl -X POST "$BASE_URL/projects/bulk-load" \
  -H "Content-Type: application/json" \
  -d '{"project_ids":["PROJECT_UUID_1","PROJECT_UUID_2"]}'
```

## 9. Conflict Checks

```bash
curl "$BASE_URL/resources/conflicts?category=PERSON"
curl "$BASE_URL/resources/conflicts?category=MACHINE"
curl "$BASE_URL/resources/conflicts?category=WORKCENTER"
curl "$BASE_URL/resources/conflicts?project_id=PROJECT_UUID&start=2026-06-03T00:00:00%2B07:00&finish=2026-06-05T00:00:00%2B07:00"
```

Verify individual resources use pairwise overlap and generic resources report peak concurrent units.

## 10. Invalid Requests

Invalid UUID:

```bash
curl "$BASE_URL/projects/not-a-uuid/package"
```

Invalid units:

```bash
curl -X POST "$BASE_URL/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "project": { "project_name": "Bad Units Test" },
    "project_resources": [],
    "tasks": [
      { "local_task_uid": "1", "task_name": "Task" }
    ],
    "assignments": [
      {
        "local_assignment_uid": "1",
        "local_task_uid": "1",
        "resource_id": "00000000-0000-0000-0000-000000000001",
        "assignment_units": 0
      }
    ],
    "dependencies": []
  }'
```
