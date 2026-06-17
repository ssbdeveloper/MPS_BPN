#!/usr/bin/env bash
# Update status ke Postgres (tanpa CREATE TABLE).
# Ping tiap host 4x @1s (sekuensial), lalu UPSERT ke ptssb.tablet_status sekali di akhir.

set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# --- KONFIG DB (sesuai minta) ---
export PGHOST=127.0.0.1
export PGPORT=5433
export PGUSER=tag
export PGPASSWORD='@dminta9'
PGDB=ptssb

# --- PARAM PING (bisa override via env) ---
COUNT="${COUNT:-4}"         # jumlah ping per host
INTERVAL="${INTERVAL:-1}"   # detik antar paket
TIMEOUT="${TIMEOUT:-1}"     # timeout per paket (detik)
MIN_OK="${MIN_OK:-1}"       # minimal sukses agar dianggap ONLINE
PRUNE="${PRUNE:-0}"         # 1=hapus dari DB device yang tidak ada di list

# --- FILE LIST ---
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIST="${1:-$BASE_DIR/tablet.list}"

PSQL=/usr/bin/psql
PING=/bin/ping
FPING="$(command -v fping || true)"

[[ -f "$LIST" ]] || { echo "File list tidak ada: $LIST" >&2; exit 1; }

# --- baca list (tahan CRLF) ---
devs=(); ips=()
while IFS='|' read -r D I; do
  [[ -z "${D:-}" || "${D:0:1}" == "#" ]] && continue
  D="${D%$'\r'}"; I="${I%$'\r'}"
  devs+=("$D"); ips+=("$I")
done < "$LIST"

# --- fungsi ping satu host (4x @1s, sekuensial) ---
ping_host() {
  local ip="$1" out rcv avg
  if [[ -n "$FPING" ]]; then
    out="$("$FPING" -c "$COUNT" -p $((INTERVAL*1000)) -t $((TIMEOUT*1000)) -q "$ip" 2>&1 || true)"
    rcv="$(sed -n -E 's/.*xmt\/rcv\/%loss = [0-9]+\/([0-9]+)\/.*/\1/p' <<<"$out")"
    avg="$(sed -n -E 's/.*min\/avg\/max(\/mdev)? = [^/]+\/([^/]+)\/.*/\2/p' <<<"$out")"
  else
    out="$("$PING" -c "$COUNT" -i "$INTERVAL" -W "$TIMEOUT" "$ip" 2>/dev/null || true)"
    rcv="$(sed -n -E 's/.* ([0-9]+) (packets )?received.*/\1/p' <<<"$out")"
    avg="$(sed -n -E 's/.*min\/avg\/max(\/mdev|\/stddev)? = [^/]+\/([^/]+)\/.*/\2/p' <<<"$out")"
  fi
  rcv=${rcv:-0}
  if (( rcv >= MIN_OK )); then
    printf 'ONLINE|%s|%d\n' "$( [[ -n "${avg:-}" ]] && printf '%.2f' "$avg" || printf '' )" $((100*rcv/COUNT))
  else
    printf 'OFFLINE||0\n'
  fi
}

# --- (opsional) PRUNE device yang tidak ada di list ---
if [[ "$PRUNE" == "1" ]]; then
  mapfile -t DBDEVS < <("$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -qAt -c "SELECT device FROM tablet_status;")
  declare -A seen=(); for d in "${devs[@]}"; do seen["$d"]=1; done
  for d in "${DBDEVS[@]}"; do
    [[ -z "${seen[$d]+x}" ]] && "$PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -qAt -c "DELETE FROM tablet_status WHERE device='$d';"
  done
fi

# --- ping semua host SEKUENSIAL; simpan hasil ---
statuses=(); rates=(); pcts=()
for i in "${!ips[@]}"; do
  IFS='|' read -r status rate pct <<<"$(ping_host "${ips[$i]}")"
  statuses[$i]="$status"
  rates[$i]="$rate"
  pcts[$i]="$pct"
done

# --- UPSERT SEKALI KE DB (tanpa CREATE TABLE) ---
sql="BEGIN;"
for i in "${!devs[@]}"; do
  dev="${devs[$i]//\'/\'\'}"
  ip="${ips[$i]//\'/\'\'}"
  status="${statuses[$i]}"
  rate="${rates[$i]}"
  pct="${pcts[$i]}"
  order=$((i+1))
  [[ "$status" == "ONLINE" && -n "$rate" ]] && rate_sql="$rate" || rate_sql="NULL"

  sql+=$'\n'"INSERT INTO tablet_status (device, ip, sort_order, connection, rate_ms, success_pct, last_checked)
VALUES ('$dev', '$ip', $order, '$status', $rate_sql, $pct, now())
ON CONFLICT (device) DO UPDATE
SET ip = EXCLUDED.ip,
    sort_order = EXCLUDED.sort_order,
    connection = EXCLUDED.connection,
    rate_ms = EXCLUDED.rate_ms,
    success_pct = EXCLUDED.success_pct,
    last_checked = EXCLUDED.last_checked;"
done
sql+=$'\n'"COMMIT;"

$PSQL -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -qAt -v ON_ERROR_STOP=1 <<<"$sql"

echo "Update selesai: $(date '+%F %T') | rows=${#devs[@]}"