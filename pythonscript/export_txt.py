import os
import re
import pandas as pd
import psycopg2
from filelock import FileLock, Timeout

LOCK_FILE = "/tmp/sow_export.lock"
EXPORT_DIR = "/data/export"

os.makedirs(EXPORT_DIR, exist_ok=True)

def safe_filename(value) -> str:
    value = str(value).strip()
    value = re.sub(r"[\/\\:*?\"<>|]", "-", value)
    value = re.sub(r"\s+", "_", value)
    return value

# Urutan kolom output sesuai spesifikasi
OUTPUT_COLUMNS = [
    "Order Number",
    "Material Number",
    "Plant",
    "Order Type",
    "Total Order Quantity",
    "Common unit of measure for all order items",
    "Basic start date",
    "Basic finish date",
    "Key for Task List Group",
    "Group Counter",
    "Work Breakdown Structure Element (WBS Element)",
    "Goods Recipient",
    "Unloading Point",
    "Operation/Activity Number",
    "Work Center",
    "Operation Short Text",
    "Base Quantity",
    "Unit of measure for activity",
    "Standard Value",
    "Unit of Measurement of Standard Value",
]

def build_output_df(group_df: pd.DataFrame) -> pd.DataFrame:
    """Map source fields ke output columns sesuai spesifikasi."""
    out = pd.DataFrame()

    out["Order Number"]                                          = group_df["order_no"]
    out["Material Number"]                                       = ""
    out["Plant"]                                                 = ""
    out["Order Type"]                                            = ""
    out["Total Order Quantity"]                                  = ""
    out["Common unit of measure for all order items"]            = ""
    out["Basic start date"]                                      = ""
    out["Basic finish date"]                                     = ""
    out["Key for Task List Group"]                               = ""
    out["Group Counter"]                                         = ""
    out["Work Breakdown Structure Element (WBS Element)"]        = ""
    out["Goods Recipient"]                                       = ""
    out["Unloading Point"]                                       = ""
    out["Operation/Activity Number"]                             = group_df["operation_no"]
    out["Work Center"]                                           = group_df["workcenter"]
    out["Operation Short Text"]                                  = group_df["operation_text"]
    out["Base Quantity"]                                         = 1
    out["Unit of measure for activity"]                          = "PC"
    out["Standard Value"]                                        = group_df["planhours"]
    out["Unit of Measurement of Standard Value"]                 = "HR"

    return out[OUTPUT_COLUMNS]

try:
    lock = FileLock(LOCK_FILE, timeout=1)
    with lock:
        print("🔒 Lock acquired, starting export")

        conn = psycopg2.connect(
            host=os.getenv("DB_HOST", "db"),
            port=os.getenv("DB_PORT", "5432"),
            dbname=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD")
        )

        select_query = """
        SELECT
            order_no,
            ssbr_id,
            part_name,
            operation_text,
            operation_no,
            planhours,
            workcenter
        FROM sow
        WHERE sync <> 'update'
          AND order_no IS NOT NULL
        ORDER BY order_no, operation_no
        """

        df = pd.read_sql(select_query, conn)

        if df.empty:
            print("ℹ No new data to export")
            conn.close()
            exit(0)

        cursor = conn.cursor()

        for order_no, g in df.groupby("order_no"):
            order_no_safe = safe_filename(order_no)
            ssbr_id_safe  = safe_filename(g.ssbr_id.iloc[0])
            part_safe     = safe_filename(g.part_name.iloc[0])

            # ← ekstensi diubah ke .txt
            filename = f"{order_no_safe}_{ssbr_id_safe}_{part_safe}.txt"
            filepath = os.path.join(EXPORT_DIR, filename)

            # Build & export dengan TAB delimiter
            output_df = build_output_df(g.reset_index(drop=True))
            output_df.to_csv(
                filepath,
                sep="\t",       # TAB delimiter
                index=False,    # tanpa index column
            )

            print("✔ exported", filepath)

            cursor.execute(
                "UPDATE sow SET sync = 'update' WHERE order_no = %s",
                (order_no,)
            )

        conn.commit()
        cursor.close()
        conn.close()

        print("✅ Export & sync update finished")

except Timeout:
    print("⏳ Another export is still running. Skipping this run.")

except Exception as e:
    print("❌ Error occurred:", e)