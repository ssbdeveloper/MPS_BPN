from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import psycopg2
import psycopg2.extras
from psycopg2 import pool
import os
from pathlib import Path

from tts_announcement import (
    generate_announcement_mp3,
    make_announcement_filename,
)


# ====================================================
# LOAD ENV (optional, only for local dev)
# ====================================================
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parents[1]
API_DIR = ROOT_DIR / "API"

if (ROOT_DIR / ".env").exists() or (BASE_DIR / ".env").exists():
    from dotenv import load_dotenv
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BASE_DIR / ".env", override=True)

# ====================================================
# CONFIG
# ====================================================
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "db"),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "connect_timeout": 5
}

PORT = int(os.getenv("PORTFLASK", "8000"))
TTS_UPLOAD_ROOT = Path(os.getenv("TTS_UPLOAD_ROOT", API_DIR / "uploads"))
TTS_ANNOUNCEMENT_DIR = TTS_UPLOAD_ROOT / "announcement"
TTS_ANNOUNCEMENT_PUBLIC_PREFIX = "/uploads/announcement"
TTS_LEGACY_ANNOUNCEMENT_DIR = BASE_DIR / "upload" / "announcement"
TTS_LEGACY_ANNOUNCEMENT_PUBLIC_PREFIX = "/upload/announcement"

# ====================================================
# CONNECTION POOL 
# ====================================================
db_pool = pool.SimpleConnectionPool(
    1,
    10,
    **DB_CONFIG
)

def get_conn():
    return db_pool.getconn()

def release_conn(conn):
    db_pool.putconn(conn)

# ====================================================
# FASTAPI INIT
# ====================================================
app = FastAPI(title="MS Project Sync API")


# ====================================================
# HEALTH CHECK
# ====================================================
@app.get("/health")
def health():
    return {"status": "ok"}


# ====================================================
# SCHEMAS
# ====================================================
class SowPlanUpdate(BaseModel):
    order_no: str
    operation_no: str
    plan_start: str
    plan_finish: str
    workcenter: Optional[str] = None
    note: Optional[str] = None


class KeyRequest(BaseModel):
    keys: List[str]


class MissingRequest(BaseModel):
    order_no: str
    codenumber: List[str]


class TtsGenerateRequest(BaseModel):
    ssbr_id: str


def ensure_tts_notification_order_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.tts_notification_order (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                path_mp3 TEXT NOT NULL,
                status BOOLEAN NOT NULL DEFAULT false,
                log_audio JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tts_notification_order_status_created
            ON public.tts_notification_order (status, created_at)
        """)
    conn.commit()


def announcement_file_from_path(path_mp3: str) -> Path:
    if not path_mp3:
        raise HTTPException(status_code=404, detail="Path audio kosong")

    path_options = (
        (f"{TTS_ANNOUNCEMENT_PUBLIC_PREFIX}/", TTS_ANNOUNCEMENT_DIR),
        (f"{TTS_LEGACY_ANNOUNCEMENT_PUBLIC_PREFIX}/", TTS_LEGACY_ANNOUNCEMENT_DIR),
    )
    for prefix, base_dir in path_options:
        if not path_mp3.startswith(prefix):
            continue

        filename = Path(path_mp3.removeprefix(prefix)).name
        file_path = base_dir / filename
        try:
            file_path.resolve().relative_to(base_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Path audio tidak valid")

        return file_path

    raise HTTPException(status_code=400, detail="Path audio tidak valid")


# ====================================================
# TTS ANNOUNCEMENT
# ====================================================
@app.post("/tts/generate")
def generate_tts_announcement(data: TtsGenerateRequest):
    ssbr_id = (data.ssbr_id or "").strip()
    if not ssbr_id:
        raise HTTPException(status_code=400, detail="ssbr_id wajib diisi")

    filename = make_announcement_filename(ssbr_id)
    file_path = TTS_ANNOUNCEMENT_DIR / filename
    public_path = f"{TTS_ANNOUNCEMENT_PUBLIC_PREFIX}/{filename}"

    try:
        audio_log = generate_announcement_mp3(ssbr_id, file_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal generate audio: {exc}") from exc

    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO public.tts_notification_order (path_mp3, status, log_audio)
            VALUES (%s, false, %s)
            RETURNING id, path_mp3, status, log_audio
            """,
            (
                public_path,
                psycopg2.extras.Json({
                    **audio_log,
                    "path_mp3": public_path,
                }),
            ),
        )
        row = cur.fetchone()
        conn.commit()

        return {
            "id": row[0],
            "path_mp3": row[1],
            "status": row[2],
            "log_audio": row[3],
            "audio_url": f"/tts/audio/{row[0]}",
        }
    except Exception as exc:
        conn.rollback()
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"Gagal simpan notif audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/next")
def get_next_tts_audio():
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, path_mp3
            FROM public.tts_notification_order
            WHERE status = false
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Tidak ada audio announcement yang pending")

        notification_id, path_mp3 = row
        file_path = announcement_file_from_path(path_mp3)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File audio tidak ditemukan")

        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET status = true,
                updated_at = now()
            WHERE id = %s
            """,
            (notification_id,),
        )
        conn.commit()

        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_path.name,
            headers={"X-TTS-Notification-Id": str(notification_id)},
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal ambil audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/{notification_id}")
def get_tts_audio(notification_id: int):
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, path_mp3
            FROM public.tts_notification_order
            WHERE id = %s
            """,
            (notification_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notif audio tidak ditemukan")

        file_path = announcement_file_from_path(row[1])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File audio tidak ditemukan")

        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET status = true,
                updated_at = now()
            WHERE id = %s
            """,
            (notification_id,),
        )
        conn.commit()

        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_path.name,
            headers={"X-TTS-Notification-Id": str(notification_id)},
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal ambil audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


# ====================================================
# UPDATE PLAN
# ====================================================
@app.post("/sow/update-plan")
def update_sow_plan(data: SowPlanUpdate):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            UPDATE sow
            SET plan_start = %s,
                plan_finish = %s,
                workcenter = %s
            WHERE order_no = %s
              AND operation_no = %s
        """, (
            data.plan_start,
            data.plan_finish,
            data.workcenter,
            data.order_no,
            data.operation_no
        ))

        if cur.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Data tidak ditemukan"
            )

        conn.commit()

        return {"status": "success", "updated": cur.rowcount}

    finally:
        cur.close()
        release_conn(conn)


