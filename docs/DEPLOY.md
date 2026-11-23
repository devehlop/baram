# Запуск на сервере

Нужен сервер в России (Timeweb Cloud, Yandex Cloud и т. п.): по 152-ФЗ имена, телефоны и адреса хранятся на серверах в РФ. Хватит самого малого тарифа: 1 ядро, 1–2 ГБ памяти, Ubuntu 24.04.

Домен и сертификат для чат-бота не нужны: бот сам ходит в Telegram (long polling).

Все команды ниже написаны латиницей: их можно вставлять в терминал как есть. Где нужно подставить своё значение, стоит заглавное слово на английском (`MAIN_SERVER_IP`, `YOUR_ID`). Команды вставляются в терминал, в строку вида `root@server:~#`, а не в редактор `nano`.

## 1. Подготовить сервер

Подключитесь по SSH (`ssh root@MAIN_SERVER_IP`) и обновите систему:

```bash
apt update && apt upgrade -y
```

Включите брандмауэр, оставив открытым SSH (на вопрос `Proceed?` ответьте `y`):

```bash
ufw allow OpenSSH && ufw enable
```

Установите Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Если вошли не под `root`, добавляйте `sudo` перед командами.

### Зеркала Docker Hub (для серверов в России)

Из России Docker Hub отдаёт образы очень медленно или обрывается: сборка зависает на `Pulling` на десятки минут. Подключите зеркала — образы будут скачиваться за секунды. Сначала проверьте, нет ли уже настроек:

```bash
cat /etc/docker/daemon.json
```

Если файла нет (`No such file or directory`):

```bash
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://mirror.gcr.io",
    "https://dockerhub.timeweb.cloud"
  ]
}
EOF
```

```bash
systemctl restart docker
```

Если файл уже есть — допишите `registry-mirrors` в него вручную, не затирая остальное.

Проверка — должно занять секунды, а не минуты:

```bash
time docker pull postgres:16-alpine
```

## 2. Скачать код

```bash
git clone https://github.com/devehlop/baram.git && cd baram
```

## 3. Настроить

```bash
cp .env.example .env
```

Откройте `.env` (`nano .env`) и заполните:

| Переменная | Что вписать |
| --- | --- |
| `BOT_TOKEN` | Токен **боевого** бота от @BotFather |
| `ADMIN_IDS` | Ваш Telegram ID (узнать: команда `/id` в боте). Несколько — через запятую |
| `CHANNEL_ID` | Адрес канала направления, например `@baram_buinsk`. Можно оставить пустым и задать позже в боте |

Пароль базы сгенерируйте и допишите одной командой:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
```

`DATABASE_URL` на сервере не используется: адрес базы подставляет `docker-compose.prod.yml`.

## 4. Запустить

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Проверить, что бот работает:

```bash
docker compose -f docker-compose.prod.yml logs -f bot
```

В логе должна появиться строка «Бот запущен». Выход из просмотра — Ctrl+C.

Первая сборка занимает 5–15 минут: `npm ci` скачивает библиотеки. Предупреждения `npm warn deprecated` — не ошибка.

Чтобы стать админом: напишите боту `/start`, затем `/id`, и подставьте число вместо `YOUR_ID`:

```bash
sed -i 's/^ADMIN_IDS=.*/ADMIN_IDS=YOUR_ID/' .env && docker compose -f docker-compose.prod.yml up -d
```

## 5. Канал направления

1. Создайте канал, добавьте бота администратором с правом публиковать сообщения.
2. В боте: Админ → Настройки → «Канал Буинск ⇄ Казань» → напишите `@название_канала`.

С первым рейсом бот опубликует сводный пост «Рейсы на <день>» и дальше будет его обновлять.

## Прокладка до Telegram

Нужна, если с сервера не открывается `api.telegram.org`. Проверка:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://api.telegram.org
```

`302` — Telegram доступен, прокладка не нужна. Ошибка или тишина — нужна.

Прокладка — второй сервер за границей (например, в Казахстане), который пересылает запросы бота в Telegram. Данные пользователей на нём не хранятся. Ниже вариант, которому не нужны ни домен, ни порты 80 и 443: сертификат выпускает сама прокладка, а бот доверяет только ему.

Прокладке нужен только один свободный порт — 8443. Порты 80 и 443 на ней могут быть заняты чем угодно (VPN, 3x-ui, другой прокси) — это не мешает.

