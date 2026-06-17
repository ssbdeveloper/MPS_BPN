docker compose run --rm sow_exporter
crontab -e
*/10 * * * * cd /path/MPS2 && docker compose run --rm sow_exporter >> export.log 2>&1
