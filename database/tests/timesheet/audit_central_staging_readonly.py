#!/usr/bin/env python3
"""Audit READ-ONLY schema central staging SUNGGUHAN (AWS RDS ssb_dw).

Temuan: di plant ptssb, `sap_timesheet_staging`, `sap_staging_source`, dan
`sap_staging_exclusion` BUKAN tabel lokal melainkan FOREIGN TABLE (postgres_fdw)
yang menunjuk server `aws_staging`. Karena itu diff terhadap objek lokal di plant
adalah artefak: foreign table tidak boleh punya PK/index lokal dan kolomnya selalu
terlihat nullable.

Skrip ini:
  1. membaca koordinat remote + kredensial dari katalog FDW plant (tanpa mencetak),
  2. konek ke AWS RDS dalam sesi READ ONLY + verifikasi `transaction_read_only`,
  3. introspeksi kolom/tipe/index/constraint dari katalog remote,
  4. membandingkan dengan DDL local lab `mps_sap_staging_test`,
  5. menulis JSON + ringkas ke stdout. TIDAK ADA DDL/DML.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[3]
ENV = dotenv_values(REPO_ROOT / ".env")
OUT_DIR = Path(os.environ.get("LOCALAPPDATA", "/tmp")) / "Temp"

TABLES = [
    "sap_timesheet_staging",
    "sap_staging_source",
    "sap_staging_exclusion",
    "sap_stage_cursor",
    "sap_staging_eligibility_audit",
]


def plant_conn():
    conn = psycopg2.connect(
        host=ENV.get("DB_HOST"), port=int(ENV.get("DB_PORT") or 5433),
        dbname=ENV.get("DB_NAME"), user=ENV.get("DB_USER"),
        password=ENV.get("DB_PASSWORD"), connect_timeout=20,
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn


def read_fdw_target():
    """Ambil host/db/port + user/password FDW. Nilai dikembalikan, TIDAK dicetak."""
    q = """
    SELECT s.srvname,
           (SELECT o FROM unnest(s.srvoptions) o WHERE o LIKE 'host=%') AS h,
           (SELECT o FROM unnest(s.srvoptions) o WHERE o LIKE 'dbname=%') AS d,
           (SELECT o FROM unnest(s.srvoptions) o WHERE o LIKE 'port=%') AS p
    FROM pg_foreign_server s WHERE s.srvname = 'aws_staging'
    """
    c = plant_conn()
    try:
        with c.cursor() as cur:
            cur.execute(q)
            _, h, d, p = cur.fetchone()
            cur.execute(
                "SELECT (SELECT o FROM unnest(umoptions) o WHERE o LIKE 'user=%'),"
                "       (SELECT o FROM unnest(umoptions) o WHERE o LIKE 'password=%')"
                " FROM pg_user_mapping WHERE umserver = "
                "(SELECT oid FROM pg_foreign_server WHERE srvname='aws_staging')"
            )
            u, pw = cur.fetchone()
    finally:
        c.close()

    def val(opt):
        return opt.split("=", 1)[1] if opt else None

    return {
        "host": val(h), "dbname": val(d),
        "port": int(val(p) or 5432),
        "user": val(u), "password": val(pw),
    }


def remote_conn(t):
    conn = psycopg2.connect(
        host=t["host"], port=t["port"], dbname=t["dbname"],
        user=t["user"], password=t["password"], connect_timeout=20,
        options="-c default_transaction_read_only=on",
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn


def local_conn():
    conn = psycopg2.connect(
        host="localhost", port=5432, dbname="mps_sap_staging_test",
        user="postgres", password=ENV.get("DB_PASSWORD"), connect_timeout=10,
    )
    conn.set_session(readonly=True, autocommit=True)
    return conn


COLUMNS = """
SELECT c.relname, a.attname,
       format_type(a.atttypid, a.atttypmod) AS ftype,
       a.attnotnull,
       EXISTS (SELECT 1 FROM pg_constraint p
               WHERE p.conrelid = c.oid AND p.contype='p'
                 AND a.attnum = ANY(p.conkey)) AS in_pk
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname='public' AND c.relname = ANY(%s)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum
"""

INDEXES = """
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename = ANY(%s) ORDER BY 1,2
"""

CONSTRAINTS = """
SELECT c.relname, con.conname, con.contype::text, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname = ANY(%s) ORDER BY 1,2
"""

RELKIND = """
SELECT c.relname, c.relkind::text FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname = ANY(%s)
"""


def snap(conn, tags):
    out = {"columns": {}, "indexes": {}, "constraints": {}, "relkind": {}, "present": []}
    with conn.cursor() as cur:
        cur.execute(RELKIND, (tags,))
        out["relkind"] = dict(cur.fetchall())
        out["present"] = sorted(out["relkind"])
        cur.execute(COLUMNS, (tags,))
        for t, col, ftype, notnull, in_pk in cur.fetchall():
            out["columns"].setdefault(t, {})[col] = {
                "type": ftype, "notnull": bool(notnull), "in_pk": bool(in_pk),
            }
        cur.execute(INDEXES, (tags,))
        for t, n, ddl in cur.fetchall():
            out["indexes"].setdefault(t, {})[n] = ddl
        cur.execute(CONSTRAINTS, (tags,))
        for t, n, ctype, ddl in cur.fetchall():
            out["constraints"].setdefault(t, {})[n] = {"type": ctype, "def": ddl}
    return out


def diff(remote, local):
    rep, s = {"tables": {}}, {}
    s["kolom_remote_tidak_di_lokal"] = s["kolom_lokal_tidak_di_remote"] = 0
    s["tipe_berbeda"] = s["notnull_berbeda"] = 0
    s["tabel_hilang_di_remote"] = sorted(set(TABLES) - set(remote["present"]))
    s["tabel_hilang_di_lokal"] = sorted(set(TABLES) - set(local["present"]))
    for t in TABLES:
        rc, lc = remote["columns"].get(t, {}), local["columns"].get(t, {})
        e = {
            "remote_relkind": remote["relkind"].get(t),
            "hanya_di_remote": sorted(set(rc) - set(lc)),
            "hanya_di_lokal": sorted(set(lc) - set(rc)),
            "tipe_beda": [], "notnull_beda": [],
            "pk_remote": sorted(n for n, c in remote["constraints"].get(t, {}).items()
                                if c["type"] == "p"),
            "pk_lokal": sorted(n for n, c in local["constraints"].get(t, {}).items()
                               if c["type"] == "p"),
            "index_remote": sorted(remote["indexes"].get(t, {})),
            "index_lokal": sorted(local["indexes"].get(t, {})),
        }
        for col in sorted(set(rc) & set(lc)):
            if rc[col]["type"] != lc[col]["type"]:
                e["tipe_beda"].append({"kolom": col, "remote": rc[col]["type"],
                                       "lokal": lc[col]["type"]})
            if rc[col]["notnull"] != lc[col]["notnull"]:
                e["notnull_beda"].append({"kolom": col, "remote_NOT_NULL": rc[col]["notnull"],
                                          "lokal_NOT_NULL": lc[col]["notnull"]})
        s["kolom_remote_tidak_di_lokal"] += len(e["hanya_di_remote"])
        s["kolom_lokal_tidak_di_remote"] += len(e["hanya_di_lokal"])
        s["tipe_berbeda"] += len(e["tipe_beda"])
        s["notnull_berbeda"] += len(e["notnull_beda"])
        rep["tables"][t] = e
    rep["summary"] = s
    return rep


def main():
    t = read_fdw_target()
    print("[*] Central staging = FDW 'aws_staging' -> AWS RDS")
    print(f"    host={t['host']} db={t['dbname']} port={t['port']} user={t['user']}")
    print("    password=[REDACTED - dibaca dari pg_user_mapping, tidak pernah dicetak]")

    rc = remote_conn(t)
    try:
        with rc.cursor() as cur:
            cur.execute("SHOW transaction_read_only")
            ro = cur.fetchone()[0]
            cur.execute("SELECT current_user, version()")
            who, ver = cur.fetchone()
            print(f"[*] terhubung sebagai {who}; transaction_read_only={ro}")
            print(f"    {ver.split(',')[0]}")
            if ro != "on":
                raise SystemExit("ABORT: sesi remote TIDAK read-only")
        remote = snap(rc, TABLES)
    finally:
        rc.close()

    lc = local_conn()
    try:
        local = snap(lc, TABLES)
    finally:
        lc.close()

    rep = {"target": {"host": t["host"], "dbname": t["dbname"], "port": t["port"],
                      "user": t["user"]},
           "remote": remote, "local": local, "diff": diff(remote, local)}
    p = OUT_DIR / "staging_schema_diff_real.json"
    p.write_text(json.dumps(rep, indent=2, default=str), encoding="utf-8")

    print(f"\n=== RINGKASAN DIFF (remote ssb_dw  vs  lokal lab) ===")
    print(json.dumps(rep["diff"]["summary"], indent=2, ensure_ascii=False))
    for tb, e in rep["diff"]["tables"].items():
        flags = []
        if e["hanya_di_remote"]: flags.append(f"hanya_di_remote={e['hanya_di_remote']}")
        if e["hanya_di_lokal"]: flags.append(f"hanya_di_lokal={e['hanya_di_lokal']}")
        if e["tipe_beda"]: flags.append(f"tipe_beda={e['tipe_beda']}")
        if e["notnull_beda"]: flags.append(f"notnull_beda={len(e['notnull_beda'])} kolom")
        if e["pk_remote"] != e["pk_lokal"]:
            flags.append(f"PK remote={e['pk_remote']} lokal={e['pk_lokal']}")
        print(f"\n[{tb}] relkind_remote={e['remote_relkind']}")
        for f in flags:
            print("   -", f)
        if not flags:
            print("   - identik")
    print(f"\n[+] {p}")


if __name__ == "__main__":
    main()
