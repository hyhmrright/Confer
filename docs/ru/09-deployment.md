# Confer — развёртывание и самостоятельный хостинг

Как самому поднять полноценный экземпляр Confer — на ноутбуке, чтобы попробовать, или на сервере, чтобы поделиться с другими. Всё здесь — настоящий, проверенный путь; ничего умозрительного.

> **Область:** это руководство описывает **самостоятельный хостинг одного экземпляра**, с TLS или без него (см. [Отдача по HTTPS](#отдача-по-https) ниже). Публичный многоарендный хостинг и укрепление федерации в область v0.1 не входят — направление развития архитектуры см. в `docs/02-architecture.md`.

## Что вы получаете

Одна команда запускает всю платформу:

| Служба | Образ / сборка | Роль |
|---------|---------------|------|
| `client` | собирается из `infra/client.Dockerfile` | веб-интерфейс и обратный прокси nginx (единственный открытый порт) |
| `gateway` | собирается из `infra/gateway.Dockerfile` | API на Hono, эндпоинты A2A, WebSocket — **одна реплика, см. ниже** |
| `migrate` | однократная | прогоняет миграции Drizzle и завершается |
| `postgres` | `postgres:18-alpine` | основное хранилище данных |
| `qdrant` | `qdrant/qdrant:v1.19.0` | векторный поиск для базы знаний RAG |
| `minio` | `minio/minio` | S3-совместимое хранилище файлов |

> **Не масштабируйте `gateway` больше чем до одной реплики.** Соединения WebSocket, антиповторные nonce для A2A и счётчики ограничения частоты живут в памяти этого процесса. Вторая реплика принимала бы повторно отправленные запросы A2A (её таблица nonce пуста), пропускала бы WS-доставку тем, кто подключён к другой реплике, и умножала бы пороги ограничения на число реплик. Что нужно перенести в первую очередь — в `docs/02-architecture.md`.

nginx (внутри `client`) отдаёт SPA на порту **80** и проксирует `/api`, `/ws`, `/a2a` и `/.well-known` на шлюз. Собственный порт шлюза (3000) в промышленной конфигурации **не** публикуется — всё идёт через nginx на 80.

## Что нужно заранее

- **Docker** с Compose v2 (`docker compose`, а не `docker-compose`). Единственное обязательное требование.
- **Node 18+** — только для `npx confer-cli` (вариант A). Путь через голый Compose, тоже в варианте A, обходится без него.
- Примерно 4 ГБ свободной памяти и 2 ГБ на диске под образы и тома.
- [Bun](https://bun.sh) ≥ 1.1 — только если нужен рабочий цикл с горячей перезагрузкой (вариант C ниже) или пересборка миграций.

## A. Опубликованные образы (рекомендуется)

Ничего не клонировать, ничего не собирать:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) отказывается стартовать, если Docker на самом деле не запущен; пишет `docker-compose.ghcr.yml` и `.env` с правами `0600` в `~/.confer` — `JWT_SECRET`, `ENCRYPTION_KEY` и пароли базы и объектного хранилища, все порождённые через `crypto.randomBytes` при первом запуске и затем переиспользуемые, — тянет образы, применяет миграции и до трёх минут опрашивает `/health`. Об успехе он сообщает, когда отдана страница, а не когда поднялись контейнеры; если этого так и не происходит, он печатает последние 40 строк логов `migrate` и `gateway`. `npx confer-cli down` останавливает всё, сохраняя данные, а `npx confer-cli logs` следит за шлюзом.

Ключи: `--port` (по умолчанию 80), `--dir` (по умолчанию `~/.confer`), `--version` (тег образа), `--project` (имя проекта compose). Если проект compose с именем `confer` уже существует и создан не этой CLI, она останавливается, а не присваивает его: тома compose привязаны к имени проекта, так что запуск направил бы эти образы на базу той, другой сборки.

То же самое руками, для хоста без Node:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

При этом `POSTGRES_PASSWORD` и `MINIO_ROOT_PASSWORD` останутся значениями по умолчанию из файла compose (`confer` / `confer-secret`), которые CLI сделала бы случайными. Ни один из этих портов не публикуется, так что на одноарендной машине это не дыра — но на любом общем хосте задайте оба в `.env`.

`ghcr.io/hyhmrright/confer-gateway` и `-client` собираются под linux/amd64 и linux/arm64 при каждом push в `main` и получают теги `latest`, SHA коммита и версию выпуска. Закрепить нужный можно через `CONFER_VERSION` в `.env`.

В отличие от `docker-compose.prod.yml`, этот файл запускает `migrate` и `gateway` из *одного и того же* образа. Это безопасно только потому, что здесь ничего не собирается — см. предупреждение в варианте B, где эти двое как раз и могут разойтись.

Затем откройте **http://localhost**, зарегистрируйте первую учётную запись и добавьте ключ API для модели в **Настройках** — те же три шага, что перечислены в варианте B ниже.

Всё, что дальше говорит `-f docker-compose.prod.yml`, ровно так же работает с `-f docker-compose.ghcr.yml`, если запускать оттуда, где лежит этот файл (`~/.confer`, если его туда положила CLI), кроме обновления: пересобирать нечего, поэтому обновление — это снова `npx confer-cli` или `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. Сборка из клона

Этот путь — чтобы запустить изменённое дерево или хоститься самому, не завися от GHCR:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

Первая сборка занимает несколько минут. Когда она закончится:

1. Откройте **http://localhost**.
2. Нажмите **Зарегистрироваться** (надпись появится на вашем языке) и создайте первую учётную запись. (Регистрация ограничена тремя попытками в час с одного IP.)
3. Зайдите в **Настройки** и добавьте ключ API для модели (Claude / OpenAI / DeepSeek / Qwen / Ollama). Ключи хранятся зашифрованными с помощью `ENCRYPTION_KEY` (AES-256-GCM) и никогда не отправляются клиенту.

### Проверить, что всё в порядке

```bash
docker compose -f docker-compose.prod.yml ps        # все службы "running"/"healthy"; migrate — "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### Настройки

`.env` управляет промышленной сборкой. Значения по умолчанию из `.env.example` работают локально, но **небезопасны** — смените секреты, прежде чем открывать экземпляр кому-то ещё.

| Переменная | По умолчанию (`.env.example`) | Примечания |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **Смените.** Подписывает токены пользовательских сессий. |
| `ENCRYPTION_KEY` | 64 нуля | **Смените.** Должно быть 32 байта в виде 64 шестнадцатеричных символов. Сгенерировать: `openssl rand -hex 32`. Шифрует сохранённые ключи моделей. |
| `POSTGRES_PASSWORD` | `confer` (значение по умолчанию в compose) | Пароль базы данных. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | Учётные данные объектного хранилища. |
| `EXPOSE_PORT` | `80` | Порт хоста, на который встаёт веб-интерфейс. Поставьте, например, `8080`, если 80 занят. |
| `TAVILY_API_KEY` | пусто | Необязательный запасной вариант для веб-поиска; ключ конкретного пользователя из Настроек имеет приоритет. |
| `ADMIN_USERNAMES` | пусто | Имена пользователей через запятую, которым при старте шлюза автоматически выдаётся роль `admin`. Учётные записи должны быть уже зарегистрированы. Администраторы входят обычным паролем своей учётной записи и получают панель администратора; дальше они могут повышать других прямо из интерфейса. |

> Ключи моделей, эмбеддингов и Tavily в `.env` **не** задаются: они лежат зашифрованными для каждого пользователя в базе и настраиваются через интерфейс Настроек. Ключи в `.env` — это только инфраструктурные секреты.

После правки `.env` примените её так:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Обновление

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate прогоняется сам
```

### Сброс (стирает все данные)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v удаляет ещё и тома
```

## C. Локальная разработка (горячая перезагрузка)

В Docker держите только инфраструктуру, а код приложения запускайте через Bun:

```bash
bun install
docker compose up -d            # только инфраструктура — Postgres, Qdrant, MinIO (порты опубликованы на localhost)
bun run db:migrate
bun run dev                      # шлюз на :3000, клиент (Vite) на :1420
```

- Просмотр в браузере: **http://localhost:1420** (Vite проксирует `/api` → шлюз на :3000).
- Настольное приложение: `cd packages/client && bunx tauri dev`.

Разработческий `docker-compose.yml` публикует каждый инфраструктурный порт на localhost (5432, 6333, 6334, 9000/9001), чтобы запущенный локально шлюз до них дотянулся. Полный рабочий цикл разработчика и изолированный тестовый стенд описаны в `CONTRIBUTING.md`.

## Подключение плагина Claude Code

Плагин `confer-a2a` общается со шлюзом по HTTP. **Укажите ему правильный адрес для вашей установки:**

| Ваша установка | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| Опубликованные образы или клон (варианты A/B) | `http://localhost` (nginx на порту 80; порт шлюза 3000 не публикуется) |
| Локальная разработка (вариант C) | `http://localhost:3000` (значение по умолчанию) |
| Удалённый экземпляр | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # приведите в соответствие с таблицей выше
```

Чужие Агенты, к которым вы обращаетесь, уже должны быть **контактами** вашей учётной записи (добавление контакта и есть ворота согласия). Полный справочник по плагину: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## Как открыть экземпляр другим

Сборка по умолчанию слушает обычный HTTP: своим пользователям этого хватает, для федерации это бесполезно. **HTTPS здесь не мера укрепления, а сама функция.** Личность агента — это `did:web`, и алгоритм разрешения работает только по https: тот, кому дали `did:web:ваш.домен:agents:вы`, запрашивает `https://ваш.домен/agents/вы/did.json` и ничего больше. Отдайте это по http — и проверка подписи у каждого пира провалится на разрешении, ещё до того, как дело дойдёт до самой подписи.

### Отдача по HTTPS

`docker-compose.tls.yml` — это надстройка, которая ставит перед сборкой Caddy, а тот сам получает и обновляет сертификат. Наложите её на любой из двух базовых файлов:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

или, через CLI, `npx confer-cli --domain confer.example.com`.

Должны быть верны три вещи, и Caddy будет повторять попытки, пока они не станут верны (смотрите `docker compose … logs caddy`):

- `PUBLIC_HOST` — это **голый домен**, без схемы и без порта. Caddy отдаёт 443, а сопоставление портов в надстройке жёстко задано, так что `:8443` здесь слушал бы там, куда ничего не пересылается.
- Запись A/AAAA этого домена уже указывает на этот хост.
- Порты **80 и 443** оба доступны из интернета. 80 не факультативен: Let's Encrypt проверяет через него прежде, чем на 443 можно будет что-либо отдать.

Надстройка забирает у контейнера `client` опубликованный порт, поэтому `EXPOSE_PORT` больше не действует. Сертификаты лежат в томе `caddydata` — потерять его значит выпускать их заново, а на это есть ограничение частоты.

### Всё остальное

- Задайте `PUBLIC_HOST` до того, как заведёте учётные записи. Каждый DID, который чеканит этот экземпляр, выводится из него, так что это не косметика: если оставить `localhost`, то личности, которые вы вручаете пиру, разрешаются в *его собственный* loopback. Если поменять позже, при следующем запуске личности, всё ещё несущие старое значение `localhost`, будут перевешены на новый хост (один раз, с записью в лог); а любому пиру, у которого уже есть старый DID, придётся добавить контакт заново.
- Смените все секреты по умолчанию (`JWT_SECRET`, `ENCRYPTION_KEY`, пароли базы и MinIO).
- Регистрация по умолчанию открыта. Администратор в любой момент может закрыть её на вкладке **Admin → Config** (`registration_open`) или поставить перед ней приглашения либо список допущенных.

Свой обратный прокси (Traefik, уже работающий nginx, облачный балансировщик) тоже годится: пропустите надстройку, завершайте TLS где угодно и пересылайте на порт 80 контейнера `client`. `PUBLIC_HOST` по-прежнему должен совпадать с именем в сертификате.

### Бесплатный публичный экземпляр в Oracle Cloud (Always Free)

Дешевле всего держать всегда включённый публичный тестовый экземпляр на ARM-уровне **Always Free** в Oracle Cloud (4 OCPU / 24 ГБ / 10 ТБ исходящего трафика, без ограничения по времени). Вся сборка собирается и работает на `arm64`.

1. Создайте виртуальную машину: форма **VM.Standard.A1.Flex** (до 4 OCPU / 24 ГБ), образ **Ubuntu 22.04+ (arm64)**. ARM-мощностей в популярных регионах не хватает — берите крупный регион (Ashburn, Лондон) и повторяйте попытку, если получите «out of capacity».
2. В консоли откройте **security list / NSG** у VCN и разрешите входящие **TCP 80 и 443**. Откройте оба сразу, даже если начинаете без домена: скрипт открывает межсетевой экран на самом хосте для обоих, а вот до этой половины он дотянуться не может.
3. Зайдите по SSH и запустите начальную настройку (она ставит Docker, открывает межсетевой экран хоста, клонирует, порождает секреты, собирает и запускает стенд):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   Если домен уже указывает на эту машину, попросите HTTPS сразу же:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   Или сначала склонируйте и запустите `bash infra/oracle-bootstrap.sh`. Скрипт идемпотентен, а повторный запуск с `CONFER_DOMAIN` переводит уже существующий экземпляр на этот домен.
4. Откройте адрес, который он напечатает, зарегистрируйтесь, а затем выдайте себе права администратора: пропишите `ADMIN_USERNAMES=<вы>` в `~/Confer/.env` и снова выполните `up -d gateway` с теми же файлами `-f`.

Без `CONFER_DOMAIN` это отдаёт обычный HTTP по IP-адресу — для проверки годится, но федерироваться такой экземпляр не сможет, потому что `did:web` разрешается только по HTTPS.

## Обновление экземпляра, созданного до 2026-08-29

Confer теперь работает на **PostgreSQL 18** и **Qdrant 1.19**; раньше это были 16 и 1.12. Ни один из них не читает хранилище, записанное предыдущим, так что экземпляру, где уже есть данные, перед запуском нужна одна миграция. Ничего не теряется, и обе поломки громкие: postgres отказывается стартовать и объясняет почему, а qdrant падает в панику при загрузке. Свежей установке ничего этого не нужно.

`npx confer-cli` проверяет случай с postgres до того, как что-либо запустить, и печатает эти же указания. Чтобы пока остаться на старых версиях, запустите CLI, которая их несла: `npx confer-cli@0.3.3`.

Ниже подставьте свой файл compose и имя проекта — `docker-compose.prod.yml` для клона либо `-p confer -f ~/.confer/docker-compose.ghcr.yml` для пути через CLI. Тома называются `<проект>_pgdata` и `<проект>_qdrantdata`.

**1. Сделайте резервную копию дважды.** Логический дамп и побайтовая копия каждого тома ломаются по-разному, ради этого их и делают обе.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. Выгрузите векторы** — вместе с самими векторами, чтобы ничего не пришлось считать заново. Сохраните вывод в `qdrant-export.json`:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333", out = {};
for (const { name } of (await (await fetch(base + "/collections")).json()).result.collections) {
  const info = (await (await fetch(base + "/collections/" + name)).json()).result;
  const points = []; let offset = null;
  do {
    const body = { limit: 256, with_payload: true, with_vector: true, ...(offset ? { offset } : {}) };
    const page = (await (await fetch(base + "/collections/" + name + "/points/scroll",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).result;
    points.push(...page.points); offset = page.next_page_offset;
  } while (offset);
  out[name] = { config: info.config.params, points };
}
console.log(JSON.stringify(out));' > qdrant-export.json
```

**3. Замените тома и запустите новые версии.** Удаление томов — разрушительный шаг; не выполняйте его, пока шаги 1 и 2 не дадут файлы, в которые вы заглянули.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. Восстановите.** Дамп заново создаёт роль и базу `confer`, которые свежий контейнер уже создал, так что две ошибки `already exists` ожидаемы; любые другие — нет.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

Затем верните векторы на место — сначала коллекции, потому что приложение создаёт их только по мере надобности:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333";
const data = JSON.parse(await new Response(Bun.stdin.stream()).text());
for (const [name, { config, points }] of Object.entries(data)) {
  await fetch(base + "/collections/" + name,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
  if (points.length === 0) continue;
  await fetch(base + "/collections/" + name + "/points?wait=true",
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ points }) });
}' < qdrant-export.json
```

**5. Проверяйте по данным, а не по логам.** Число строк должно совпасть с тем, что было у старого экземпляра, а поиск должен что-то возвращать:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

Держите `confer_pgdata_backup` и `confer_qdrantdata_backup`, пока не поработаете с экземпляром какое-то время: это единственный путь назад.

## Поиск неисправностей

| Симптом | Вероятная причина и что делать |
|---------|--------------------|
| `postgres` после обновления перезапускается по кругу | Его том записан PostgreSQL 16. См. [Обновление экземпляра, созданного до 2026-08-29](#обновление-экземпляра-созданного-до-2026-08-29). |
| `qdrant` выходит с кодом 101 и трассировкой паники | Его хранилище записано Qdrant 1.12. Тот же раздел, что выше. |
| `port is already allocated` на 80 | Порт 80 занят чем-то другим. Пропишите `EXPOSE_PORT=8080` в `.env` и откройте http://localhost:8080. |
| Веб-интерфейс грузится, но каждый запрос отдаёт 500 | Смотрите `docker compose -f docker-compose.prod.yml logs gateway`. Чаще всего пусто в `JWT_SECRET` или `ENCRYPTION_KEY`: у них нет значения по умолчанию в compose, поэтому они обязаны присутствовать в `.env`. |
| `migrate` завершается с ненулевым кодом | Postgres ещё не был здоров, либо неверен `DATABASE_URL`. Повторите `docker compose -f docker-compose.prod.yml up -d`; `migrate` идемпотентен. |
| Плагин: `login failed` / 401 | Неверный `CONFER_GATEWAY_URL` (см. таблицу — в промышленной сборке это порт 80, а не 3000) либо неверные имя и пароль. |
| Плагин: `connection refused` на :3000 | Вы на установке в одну команду; используйте `http://localhost` вместо `:3000`. |
| Обращения к модели не проходят | У вашего пользователя не настроен ключ модели. Добавьте его в Настройках. |
| Ошибки эмбеддингов или RAG | См. `.claude/skills/rag-debug` или запустите навык rag-debug для диагностики Qdrant, эмбеддингов и MinIO. |

## Смотрите также

- [`docs/02-architecture.md`](./02-architecture.md) — архитектура системы и границы между службами
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — настройка для разработки, тестовый стенд, соглашения
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — справочник по плагину Claude Code
