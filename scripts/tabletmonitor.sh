#!/usr/bin/env bash
# Render tabel dari DB ptssb.tablet_status (urut sort_order), berwarna.
set -euo pipefail
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ENV DB (biar gak blank di watch)
export PGHOST=127.0.0.1
export PGPORT=5433
export PGUSER=tag
export PGPASSWORD='@dminta9'
export PGDATABASE=ptssb

PSQL=/usr/bin/psql  # sesuaikan kalau beda: which psql

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
w1=12; w2=15; w3=10; w4=8; w5=6
rep(){ printf '%*s' "$1" '' | tr ' ' "$2"; }
top="┌$(rep $((w1+2)) '─')┬$(rep $((w2+2)) '─')┬$(rep $((w3+2)) '─')┬$(rep $((w4+2)) '─')┬$(rep $((w5+2)) '─')┐"
mid="├$(rep $((w1+2)) '─')┼$(rep $((w2+2)) '─')┼$(rep $((w3+2)) '─')┼$(rep $((w4+2)) '─')┼$(rep $((w5+2)) '─')┤"
bot="└$(rep $((w1+2)) '─')┴$(rep $((w2+2)) '─')┴$(rep $((w3+2)) '─')┴$(rep $((w4+2)) '─')┴$(rep $((w5+2)) '─')┘"

SQL="SELECT device, host(ip) AS ip, connection,
            COALESCE(CASE WHEN connection='ONLINE' THEN to_char(rate_ms,'FM999999990.00') END,'') AS rate,
            success_pct
     FROM tablet_status
     ORDER BY sort_order;"

# Ambil data; kalau error, tampilkan pesan biar gak blank
if ! mapfile -t ROWS < <("$PSQL" -qAt -F '|' -c "$SQL" 2>/tmp/tablet_render.err); then
  echo "TABLET MONITORING"
  printf '%s\n%s\n' "$top" "│ $(printf '%-*s' $w1 DEVICE) │ $(printf '%-*s' $w2 IP) │ $(printf '%-*s' $w3 CONNECTION) │ $(printf '%-*s' $w4 RATE\(ms\)) │ $(printf '%-*s' $w5 OUTPUT) │"
  printf '%s\n' "$mid"
  echo "│ $(printf '%-*s' $((w1+w2+w3+w4+w5+12)) "DB ERROR: $(tr -d '\r' </tmp/tablet_render.err | tail -1)") │"
  printf '%s\n' "$bot"
  exit 1
fi

echo "TABLET MONITORING"
printf '%s\n' "$top"
printf '│ %-*s │ %-*s │ %-*s │ %-*s │ %-*s │\n' \
  "$w1" "DEVICE" "$w2" "IP" "$w3" "CONNECTION" "$w4" "RATE(ms)" "$w5" "OUTPUT"
printf '%s\n' "$mid"

for row in "${ROWS[@]}"; do
  IFS='|' read -r DEV IP CONN RATE PCT <<<"$row"
  printf -v conn_p '%-*s' "$w3" "$CONN"
  printf -v rate_p '%-*s' "$w4" "$RATE"
  printf -v pct_p  '%-*s' "$w5" "${PCT}%"
  [[ "$CONN" == "ONLINE" ]] && conn_c="${GREEN}${conn_p}${RESET}" || conn_c="${RED}${conn_p}${RESET}"
  pct_c="${YELLOW}${pct_p}${RESET}"
  printf '│ %-*s │ %-*s │ %s │ %s │ %s │\n' "$w1" "$DEV" "$w2" "$IP" "$conn_c" "$rate_p" "$pct_c"
done
printf '%s\n' "$bot"