# Confer — تعیناتی اور خود میزبانی

پورا Confer انسٹنس خود کیسے چلائیں — آزمانے کے لیے اپنے لیپ ٹاپ پر، یا دوسروں کے ساتھ بانٹنے کے لیے کسی سرور پر۔ یہاں جو کچھ ہے وہ اصلی، آزمودہ راستہ ہے؛ کچھ بھی محض خواہش نہیں۔

> **دائرہ:** یہ رہنما **واحد انسٹنس، خود میزبانی** والے بندوبست کو سمیٹتا ہے، TLS کے ساتھ یا بغیر (نیچے [HTTPS پر پیش کرنا](#https-پر-پیش-کرنا) دیکھیں)۔ عوامی کثیر کرایہ دار میزبانی اور فیڈریشن کی سختی v0.1 کے دائرے سے باہر ہیں — تعمیراتی سمت کے لیے `docs/02-architecture.md` دیکھیں۔

## آپ کو کیا ملتا ہے

ایک ہی حکم پورا پلیٹ فارم کھڑا کر دیتا ہے:

| خدمت | امیج / build | کردار |
|---------|---------------|------|
| `client` | اِس سے بنی: `infra/client.Dockerfile` | ویب UI + nginx ریورس پراکسی (واحد کھلا پورٹ) |
| `gateway` | اِس سے بنی: `infra/gateway.Dockerfile` | Hono API، A2A endpoints، WebSocket — **واحد نقل، نیچے دیکھیں** |
| `migrate` | ایک بار چلنے والی | Drizzle کی migrations چلا کر ختم ہو جاتی ہے |
| `postgres` | `postgres:18-alpine` | بنیادی ڈیٹا ذخیرہ |
| `qdrant` | `qdrant/qdrant:v1.19.0` | RAG علمی ذخیرے کے لیے سمتی تلاش |
| `minio` | `minio/minio` | S3 ہم آہنگ فائل ذخیرہ |

> **`gateway` کو ایک نقل سے آگے نہ بڑھائیں۔** WebSocket کے اتصال، A2A کی دہرائی روکنے والی nonce، اور شرحِ حد کی گنتیاں — سب اُسی پروسیس کی یادداشت میں رہتی ہیں۔ دوسری نقل دہرائی گئی A2A درخواستیں قبول کر لے گی (اُس کی nonce فہرست خالی ہے)، دوسری نقل سے جڑے صارفین کے WS پیغام چوک جائے گی، اور شرحِ حد کو نقلوں کی تعداد سے ضرب دے دے گی۔ پہلے کیا منتقل کرنا ہو گا، یہ `docs/02-architecture.md` میں ہے۔

nginx (`client` کے اندر) SPA کو پورٹ **80** پر پیش کرتا ہے اور `/api`، `/ws`، `/a2a` اور `/.well-known` کو gateway کی طرف ریورس پراکسی کرتا ہے۔ gateway کا اپنا پورٹ (3000) پیداوار میں **شائع نہیں** ہوتا — سب کچھ 80 پر nginx سے گزرتا ہے۔

## پیشگی ضروریات

- **Docker**، Compose v2 کے ساتھ (`docker compose`، `docker-compose` نہیں)۔ یہی واحد سخت شرط ہے۔
- **Node 18+** — صرف `npx confer-cli` کے لیے (اختیار A)۔ سادہ Compose والا راستہ، جو A ہی میں ہے، اس کے بغیر چل جاتا ہے۔
- امیجوں اور والیوم کے لیے تقریباً 4 GB خالی RAM اور 2 GB ڈسک۔
- [Bun](https://bun.sh) ≥ 1.1 — صرف تب جب گرم بازلوڈ والا ترقیاتی بہاؤ (نیچے اختیار C) چاہیے ہو یا migrations دوبارہ بنانی ہوں۔

## A. شائع شدہ امیج (تجویز کردہ)

کچھ کلون نہیں کرنا، کچھ بنانا نہیں:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) اُس وقت تک شروع ہی نہیں ہوتی جب تک Docker واقعی نہ چل رہا ہو؛ یہ `~/.confer` میں `docker-compose.ghcr.yml` اور `0600` اجازت والی `.env` لکھتی ہے — `JWT_SECRET`، `ENCRYPTION_KEY` اور ڈیٹابیس و شے-ذخیرے کے پاس ورڈ، سب پہلی بار `crypto.randomBytes` سے بنے اور پھر دوبارہ استعمال ہوتے ہیں —، امیج کھینچتی ہے، migrations لگاتی ہے، اور تین منٹ تک `/health` ٹٹولتی ہے۔ کامیابی کی خبر تب دیتی ہے جب کوئی صفحہ پیش ہو جائے، تب نہیں جب کنٹینر اٹھیں؛ اور اگر ایسا کبھی نہ ہو تو `migrate` اور `gateway` کے لاگ کی آخری 40 سطریں چھاپ دیتی ہے۔ `npx confer-cli down` سب روک دیتا ہے مگر ڈیٹا رکھتا ہے، اور `npx confer-cli logs` gateway کے پیچھے لگتا ہے۔

فلیگ: `--port` (طے شدہ 80)، `--dir` (طے شدہ `~/.confer`)، `--version` (امیج کا tag)، `--project` (compose منصوبے کا نام)۔ اگر `confer` نام کا compose منصوبہ پہلے سے موجود ہو اور اسے یہ CLI نے نہ بنایا ہو، تو CLI اسے اپنانے کے بجائے رک جاتی ہے — compose کے والیوم منصوبے کے نام سے بندھے ہوتے ہیں، سو چلانے پر یہ امیجیں اُسی دوسری ترتیب کے ڈیٹابیس کی طرف تاکتیں۔

وہی چیز ہاتھ سے، ایسے میزبان کے لیے جس پر Node نہ ہو:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

اس سے `POSTGRES_PASSWORD` اور `MINIO_ROOT_PASSWORD` compose فائل کی طے شدہ قدروں (`confer` / `confer-secret`) پر ہی رہ جاتے ہیں، جنہیں CLI بے ترتیب کر دیتی۔ ان میں سے کوئی پورٹ شائع نہیں ہوتا، سو واحد کرایہ دار مشین پر یہ سوراخ نہیں — مگر جس بھی میزبان کو آپ بانٹیں، وہاں دونوں `.env` میں رکھیں۔

`ghcr.io/hyhmrright/confer-gateway` اور `-client` ہر بار `main` پر push ہونے پر linux/amd64 اور linux/arm64 کے لیے بنتی ہیں، اور `latest`، کمٹ کے SHA اور ریلیز کے ورژن سے نشان زد ہوتی ہیں۔ کسی ایک پر ٹھہرنا ہو تو `.env` میں `CONFER_VERSION` رکھیں۔

`docker-compose.prod.yml` کے برعکس، یہ فائل `migrate` اور `gateway` دونوں کو *ایک ہی* امیج سے چلاتی ہے۔ یہ محفوظ صرف اس لیے ہے کہ یہاں کچھ بنتا ہی نہیں — اختیار B کی تنبیہ دیکھیں، جہاں یہ دونوں الگ ہو سکتے ہیں۔

پھر **http://localhost** کھولیں، پہلا کھاتہ بنائیں، اور **ترتیبات** میں ایک LLM API کلید شامل کریں — وہی تین قدم جو نیچے B میں گنوائے گئے ہیں۔

اس کے بعد جو کچھ `-f docker-compose.prod.yml` کہے، وہ `-f docker-compose.ghcr.yml` کے ساتھ بھی ویسا ہی لاگو ہوتا ہے — جہاں وہ فائل ہو وہیں سے چلا کر (`~/.confer`، اگر CLI نے اسے وہاں رکھا ہو) — سوائے اپ ڈیٹ کے: یہاں دوبارہ بنانے کو کچھ ہے ہی نہیں، سو اپ ڈیٹ کا مطلب ہے پھر سے `npx confer-cli`، یا `docker compose -f docker-compose.ghcr.yml pull && … up -d`۔

## B. کلون سے بنانا

اسے بدلے ہوئے درخت کو چلانے کے لیے استعمال کریں، یا GHCR پر انحصار کیے بغیر خود میزبانی کے لیے:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

پہلی بار بننے میں چند منٹ لگتے ہیں۔ مکمل ہونے پر:

1. **http://localhost** کھولیں۔
2. **اندراج** پر کلک کریں (عبارت آپ کی اپنی زبان میں دکھائی دے گی) اور پہلا کھاتہ بنائیں۔ (اندراج فی IP فی گھنٹہ 3 کوششوں تک محدود ہے۔)
3. **ترتیبات** میں جا کر ایک LLM API کلید شامل کریں (Claude / OpenAI / DeepSeek / Qwen / Ollama)۔ کلیدیں `ENCRYPTION_KEY` سے (AES-256-GCM) مشفّر کر کے رکھی جاتی ہیں اور کلائنٹ کو کبھی نہیں بھیجی جاتیں۔

### جانچیں کہ سب ٹھیک ہے

```bash
docker compose -f docker-compose.prod.yml ps        # تمام خدمات "running"/"healthy"؛ migrate "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### ترتیب

`.env` پیداواری بندوبست کو چلاتی ہے۔ `.env.example` کی طے شدہ قدریں مقامی استعمال کے لیے کام کرتی ہیں مگر **غیر محفوظ** ہیں — انسٹنس کسی اور کے سامنے کھولنے سے پہلے راز بدل لیں۔

| متغیر | طے شدہ (`.env.example`) | نوٹ |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **اسے بدلیں۔** صارف کے session ٹوکن پر دستخط کرتی ہے۔ |
| `ENCRYPTION_KEY` | 64 صفر | **اسے بدلیں۔** 32 بائٹ، یعنی 64 ہیکس حروف ہونے چاہئیں۔ بنائیں: `openssl rand -hex 32`۔ محفوظ LLM کلیدوں کو مشفّر کرتی ہے۔ |
| `POSTGRES_PASSWORD` | `confer` (compose کی طے شدہ) | ڈیٹابیس کا پاس ورڈ۔ |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | شے-ذخیرے کی اسناد۔ |
| `EXPOSE_PORT` | `80` | میزبان کا وہ پورٹ جس سے ویب UI بندھتا ہے۔ 80 مصروف ہو تو مثلاً `8080` رکھیں۔ |
| `TAVILY_API_KEY` | خالی | ویب تلاش کے لیے اختیاری متبادل؛ ترتیبات میں دی گئی فی صارف کلید کو ترجیح ملتی ہے۔ |
| `ADMIN_USERNAMES` | خالی | کوما سے جدا صارف نام، جنہیں gateway کے آغاز پر خود بخود `admin` کردار مل جاتا ہے۔ کھاتے پہلے سے درج ہونے چاہئیں۔ منتظمین اپنے عام کھاتے کے پاس ورڈ ہی سے آتے ہیں اور انہیں انتظامی پینل ملتا ہے؛ وہاں سے وہ دوسروں کو بھی ترقی دے سکتے ہیں۔ |

> LLM / embedding / Tavily کی کلیدیں `.env` میں **نہیں** رکھی جاتیں — وہ ڈیٹابیس میں فی صارف مشفّر رہتی ہیں اور ترتیبات کے UI سے مرتب ہوتی ہیں۔ `.env` کی کلیدیں محض بنیادی ڈھانچے کے راز ہیں۔

`.env` میں ترمیم کے بعد اسے یوں لاگو کریں:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### اپ ڈیٹ

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate خود بخود دوبارہ چلتی ہے
```

### سب مٹا کر نیا کرنا (سارا ڈیٹا جاتا ہے)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v والیوم بھی مٹا دیتا ہے
```

## C. مقامی ترقی (گرم بازلوڈ)

Docker میں صرف بنیادی ڈھانچہ چلائیں اور ایپ کا کوڈ Bun سے:

```bash
bun install
docker compose up -d            # صرف بنیادی ڈھانچہ — Postgres، Qdrant، MinIO (پورٹ localhost پر شائع)
bun run db:migrate
bun run dev                      # gateway :3000 پر، کلائنٹ (Vite) :1420 پر
```

- ویب جھلک: **http://localhost:1420** (Vite `/api` کو :3000 والے gateway کی طرف پراکسی کرتا ہے)۔
- مقامی ڈیسک ٹاپ ایپ: `cd packages/client && bunx tauri dev`۔

ترقی والی `docker-compose.yml` ہر بنیادی پورٹ کو localhost پر شائع کرتی ہے (5432، 6333، 6334، 9000/9001)، تاکہ مقامی طور پر چلتا gateway ان تک پہنچ سکے۔ مکمل ڈویلپر بہاؤ اور الگ تھلگ جانچ کے بندوبست کے لیے `CONTRIBUTING.md` دیکھیں۔

## Claude Code پلگ اِن جوڑنا

`confer-a2a` پلگ اِن gateway سے HTTP پر بات کرتا ہے۔ **اسے اپنے بندوبست کے مطابق درست URL کی طرف لگائیں:**

| آپ کا بندوبست | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| شائع شدہ امیج یا ایک کلون (اختیارات A/B) | `http://localhost` (nginx پورٹ 80 پر؛ gateway کا 3000 شائع نہیں) |
| مقامی ترقی (اختیار C) | `http://localhost:3000` (طے شدہ) |
| دور دراز انسٹنس | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # اوپر کی جدول سے ملائیں
```

جن peer Agent سے آپ مشورہ لیں، وہ پہلے سے آپ کے کھاتے کے **روابط** ہونے چاہئیں (رابطہ شامل کرنا ہی رضامندی کا دروازہ ہے)۔ پلگ اِن کا مکمل حوالہ: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)۔

## انسٹنس کو دوسروں کے سامنے کھولنا

طے شدہ بندوبست سادہ HTTP پر سنتا ہے، جو اپنے صارفین کے لیے ٹھیک ہے اور فیڈریشن کے لیے بے کار۔ **یہاں HTTPS سختی کا قدم نہیں، یہی خوبی ہے۔** کسی agent کی شناخت ایک `did:web` ہے، اور حل کرنے کا طریقہ صرف https ہے: جسے `did:web:آپ_کا.ڈومین:agents:آپ` دیا جائے، وہ `https://آپ_کا.ڈومین/agents/آپ/did.json` لاتا ہے اور کچھ نہیں۔ اسے http پر پیش کیجیے، اور ہر peer کی دستخط جانچ حل ہی پر ڈھیر ہو جائے گی — دستخط دیکھنے کی نوبت آنے سے پہلے۔

### HTTPS پر پیش کرنا

`docker-compose.tls.yml` ایک تہہ ہے جو بندوبست کے آگے Caddy لگا دیتی ہے، اور Caddy سند خود لیتا اور تجدید کرتا ہے۔ اسے دونوں بنیادی فائلوں میں سے کسی پر بھی چڑھائیں:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

یا CLI سے، `npx confer-cli --domain confer.example.com`۔

تین باتیں سچ ہونی چاہئیں، اور جب تک نہ ہوں Caddy کوشش کرتا رہے گا (`docker compose … logs caddy` دیکھیں):

- `PUBLIC_HOST` **ننگا ڈومین** ہو — نہ اسکیم، نہ پورٹ۔ Caddy 443 پیش کرتا ہے اور تہہ کی پورٹ نگاشت مقرر ہے، سو یہاں `:8443` وہاں سنے گا جہاں کچھ آگے بھیجا ہی نہیں جاتا۔
- اُس ڈومین کا A/AAAA ریکارڈ پہلے سے اسی میزبان کی طرف ہو۔
- **80 اور 443** — دونوں پورٹ انٹرنیٹ سے قابلِ رسائی ہوں۔ 80 اختیاری نہیں: Let's Encrypt اسی سے تصدیق کرتا ہے، اس سے پہلے کہ 443 پر کچھ پیش ہو سکے۔

یہ تہہ `client` کنٹینر سے شائع پورٹ چھین لیتی ہے، سو `EXPOSE_PORT` اب لاگو نہیں ہوتا۔ سندیں `caddydata` والیوم میں رہتی ہیں — اسے کھونے کا مطلب ہے دوبارہ جاری کروانا، اور اس پر شرحِ حد ہے۔

### باقی سب

- کھاتے بنانے سے پہلے `PUBLIC_HOST` طے کر لیں۔ یہ انسٹنس جو بھی DID ڈھالتا ہے وہ اسی سے نکلتا ہے، سو یہ آرائشی بات نہیں: `localhost` پر چھوڑ دیا تو جو شناخت آپ کسی peer کو تھماتے ہیں وہ *اُسی peer کے اپنے* loopback پر حل ہوتی ہے۔ بعد میں بدلنے پر، اگلی بار چلنے پر، وہ شناختیں جو اب بھی پرانا `localhost` لیے ہیں نئے میزبان پر منتقل ہو جاتی ہیں (ایک ہی بار، اور لاگ میں درج)؛ مگر جس peer کے پاس پہلے سے پرانا DID ہے، اسے رابطہ دوبارہ شامل کرنا ہو گا۔
- ہر طے شدہ راز بدلیں (`JWT_SECRET`، `ENCRYPTION_KEY`، ڈیٹابیس اور MinIO کے پاس ورڈ)۔
- اندراج طے شدہ طور پر کھلا ہے۔ منتظم جب چاہے اسے **Admin → Config** ٹیب سے بند کر سکتا ہے (`registration_open`)، یا آگے دعوت نامہ / اجازت فہرست لگا سکتا ہے۔

اپنا ریورس پراکسی لانا بھی چلتا ہے (Traefik، پہلے سے چلتا nginx، کوئی کلاؤڈ لوڈ بیلنسر) — تہہ چھوڑ دیں، TLS جہاں چاہیں ختم کریں، اور `client` کنٹینر کے پورٹ 80 پر آگے بھیجیں۔ `PUBLIC_HOST` پھر بھی سند کے نام سے میل کھانا چاہیے۔

### Oracle Cloud پر مفت عوامی انسٹنس (Always Free)

ہمیشہ چالو رہنے والا عوامی آزمائشی انسٹنس چلانے کا سب سے سستا طریقہ Oracle Cloud کا **Always Free** ARM درجہ ہے (4 OCPU / 24 GB / 10 TB اخراج، وقت کی کوئی حد نہیں)۔ پورا بندوبست `arm64` پر بنتا اور چلتا ہے۔

1. ایک VM بنائیں: شکل **VM.Standard.A1.Flex** (4 OCPU / 24 GB تک)، امیج **Ubuntu 22.04+ (arm64)**۔ مقبول خطوں میں ARM گنجائش تنگ رہتی ہے — کوئی بڑا خطہ چنیں (Ashburn، London) اور «out of capacity» ملے تو دوبارہ کوشش کریں۔
2. Console میں VCN کی **security list / NSG** کھول کر **TCP 80 اور 443** پر آمد کی اجازت دیں۔ دونوں ابھی کھول دیں، چاہے آپ بغیر ڈومین کے شروع کر رہے ہوں — اسکرپٹ میزبان کا فائر وال دونوں کے لیے کھولتی ہے، اور یہی وہ آدھا حصہ ہے جہاں اس کی رسائی نہیں۔
3. SSH سے اندر جائیں اور bootstrap چلائیں (Docker لگاتی ہے، میزبان کا فائر وال کھولتی ہے، کلون کرتی ہے، راز بناتی ہے، بندوبست بنا کر چلاتی ہے):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   اگر ڈومین پہلے سے VM کی طرف لگا ہو تو ساتھ ہی HTTPS بھی مانگ لیں:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   یا پہلے کلون کر کے `bash infra/oracle-bootstrap.sh` چلائیں۔ یہ idempotent ہے، اور `CONFER_DOMAIN` کے ساتھ دوبارہ چلانے پر موجودہ انسٹنس کو اُسی ڈومین پر منتقل کر دیتی ہے۔
4. جو URL یہ چھاپے اسے کھولیں، اندراج کریں، پھر خود کو منتظم بنائیں: `~/Confer/.env` میں `ADMIN_USERNAMES=<آپ>` رکھیں اور انہی `-f` فائلوں کے ساتھ `up -d gateway` دوبارہ چلائیں۔

`CONFER_DOMAIN` کے بغیر یہ IP پر سادہ HTTP پیش کرتا ہے — آزمانے کے لیے ٹھیک، مگر انسٹنس فیڈریٹ نہیں کر سکتا، کیونکہ `did:web` صرف HTTPS پر حل ہوتا ہے۔

## 2026-08-29 سے پہلے بنے انسٹنس کی اپ گریڈ

Confer اب **PostgreSQL 18** اور **Qdrant 1.19** چلاتا ہے؛ پہلے 16 اور 1.12 چلاتا تھا۔ ان میں سے کوئی بھی وہ ذخیرہ نہیں پڑھتا جو پرانے نے لکھا تھا، سو جس انسٹنس میں پہلے سے ڈیٹا ہے اسے چلنے سے پہلے ایک منتقلی چاہیے۔ کچھ ضائع نہیں ہوتا، اور دونوں ناکامیاں شور مچاتی ہیں: postgres چلنے سے انکار کرتا ہے اور وجہ بتاتا ہے، اور qdrant لوڈ کرتے وقت panic کر جاتا ہے۔ نئی تنصیب کو اس میں سے کچھ درکار نہیں۔

`npx confer-cli` کچھ بھی چلانے سے پہلے postgres والی صورت جانچ لیتی ہے اور یہی ہدایات چھاپتی ہے۔ فی الحال پرانے ورژنوں پر رہنا ہو تو وہی CLI چلائیں جو انہیں لاتی تھی: `npx confer-cli@0.3.3`۔

نیچے اپنی compose فائل اور منصوبے کا نام رکھیں — کلون کے لیے `docker-compose.prod.yml`، یا CLI والے راستے کے لیے `-p confer -f ~/.confer/docker-compose.ghcr.yml`۔ والیوم کے نام `<منصوبہ>_pgdata` اور `<منصوبہ>_qdrantdata` ہیں۔

**1. دو بار بیک اپ لیں۔** منطقی dump اور ہر والیوم کی بائٹ در بائٹ نقل الگ الگ طریقوں سے ناکام ہوتی ہیں — دونوں لینے کی وجہ یہی ہے۔

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. سمتیں برآمد کریں** — اُن کی سمتوں سمیت، تاکہ کچھ بھی دوبارہ embed نہ کرنا پڑے۔ نتیجہ `qdrant-export.json` میں محفوظ کریں:

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

**3. والیوم بدلیں اور نئے ورژن چلائیں۔** والیوم ہٹانا ہی تباہ کن قدم ہے؛ اسے اُس وقت تک نہ چلائیں جب تک قدم 1 اور 2 ایسی فائلیں نہ دے دیں جنہیں آپ نے دیکھ لیا ہو۔

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. بحال کریں۔** dump وہی `confer` کردار اور ڈیٹابیس دوبارہ بناتا ہے جو نیا کنٹینر پہلے ہی بنا چکا ہے، سو `already exists` کی دو خرابیاں متوقع ہیں؛ اس کے علاوہ کوئی نہیں۔

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

پھر سمتیں واپس رکھیں — پہلے مجموعے، کیونکہ ایپ انہیں صرف ضرورت پڑنے پر بناتی ہے:

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

**5. لاگ سے نہیں، ڈیٹا سے جانچیں۔** سطروں کی گنتی وہی آنی چاہیے جو پرانے انسٹنس میں تھی، اور تلاش سے نتائج آنے چاہئیں:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

`confer_pgdata_backup` اور `confer_qdrantdata_backup` اُس وقت تک رکھیں جب تک انسٹنس کچھ عرصہ برت نہ لیں — واپسی کا یہی واحد راستہ ہے۔

## خرابیوں کا ازالہ

| علامت | ممکنہ وجہ / حل |
|---------|--------------------|
| اپ گریڈ کے بعد `postgres` بار بار دوبارہ چلتا ہے | اس کا والیوم PostgreSQL 16 نے لکھا تھا۔ دیکھیں [2026-08-29 سے پہلے بنے انسٹنس کی اپ گریڈ](#2026-08-29-سے-پہلے-بنے-انسٹنس-کی-اپ-گریڈ)۔ |
| `qdrant` 101 کے ساتھ panic backtrace دے کر نکل جاتا ہے | اس کا ذخیرہ Qdrant 1.12 نے لکھا تھا۔ وہی حصہ جو اوپر ہے۔ |
| 80 پر `port is already allocated` | پورٹ 80 پر کسی اور کا قبضہ ہے۔ `.env` میں `EXPOSE_PORT=8080` رکھیں اور http://localhost:8080 کھولیں۔ |
| ویب UI تو لدتا ہے مگر ہر درخواست 500 دیتی ہے | `docker compose -f docker-compose.prod.yml logs gateway` دیکھیں۔ اکثر `JWT_SECRET` یا `ENCRYPTION_KEY` خالی ہوتی ہے — compose میں ان کی کوئی طے شدہ قدر نہیں، سو انہیں `.env` میں ہونا ہی چاہیے۔ |
| `migrate` غیر صفر کوڈ کے ساتھ ختم ہوتی ہے | Postgres ابھی تندرست نہ ہوا تھا، یا `DATABASE_URL` غلط ہے۔ `docker compose -f docker-compose.prod.yml up -d` دوبارہ چلائیں؛ `migrate` idempotent ہے۔ |
| پلگ اِن: `login failed` / 401 | `CONFER_GATEWAY_URL` غلط ہے (جدول دیکھیں — پیداوار میں پورٹ 80 ہے، 3000 نہیں)، یا صارف نام/پاس ورڈ غلط۔ |
| پلگ اِن: :3000 پر `connection refused` | آپ ایک حکم والے بندوبست پر ہیں؛ `:3000` کے بجائے `http://localhost` استعمال کریں۔ |
| LLM کی کالیں ناکام ہوتی ہیں | آپ کے صارف کے لیے کوئی LLM کلید مرتب نہیں۔ ترتیبات میں ایک شامل کریں۔ |
| Embedding/RAG کی خرابیاں | `.claude/skills/rag-debug` دیکھیں، یا Qdrant/embedding/MinIO کی تشخیص کے لیے rag-debug skill چلائیں۔ |

## یہ بھی دیکھیں

- [`docs/02-architecture.md`](./02-architecture.md) — نظام کا فن تعمیر اور خدمات کی حدود
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — ڈویلپر بندوبست، جانچ کا ڈھانچہ، روایات
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code پلگ اِن کا حوالہ
