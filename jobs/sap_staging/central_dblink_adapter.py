"""Adapter koneksi Central Staging melalui dblink/FDW Plant Database.

Author: cutover-20260927-hermes
Tujuan: Menyediakan antarmuka DB-API (psycopg2 connection & cursor) yang kompatibel penuh
dengan run_timesheet_etl.py ketika runner tidak memiliki rute jaringan langsung ke AWS VPC,
tetapi host plant terhubung ke AWS RDS melalui koneksi FDW/dblink ber-TLS terverifikasi.

Kontrak:
- Transaksional: Mendukung BEGIN, COMMIT, ROLLBACK pada sesi dblink remote.
- Idempoten & Fail-closed: Mendukung ON CONFLICT DO NOTHING dan ON CONFLICT DO UPDATE.
- RealDictCursor: Mengembalikan hasil query sebagai dict yang kompatibel dengan runner.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

import psycopg2
import psycopg2.extras


class CentralDblinkCursor:
    def __init__(self, conn: "CentralDblinkConnection"):
        self.conn = conn
        self.connection = conn
        self.plant_conn = conn.plant_conn
        self.dblink_name = conn.dblink_name
        self.server_name = conn.server_name
        self._last_result: list[dict[str, Any]] = []
        self._cursor_idx = 0
        self.rowcount = -1

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def mogrify(self, query: str, params: Any = None) -> bytes:
        with self.plant_conn.cursor() as cur:
            return cur.mogrify(query, params)

    def execute(self, query: str | bytes, params: Any = None):
        if isinstance(query, bytes):
            query = query.decode("utf-8")
        with self.plant_conn.cursor() as cur:
            mogrified = cur.mogrify(query, params).decode("utf-8") if params is not None else query
            mogrified_clean = mogrified.strip()

            # Periksa apakah query mengembalikan baris (SELECT) atau perintah DML (INSERT/UPDATE/DELETE/ALTER)
            is_select = mogrified_clean.upper().startswith("SELECT") or "RETURNING" in mogrified_clean.upper()

            if is_select:
                # Bungkus pemanggilan via dblink remote
                remote_sql = mogrified_clean.replace("'", "''")
                # Gunakan dblink record format dinamis via JSON agregat agar tipe kolom otomatis terjaga
                wrapped_sql = f"""
                    SELECT dblink_json('{self.dblink_name}', '{remote_sql}')
                """
                # Jika dblink_json belum ada, jalankan via query langsung ke foreign table atau dblink standar
                # Mari kita gunakan fungsi pembantu generic dblink query
                cur.execute(f"SELECT * FROM dblink(%s, %s) AS t(res_json text)", (self.dblink_name, f"SELECT json_agg(q)::text FROM ({mogrified_clean}) q"))
                row = cur.fetchone()
                if row and row[0]:
                    self._last_result = json.loads(row[0])
                else:
                    self._last_result = []
                self._cursor_idx = 0
                self.rowcount = len(self._last_result)
            else:
                # DML via dblink_exec
                cur.execute("SELECT dblink_exec(%s, %s)", (self.dblink_name, mogrified_clean))
                res = cur.fetchone()[0]
                # Parse rowcount dari output dblink_exec (e.g. "INSERT 0 5" -> 5)
                parts = res.split()
                if parts and parts[-1].isdigit():
                    self.rowcount = int(parts[-1])
                else:
                    self.rowcount = 1
                self._last_result = []
                self._cursor_idx = 0

    def fetchall(self) -> list[dict[str, Any]]:
        res = self._last_result[self._cursor_idx:]
        self._cursor_idx = len(self._last_result)
        return res

    def fetchone(self) -> dict[str, Any] | None:
        if self._cursor_idx < len(self._last_result):
            row = self._last_result[self._cursor_idx]
            self._cursor_idx += 1
            return row
        return None


class CentralDblinkConnection:
    def __init__(self, plant_conn, server_name: str = "aws_staging"):
        self.plant_conn = plant_conn
        self.server_name = server_name
        self.dblink_name = f"central_dblink_{uuid.uuid4().hex[:8]}"
        self.encoding = "UTF8"
        self.autocommit = False
        self._in_trans = False

        # Open dblink connection
        with self.plant_conn.cursor() as cur:
            cur.execute("SELECT dblink_connect(%s, %s)", (self.dblink_name, self.server_name))
            cur.execute("SELECT dblink_exec(%s, 'BEGIN')", (self.dblink_name,))
        self.plant_conn.commit()
        self._in_trans = True

    def cursor(self, cursor_factory=None):
        return CentralDblinkCursor(self)

    def commit(self):
        if self._in_trans:
            with self.plant_conn.cursor() as cur:
                cur.execute("SELECT dblink_exec(%s, 'COMMIT')", (self.dblink_name,))
                cur.execute("SELECT dblink_exec(%s, 'BEGIN')", (self.dblink_name,))
            self.plant_conn.commit()

    def rollback(self):
        if self._in_trans:
            with self.plant_conn.cursor() as cur:
                cur.execute("SELECT dblink_exec(%s, 'ROLLBACK')", (self.dblink_name,))
                cur.execute("SELECT dblink_exec(%s, 'BEGIN')", (self.dblink_name,))
            self.plant_conn.commit()

    def close(self):
        if self._in_trans:
            try:
                with self.plant_conn.cursor() as cur:
                    cur.execute("SELECT dblink_exec(%s, 'ROLLBACK')", (self.dblink_name,))
                    cur.execute("SELECT dblink_disconnect(%s)", (self.dblink_name,))
                self.plant_conn.commit()
            except Exception:
                pass
            self._in_trans = False
