#!/usr/bin/env bash
# Деплой «Барама» на сервере: забрать код, сделать бэкап, пересобрать и перезапустить, проверить запуск.
#
# Вручную:   bash ~/baram/scripts/deploy.sh            — свежая версия главной ветки
#            bash ~/baram/scripts/deploy.sh COMMIT_SHA — конкретный коммит
# Из CI:     ключ CI в ~/.ssh/authorized_keys может запускать только этот скрипт (command=...),
#            SHA коммита приходит в SSH_ORIGINAL_COMMAND. Подробно — docs/DEPLOY.md, «Автодеплой из GitHub».
#
# Mini App включается сам, если в .env задан MINIAPP_DOMAIN.

# Весь скрипт внутри main: bash прочитает его целиком до запуска,
# поэтому git checkout ниже может спокойно обновить этот же файл.
main() {
  set -euo pipefail

  local branch=claude/baram-telegram-bot-v1-q2xmp9
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$dir"

  local sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
  if [[ -n "$sha" && ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ОШИБКА: ожидался полный SHA коммита (40 символов), получено: $sha" >&2
    exit 2
  fi

  # Правки отслеживаемых файлов на сервере не затираем молча: .env, certs/ и backups/ git не трогает.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "ОШИБКА: на сервере изменены файлы проекта, деплой остановлен, чтобы их не потерять:" >&2
    git status --short --untracked-files=no >&2
    echo "Перенесите правки в репозиторий или отмените их (git checkout -- ФАЙЛ) и запустите деплой снова." >&2
    exit 1
  fi

  echo "== Забираем код"
  git fetch --quiet origin "$branch"
  if [[ -z "$sha" ]]; then
    sha="$(git rev-parse FETCH_HEAD)"
  fi
  if ! git merge-base --is-ancestor "$sha" FETCH_HEAD; then
    echo "ОШИБКА: коммит $sha не входит в ветку $branch" >&2
    exit 1
  fi
  local current
  current="$(git rev-parse HEAD)"
  git checkout --quiet -B "$branch" "$sha"
  git branch --quiet --set-upstream-to "origin/$branch"
  echo "Было: $(git log -1 --format='%h %s' "$current")"
  echo "Стало: $(git log -1 --format='%h %s' HEAD)"

  local compose=(docker compose -f docker-compose.prod.yml)
  if grep -qE '^MINIAPP_DOMAIN=.+' .env 2>/dev/null; then
    compose+=(--profile miniapp)
    echo "Mini App включён (MINIAPP_DOMAIN в .env)"
  fi

  # Миграции применяются при старте бота, поэтому копия базы — до перезапуска.
  if [[ -n "$("${compose[@]}" ps --status running -q backup 2>/dev/null)" ]]; then
    echo "== Бэкап базы перед обновлением"
    "${compose[@]}" exec -T backup sh /backup.sh
  else
    echo "== Контейнер backup не запущен, бэкап пропущен"
  fi

  echo "== Сборка и перезапуск"
  local since
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${compose[@]}" up -d --build

  echo "== Проверка запуска бота"
  # До 90 секунд: миграции и подключение к Telegram через прокладку небыстрые.
  local id started logs status="нет контейнера" ok=0
  for _ in $(seq 1 45); do
    id="$("${compose[@]}" ps -q bot)"
    if [[ -n "$id" ]]; then
      status="$(docker inspect -f '{{.State.Status}}' "$id")"
      started="$(docker inspect -f '{{.State.StartedAt}}' "$id")"
      logs="$("${compose[@]}" logs --since "$since" bot 2>&1 || true)"
      if [[ "$logs" == *'Бот не запустился'* ]]; then
        break
      fi
      if [[ "$status" == running && "$(date -ud "$started" +%s)" -lt "$(date -ud "$since" +%s)" ]]; then
        echo "Бот работает: в этом обновлении его контейнер не менялся."
        ok=1
        break
      fi
      if [[ "$status" == running && "$logs" == *'Бот запущен'* ]]; then
        echo "Бот запущен."
        ok=1
        break
      fi
    fi
    sleep 2
  done

  if [[ "$ok" -ne 1 ]]; then
    echo "ОШИБКА: бот не запустился (состояние: $status). Последние строки лога:" >&2
    "${compose[@]}" logs --since "$since" --tail 50 bot >&2 || true
    echo "Откатиться: bash $dir/scripts/deploy.sh $current" >&2
    exit 1
  fi

  # Старые образы после пересборки занимают место на диске.
  docker image prune -f >/dev/null
  echo "== Готово: $(git log -1 --format='%h %s')"
}

main "$@"
exit
