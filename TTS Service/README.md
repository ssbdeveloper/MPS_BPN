# TTS Service — Task Tracking System

## Overview
Monitors remaining plan hours per order and generates notifications when hours are exhausted.

## Database Objects
| Object | Type | Purpose |
|--------|------|---------|
| `tts_notifications` | Table | Stores notifications for orders with exhausted hours |
| `mv_order_remaining_hours` | Materialized View | Calculates remaining hours per order_no |
| `generate_remaining_hours_notifications()` | Function | Inserts/updates notifications from the view |

## Quick Start

### 1. Run migration
```bash
psql -U postgres -d ptssb -f TTS\ Service/migrate_tts.sql
```

### 2. Refresh + generate (manual)
```bash
cd TTS\ Service
python refresh_and_notify.py
```

### 3. Cron (every 30 minutes)
```bash
*/30 * * * * cd /path/to/MPS2/TTS\ Service && python refresh_and_notify.py >> logs/tts.log 2>&1
```

## Business Logic
- **Plan hours**: SUM of `sow.planhours` grouped by `order_no`
- **Actual hours**: SUM of `timesheet_transaction.duration` grouped by `order_no` (excludes `state_flag = 5`)
- **TECO filter**: Orders marked as TECO in `ph3_order` are excluded (uses `LTRIM` for leading zero normalization)
- **Notification trigger**: When `remaining_hours <= 0`, a notification record is created/updated

## Columns — tts_notifications
| Column | Type | Description |
|--------|------|-------------|
| order_no | TEXT | Order number (unique) |
| ssbr_id | TEXT | SSBR identifier from sow |
| part_name | TEXT | Part name from sow |
| total_planhours | NUMERIC | Sum of planhours |
| total_actual_hours | NUMERIC | Sum of actual duration |
| remaining_hours | NUMERIC | planhours - actual_hours |
| status | TEXT | Default 'pending' |


cd ~/MPS2/"TTS Service"/models

wget -O "id_ID.onnx" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx

wget -O "id_ID.onnx.json" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json