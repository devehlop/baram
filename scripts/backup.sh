#!/bin/sh
# Бэкап базы «Барам»: сжатый дамп в /backups, старше KEEP_DAYS дней — удаляются.
# Режимы: `backup.sh` — один бэкап сейчас; `backup.sh loop` — каждый день в 03:30 по Москве.
# Восстановление: gunzip -c backups/baram-ДАТА.sql.gz | psql -h ХОСТ -U baram baram
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP="${KEEP_DAYS:-14}"

run_backup() {
  mkdir -p "$DIR"
  file="$DIR/baram-$(TZ=Europe/Moscow date +%Y-%m-%d_%H-%M).sql.gz"
  pg_dump --no-owner --no-privileges | gzip > "$file.tmp"
  # Пустой или обрезанный дамп не должен затирать ощущение, что бэкап есть.
  if [ "$(gzip -dc "$file.tmp" | tail -n 5 | grep -c 'PostgreSQL database dump complete')" -ne 1 ]; then
    echo "$(date) ОШИБКА: дамп не завершён, файл удалён" >&2
    rm -f "$file.tmp"
    return 1
  fi
  mv "$file.tmp" "$file"
  find "$DIR" -name 'baram-*.sql.gz' -mtime "+$KEEP" -delete
  echo "$(date) Бэкап готов: $file ($(du -h "$file" | cut -f1))"
}

if [ "${1:-once}" = "loop" ]; then
  while true; do
    # Часы и минуты без ведущего нуля: иначе «08» читается как неверное восьмеричное число.
    now_h=$(TZ=Europe/Moscow date +%H | sed 's/^0//')
    now_m=$(TZ=Europe/Moscow date +%M | sed 's/^0//')
    # Секунд до ближайших 03:30 по Москве.
    wait=$(( ((3 * 60 + 30) - (now_h * 60 + now_m) + 1440) % 1440 * 60 ))
    [ "$wait" -eq 0 ] && wait=86400
    sleep "$wait"
    run_backup || true
  done
else
  run_backup
fi