Обозначения в командах:
- `PROXY_IP_DASHED` — IP прокладки, где точки заменены дефисами: `31.56.82.67` → `31-56-82-67`. Вместе с `.sslip.io` получается бесплатный адрес, который указывает на этот IP;
- `MAIN_SERVER_IP` — IP основного сервера с ботом, с точками. Узнать его точно можно на основном сервере: `curl -4 -s https://ifconfig.me; echo`.

### На прокладке

Установите Docker, если его нет (`curl -fsSL https://get.docker.com | sh`). Затем подставьте свои значения в первые две строки и вставьте весь блок в терминал:

```bash
PROXY_HOST=PROXY_IP_DASHED.sslip.io
MAIN_IP=MAIN_SERVER_IP
mkdir -p ~/tg-api && cat > ~/tg-api/Caddyfile <<EOF
{
    skip_install_trust
    auto_https disable_redirects
}

$PROXY_HOST:8443 {
    tls internal

    @blocked not remote_ip $MAIN_IP
    respond @blocked 403

    reverse_proxy https://api.telegram.org {
        header_up Host api.telegram.org
    }
}
EOF
cat ~/tg-api/Caddyfile
```

В выведенном файле должны стоять ваш адрес и IP основного сервера. Запустите прокладку:

```bash
docker run -d --name tg-api --restart unless-stopped -p 8443:8443 -v ~/tg-api/Caddyfile:/etc/caddy/Caddyfile -v tg-api-data:/data caddy:2-alpine
```

```bash
docker ps --filter name=tg-api --format '{{.Names}}  {{.Status}}'
```

Должно быть `tg-api  Up ...`. Если на прокладке включён `ufw`, откройте порт: `ufw allow 8443/tcp` (нет команды `ufw` — пропустите). Если у провайдера есть брандмауэр в панели, откройте 8443 и там.

Выведите сертификат прокладки — его нужно передать боту. Он не секретный:

```bash
docker exec tg-api cat /data/caddy/pki/authorities/local/root.crt
```

Скопируйте весь блок от `-----BEGIN CERTIFICATE-----` до `-----END CERTIFICATE-----` включительно.

### На основном сервере

Дальше — в терминале **основного** сервера, не прокладки. Сохраните сертификат: вставьте скопированный блок, затем Ctrl+O, Enter, Ctrl+X:

```bash
mkdir -p ~/baram/certs && nano ~/baram/certs/tg-proxy.crt
```

Проверьте прокладку:

```bash
curl -sS --max-time 10 --cacert ~/baram/certs/tg-proxy.crt -o /dev/null -w "%{http_code}\n" https://PROXY_IP_DASHED.sslip.io:8443
```

| Ответ | Что значит |
| --- | --- |
| `302` | Всё работает |
| `403` | В `Caddyfile` прокладки не тот IP основного сервера. Исправьте и выполните на прокладке `docker restart tg-api` |
| `Connection timed out` | Порт 8443 на прокладке закрыт брандмауэром |
| Ошибка про `certificate` / `SSL` | Сертификат скопирован не целиком |

Добавьте адрес прокладки в `.env` и перезапустите бота той же командой, которой запускали:

```bash
printf "TELEGRAM_API_ROOT=https://PROXY_IP_DASHED.sslip.io:8443\nNODE_EXTRA_CA_CERTS=/certs/tg-proxy.crt\n" >> ~/baram/.env
```

## Mini App

Чат-бот работает и без него. Telegram открывает Mini App только по HTTPS, поэтому нужен адрес, на который можно выпустить сертификат. Он должен указывать на **основной** сервер (данные пользователей не должны идти через прокладку).

Два варианта адреса:
- **Бесплатно — sslip.io.** Адрес `MAIN_IP_DASHED.sslip.io`, где `MAIN_IP_DASHED` — IP основного сервера с дефисами вместо точек (`84.252.100.178` → `84-252-100-178`). Ничего регистрировать не нужно. Минус — адрес некрасивый и зависит от чужого бесплатного сервиса; если sslip.io перестанет работать, Mini App не откроется, чат-бот продолжит работать.
- **Свой домен.** Купите домен или поддомен (например, `app.example.ru`) и направьте его A-запись на IP основного сервера. Перейти на него с sslip.io можно в любой момент: поменять две строки в `.env` и перезапустить.

1. Откройте порты 80 и 443:

   ```bash
   ufw allow 80,443/tcp
   ```

