from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import psycopg2
from psycopg2 import pool
import os
from pathlib import Path


# ====================================================
# LOAD ENV (optional, only for local dev)
# ====================================================
BASE_DIR = Path(__file__).resolve().parent
if (BASE_DIR / ".env").exists():
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")

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
                   operationtext
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
                "operationtext": r[4]
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
        if data.order_no:
            cur.execute("""
                SELECT order_no,
                       operation_no,
                       workcenter,
                       planhours,
                       operationtext,
                       plan_start,
                       plan_finish
                FROM sow
                WHERE sync = 'new'
                  AND order_no = %s
                ORDER BY order_no, operation_no
            """, (data.order_no,))
        else:
            cur.execute("""
                SELECT order_no,
                       operation_no,
                       workcenter,
                       planhours,
                       operationtext,
                       plan_start,
                       plan_finish
                FROM sow
                WHERE sync = 'new'
                ORDER BY order_no, operation_no
            """)

        rows = cur.fetchall()

        results = [
            {
                "order_no": r[0],
                "operation_no": r[1],
                "workcenter": r[2],
                "planhours": float(r[3] or 0),
                "operationtext": r[4],
                "plan_start": str(r[5]) if r[5] else None,
                "plan_finish": str(r[6]) if r[6] else None
            }
            for r in rows
        ]

        return {
            "count": len(results),
            "data": results
        }

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
