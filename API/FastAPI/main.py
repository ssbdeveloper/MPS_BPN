from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import psycopg2
import os
from dotenv import load_dotenv
from pathlib import Path

# ====================================================
# LOAD ENV DARI MPS2/.env
# ====================================================
BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")

# ====================================================
# CONFIG DARI ENV
# ====================================================
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "db"),   # ← PENTING
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}


PORT = int(os.getenv("PORTFLASK", "8000"))

app = FastAPI(title="MS Project Sync API")


# ====================================================
# SCHEMA UPDATE
# ====================================================
class SowPlanUpdate(BaseModel):
    order_no: str
    operation_no: str
    plan_start: str
    plan_finish: str
    workcenter: Optional[str] = None
    note: Optional[str] = None


def get_conn():
    return psycopg2.connect(**DB_CONFIG)


# ====================================================
# ENDPOINT UPDATE PLAN
# ====================================================
@app.post("/sow/update-plan")
def update_sow_plan(data: SowPlanUpdate):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            UPDATE sow
            SET
                plan_start = %s,
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
                detail="Data tidak ditemukan (order_no + operation_no)"
            )

        conn.commit()

        return {
            "status": "success",
            "updated": cur.rowcount
        }

    finally:
        cur.close()
        conn.close()


# ====================================================
# SCHEMA REQUEST GET ACTUAL
# ====================================================
class KeyRequest(BaseModel):
    keys: list[str]


# ====================================================
# ENDPOINT GET ACTUAL DATA (PAKAI codenumber)
# ====================================================
@app.post("/sow/get-actual")
def get_actual(data: KeyRequest):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute("""
            SELECT
                codenumber,
                actual_progress,
                actual_hours,
                actual_start,
                actual_finish
            FROM sow
            WHERE codenumber = ANY(%s::text[])
        """, (data.keys,))

        rows = cur.fetchall()

        results = []

        for row in rows:
            results.append({
                "codenumber": row[0],
                "actual_progress": float(row[1] or 0),
                "actual_hours": float(row[2] or 0),
                "actual_start": str(row[3]) if row[3] else None,
                "actual_finish": str(row[4]) if row[4] else None
            })

        return {
            "count": len(results),
            "data": results
        }

    finally:
        cur.close()
        conn.close()

# ====================================================
# SCHEMA REQUEST GET MISSING
# ====================================================
class MissingRequest(BaseModel):
    order_no: str
    codenumber: list[str]

# ====================================================
# ENDPOINT GET MISSING OPERATIONS
# ====================================================
@app.post("/sow/get-missing")
def get_missing(data: MissingRequest):

    conn = get_conn()
    cur = conn.cursor()

    try:
        # Ambil semua operasi berdasarkan order_no
        cur.execute("""
            SELECT
                order_no,
                operation_no,
                workcenter,
                planhours,
                operationtext,
                (order_no || operation_no) AS codenumber
            FROM sow
            WHERE order_no = %s
            ORDER BY operation_no
        """, (data.order_no,))

        rows = cur.fetchall()

        results = []

        for row in rows:
            db_codenumber = row[5]

            # ➤ FILTER: kirim hanya yang TIDAK ADA di list dari VBA
            if db_codenumber not in data.codenumber:
                results.append({
                    "order_no": row[0],
                    "operation_no": row[1],
                    "workcenter": row[2],
                    "planhours": float(row[3] or 0),
                    "operationtext": row[4]
                })

        return {
            "order_no": data.order_no,
            "requested_count": len(data.codenumber),
            "missing_count": len(results),
            "data": results
        }

    finally:
        cur.close()
        conn.close()

# ====================================================
# RUN MANUAL
# ====================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=True
    )