# ====================================================
# GET ACTUAL
# ====================================================
@app.post("/sow/get-actual")
def get_actual(data: KeyRequest):

    if not data.keys:
        return {"count": 0, "data": []}

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT codenumber,
                   actual_progress,
                   actual_hours,
                   actual_start,
                   actual_finish
            FROM sow
            WHERE codenumber = ANY(%s::text[])
        """, (data.keys,))

        rows = cur.fetchall()

        results = [
            {
                "codenumber": r[0],
                "actual_progress": float(r[1] or 0),
                "actual_hours": float(r[2] or 0),
                "actual_start": str(r[3]) if r[3] else None,
                "actual_finish": str(r[4]) if r[4] else None
            }
            for r in rows
        ]

        return {"count": len(results), "data": results}

    finally:
        cur.close()
        release_conn(conn)


# ====================================================
# GET MISSING 
# ====================================================
@app.post("/sow/get-missing")
def get_missing(data: MissingRequest):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT order_no,
                   operation_no,
                   workcenter,
                   planhours,
                   operation_text
            FROM sow
            WHERE order_no = %s
              AND (order_no || operation_no) != ALL(%s)
            ORDER BY operation_no
        """, (data.order_no, data.codenumber))

        rows = cur.fetchall()

        results = [
            {
                "order_no": r[0],
                "operation_no": r[1],
                "workcenter": r[2],
                "planhours": float(r[3] or 0),
                "operation_text": r[4]
            }
            for r in rows
        ]

        return {
            "order_no": data.order_no,
            "requested_count": len(data.codenumber),
            "missing_count": len(results),
            "data": results
        }

    finally:
        cur.close()
        release_conn(conn)


class SowPlanUpdateBulk(BaseModel):
    items: List[SowPlanUpdate]


@app.post("/sow/update-plan-bulk")
def update_sow_plan_bulk(data: SowPlanUpdateBulk):

    conn = get_conn()
    cur = conn.cursor()

    try:
        values = [
            (
                item.plan_start,
                item.plan_finish,
                item.workcenter,
                item.order_no,
                item.operation_no
            )
            for item in data.items
        ]

        cur.executemany("""
            UPDATE sow
            SET plan_start = %s,
                plan_finish = %s,
                workcenter = %s
            WHERE order_no = %s
              AND operation_no = %s
        """, values)

        conn.commit()

        return {
            "status": "success",
            "updated": len(values)
        }

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        release_conn(conn)

# ====================================================
# GET NEW (sync = 'new')
# ====================================================
class GetNewRequest(BaseModel):
    order_no: Optional[str] = None  # Optional filter by order_no

@app.post("/sow/get-new")
def get_new_operations(data: GetNewRequest):
    conn = get_conn()
    cur = conn.cursor()

    try:
        query = """
            SELECT order_no,
                   operation_no,
                   workcenter,
                   planhours,
                   operation_text,
                   plan_start,
                   plan_finish,
                   ssbr_id,
                   part_name
            FROM sow
            WHERE sync = 'modified'
        """
        params = []
        if data.order_no:
            query += " AND order_no = %s"
            params.append(data.order_no)

        query += " ORDER BY order_no, operation_no"

        cur.execute(query, params if params else None)
        rows = cur.fetchall()

        results = [
            {
                "order_no":      r[0],
                "operation_no":  r[1],
                "workcenter":    r[2],
                "planhours":     float(r[3] or 0),
                "operation_text": r[4],
                "plan_start":    str(r[5]) if r[5] else None,
                "plan_finish":   str(r[6]) if r[6] else None,
                "ssbr_id":       r[7],
                "part_name":     r[8]
            }
            for r in rows
        ]

        return {"count": len(results), "data": results}

    finally:
        cur.close()
        release_conn(conn)

# ====================================================
# POST UPDATE sync SCHEDULED
# ====================================================
class SyncUpdateRequest(BaseModel):
    order_nos: List[str]
    sync_status: str = "scheduled"

@app.post("/sow/update-sync")
def update_sync_status(data: SyncUpdateRequest):
    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            UPDATE sow
            SET sync = %s
            WHERE order_no = ANY(%s::text[])
        """, (data.sync_status, data.order_nos))

        conn.commit()
        return {"status": "success", "updated": cur.rowcount}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        release_conn(conn)

# ====================================================
# RUN MANUAL (DEV ONLY)
# ====================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=True
    )
