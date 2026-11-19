# Запуск на сервере

Нужен сервер в России (Timeweb Cloud, Yandex Cloud и т. п.): по 152-ФЗ имена, телефоны и адреса хранятся на серверах в РФ. Хватит самого малого тарифа: 1 ядро, 1–2 ГБ памяти, Ubuntu 24.04.

Домен и сертификат для чат-бота не нужны: бот сам ходит в Telegram (long polling).

## 1. Подготовить сервер

Подключитесь по SSH и установите Docker:

```bash
curl -fsSL https://get.docker.com | sh
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
| `POSTGRES_PASSWORD` | Придумайте длинный пароль базы. Добавьте эту строку в `.env` |
| `CHANNEL_ID` | Адрес канала направления, например `@baram_buinsk`. Можно оставить пустым и задать позже в боте |

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

Ниже `1-2-3-4` — IP прокладки через дефисы (бесплатный адрес sslip.io), `IP_ОСНОВНОГО_СЕРВЕРА` — IP сервера с ботом.

### На прокладке

```bash
mkdir -p ~/tg-api && cd ~/tg-api && nano Caddyfile
```

```
{
    skip_install_trust
    auto_https disable_redirects
}

1-2-3-4.sslip.io:8443 {
    tls internal

    @chuzhie not remote_ip IP_ОСНОВНОГО_СЕРВЕРА
    respond @chuzhie 403

    reverse_proxy https://api.telegram.org {
        header_up Host api.telegram.org
    }
}
```

```bash
docker run -d --name tg-api --restart unless-stopped -p 8443:8443 -v ~/tg-api/Caddyfile:/etc/caddy/Caddyfile -v tg-api-data:/data caddy:2-alpine
```

Сертификат центра прокладки — его нужно будет передать боту. Он не секретный:

```bash
docker exec tg-api cat /data/caddy/pki/authorities/local/root.crt
```

### На основном сервере

Сохраните сертификат из прошлого шага (вставьте весь текст от `-----BEGIN` до `-----END CERTIFICATE-----`):

```bash
mkdir -p ~/baram/certs && nano ~/baram/certs/tg-proxy.crt
```

Проверьте прокладку — должно быть `302`:

```bash
curl -sS --cacert ~/baram/certs/tg-proxy.crt -o /dev/null -w "%{http_code}\n" https://1-2-3-4.sslip.io:8443
```

Добавьте в `.env`:

```
TELEGRAM_API_ROOT=https://1-2-3-4.sslip.io:8443
NODE_EXTRA_CA_CERTS=/certs/tg-proxy.crt
```

И перезапустите бота той же командой, которой запускали.

## Mini App

Чат-бот работает и без него. Чтобы включить Mini App, нужен домен: Telegram открывает Mini App только по HTTPS.

1. Купите домен (или поддомен, например `app.вашдомен.ru`) и направьте его A-запись на IP сервера.
2. В `.env` добавьте две строки — адрес и домен:

   ```
   MINIAPP_URL=https://app.вашдомен.ru
   MINIAPP_DOMAIN=app.вашдомен.ru
   ```

3. Запустите с профилем `miniapp` — поднимется ещё один контейнер, который сам получит и будет продлевать сертификат:

   ```bash
   docker compose -f docker-compose.prod.yml --profile miniapp up -d --build
   ```

4. Откройте чат с ботом: слева от поля ввода появится кнопка «Барам».

На сервере должны быть открыты порты 80 и 443. Обновлять и перезапускать потом нужно той же командой с `--profile miniapp`.

Вход в Mini App не требует пароля: Telegram подписывает данные запуска токеном бота, сервер проверяет подпись на каждом запросе.

## Обновление

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
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

Копии лежат на том же сервере. Раз в неделю скачивайте свежую к себе или настройте выгрузку в объектное хранилище в РФ — иначе при потере сервера пропадут и они.

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
- **Пост в канале не появляется.** Бот не админ канала или адрес канала с ошибкой. В логе будет строка «Не удалось обновить пост в канале».