2. Добавьте в `.env` адрес и домен (здесь — вариант с sslip.io; для своего домена подставьте его):

   ```bash
   printf "MINIAPP_URL=https://MAIN_IP_DASHED.sslip.io\nMINIAPP_DOMAIN=MAIN_IP_DASHED.sslip.io\n" >> .env
   ```

3. Запустите с профилем `miniapp` — поднимется ещё один контейнер, который сам получит и будет продлевать сертификат:

   ```bash
   docker compose -f docker-compose.prod.yml --profile miniapp up -d --build
   ```

4. Через минуту проверьте, что сертификат получен — должна быть строка `certificate obtained successfully` (строки `creating new account ... error` уровня `info` при первом запуске — норма):

   ```bash
   docker compose -f docker-compose.prod.yml logs caddy 2>&1 | grep -iE "certificate obtained|error"
   ```

5. Полностью закройте и снова откройте Telegram. В чате с ботом слева от поля ввода появится кнопка «Барам».

Обновлять и перезапускать потом нужно той же командой с `--profile miniapp`, иначе контейнер с HTTPS не поднимется.

Вход в Mini App не требует пароля: Telegram подписывает данные запуска токеном бота, сервер проверяет подпись на каждом запросе.

## Обновление

```bash
cd ~/baram && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Если включён Mini App:

```bash
cd ~/baram && git pull && docker compose -f docker-compose.prod.yml --profile miniapp up -d --build
```

После обновления незаконченные анкеты пользователей сбрасываются: человек просто начнёт вопрос заново. Брони, рейсы и заявки не затрагиваются.

## Бэкапы

Контейнер `backup` каждый день в 03:30 по Москве кладёт сжатую копию базы в папку `backups/` и хранит 14 дней.

Сделать копию прямо сейчас:

```bash
docker compose -f docker-compose.prod.yml exec backup sh /backup.sh
```

Восстановить из копии (подставьте имя файла):

```bash
gunzip -c backups/baram-2026-11-10_03-30.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U baram baram
```

Копии лежат на том же сервере. Раз в неделю скачивайте свежую к себе или настройте выгрузку в объектное хранилище в РФ — иначе при потере сервера пропадут и они. Скачать на свой компьютер (выполняется на компьютере, `FILE_NAME` — имя файла из `ls ~/baram/backups`):

```bash
scp root@MAIN_SERVER_IP:~/baram/backups/FILE_NAME ~/Downloads/
```

**Раз в месяц проверяйте восстановление**: разверните копию в отдельную базу и убедитесь, что таблицы на месте.

## Управляемая база вместо контейнера

Если берёте управляемый PostgreSQL в облаке (у него свои бэкапы):

1. Удалите из `docker-compose.prod.yml` сервисы `db` и `backup`, а у сервиса `bot` — блоки `depends_on` и `environment`.
2. Впишите адрес базы в `DATABASE_URL` в `.env`.

## Логи и ошибки

Ошибки пишутся в лог контейнера в формате JSON:

```bash
docker compose -f docker-compose.prod.yml logs --since 1h bot | grep '"level":50'
```

Уровень 50 — ошибка, 60 — бот не запустился.

## Частые вопросы

- **Бот молчит.** Посмотрите лог. Чаще всего неверный `BOT_TOKEN` или тот же токен запущен где-то ещё (например, на вашем компьютере).
- **Нет кнопки «Админ».** `ADMIN_IDS` пуст или в нём не ваш ID. Исправьте `.env` и перезапустите: `docker compose -f docker-compose.prod.yml up -d`.
- **Бот перестал отвечать, а раньше работал через прокладку.** Проверьте на прокладке, что контейнер жив: `docker ps --filter name=tg-api`. Если нет — `docker start tg-api`.
- **Сборка висит на `Pulling` десятки минут.** Docker Hub недоступен из России — подключите зеркала (раздел «Зеркала Docker Hub» в начале).
- **Вместо русских букв кракозябры** (в терминале, в `nano`, в логах). На сервере не настроена кодировка. Для текущего сеанса: `export LANG=C.UTF-8`. Русский текст в `nano` не вставляйте: команды в этой инструкции написаны латиницей как раз поэтому.
- **`.env: No such file or directory`.** Команда выполнена не на том сервере — например, на прокладке. Посмотрите имя сервера в начале строки терминала.
- **Mini App в обычном браузере пишет ошибку входа.** Это нормально: вход работает только внутри Telegram.
- **Пост в канале не появляется.** Бот не админ канала или адрес канала с ошибкой. В логе будет строка «Не удалось обновить пост в канале».
