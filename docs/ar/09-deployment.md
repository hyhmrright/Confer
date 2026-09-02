# Confer — النشر والاستضافة الذاتية

كيف تشغّل بنفسك نسخة Confer كاملة — على حاسوبك المحمول لتجرّبها، أو على خادوم لتشاركها مع غيرك. كل ما هنا مسار حقيقي مجرَّب، وليس فيه شيء من باب التمنّي.

> **النطاق:** يغطّي هذا الدليل الإعداد **أحادي النسخة، ذاتيّ الاستضافة**، بـTLS أو بغيره (انظر [التقديم عبر HTTPS](#التقديم-عبر-https) أدناه). أما الاستضافة العلنية متعدّدة المستأجرين وتحصين الاتحاد فخارج نطاق الإصدار v0.1 — وللاطلاع على الوجهة المعمارية انظر `docs/02-architecture.md`.

## ما الذي تحصل عليه

أمر واحد يشغّل المنصّة كلها:

| الخدمة | الصورة / البناء | الدور |
|---------|---------------|------|
| `client` | مبنيّة من `infra/client.Dockerfile` | واجهة الويب ووسيط nginx العكسي (المنفذ الوحيد المكشوف) |
| `gateway` | مبنيّة من `infra/gateway.Dockerfile` | واجهة Hono، ومسارات A2A، وWebSocket — **نسخة واحدة فقط، انظر أدناه** |
| `migrate` | تعمل مرة واحدة | ينفّذ ترحيلات Drizzle ثم ينتهي |
| `postgres` | `postgres:18-alpine` | مخزن البيانات الأساسي |
| `qdrant` | `qdrant/qdrant:v1.19.0` | البحث المتّجهي لقاعدة معرفة RAG |
| `minio` | `minio/minio` | تخزين ملفات متوافق مع S3 |

> **لا تزد `gateway` عن نسخة واحدة.** اتصالات WebSocket، وقيم nonce المانعة لإعادة إرسال A2A، وعدّادات تحديد المعدّل — كلها تسكن ذاكرة تلك العملية. والنسخة الثانية ستقبل طلبات A2A المُعادة (فجدول nonce لديها فارغ)، وتُفوّت رسائل WS على المستخدمين المتصلين بالنسخة الأخرى، وتضاعف حدود المعدّل بعدد النسخ. وما ينبغي نقله أولًا مذكور في `docs/02-architecture.md`.

يقدّم nginx (داخل `client`) تطبيق الصفحة الواحدة على المنفذ **80**، ويمرّر `/api` و`/ws` و`/a2a` و`/.well-known` إلى البوابة تمريرًا عكسيًا. أما منفذ البوابة نفسه (3000) فلا يُنشَر في الإنتاج — كل شيء يمرّ عبر nginx على المنفذ 80.

## المتطلّبات المسبقة

- **Docker** مع Compose v2 (`docker compose` لا `docker-compose`). وهو الشرط الصارم الوحيد.
- **Node 18+** — فقط من أجل `npx confer-cli` (الخيار A). أما مسار Compose المجرّد، وهو أيضًا ضمن A، فيستغني عنه.
- نحو 4 غيغابايت من الذاكرة الحرّة و2 غيغابايت على القرص للصور والوحدات التخزينية.
- [Bun](https://bun.sh) ≥ 1.1 — فقط إن أردت سير عمل التطوير بإعادة التحميل الساخنة (الخيار C أدناه) أو إعادة توليد الترحيلات.

## A. الصور المنشورة (المفضَّل)

لا شيء تستنسخه، ولا شيء تبنيه:

```bash
npx confer-cli
```

ترفض [`confer-cli`](https://www.npmjs.com/package/confer-cli) أن تبدأ ما لم يكن Docker يعمل فعلًا؛ وهي تكتب `docker-compose.ghcr.yml` وملف `.env` بصلاحية `0600` في `~/.confer` — فيه `JWT_SECRET` و`ENCRYPTION_KEY` وكلمات مرور قاعدة البيانات ومخزن الكائنات، وكلها مولَّدة بـ`crypto.randomBytes` عند أول تشغيل ثم يُعاد استعمالها — ثم تسحب الصور، وتطبّق الترحيلات، وتستطلع `/health` مدة تصل إلى ثلاث دقائق. وتعلن النجاح حين تُقدَّم صفحة، لا حين تقلع الحاويات؛ فإن لم يحدث ذلك قطّ، طبعت آخر أربعين سطرًا من سجلّي `migrate` و`gateway`. و`npx confer-cli down` توقف كل شيء وتُبقي البيانات، و`npx confer-cli logs` تتابع البوابة.

الخيارات: `--port` (وافتراضه 80)، و`--dir` (وافتراضه `~/.confer`)، و`--version` (وسم الصورة)، و`--project` (اسم مشروع compose). وإن وُجد مشروع compose باسم `confer` ولم تُنشئه هذه الأداة، توقّفت الأداة بدل أن تتبنّاه — فوحدات compose التخزينية مفهرسة باسم المشروع، وتشغيلها كان سيوجّه هذه الصور إلى قاعدة بيانات تلك المنظومة الأخرى.

الشيء نفسه يدويًا، لمضيف بلا Node:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

وهذا يترك `POSTGRES_PASSWORD` و`MINIO_ROOT_PASSWORD` على قيم ملف compose الافتراضية (`confer` / `confer-secret`)، وهي التي كانت الأداة ستعشوِئها. ولا يُنشَر أيّ من المنفذين، فليست ثغرة على جهاز أحادي المستأجر — لكن اضبطهما كليهما في `.env` على أي مضيف تشاركه.

تُبنى `ghcr.io/hyhmrright/confer-gateway` و`-client` لمعماريتي linux/amd64 وlinux/arm64 عند كل دفع إلى `main`، وتُوسَم بـ`latest` وبمعرّف الإيداع وبرقم الإصدار. ولتثبيت واحدة منها استعمل `CONFER_VERSION` في `.env`.

بخلاف `docker-compose.prod.yml`، يشغّل هذا الملف `migrate` و`gateway` من الصورة *نفسها*. وهو آمن هنا فقط لأن شيئًا لا يُبنى — انظر التحذير في الخيار B، فهناك يمكن أن يفترق الاثنان.

ثم افتح **http://localhost**، وسجّل أول حساب، وأضف مفتاح واجهة لنموذج لغوي في **الإعدادات** — وهي الخطوات الثلاث نفسها المذكورة في الخيار B أدناه.

وكل ما يقول بعد هذه النقطة `-f docker-compose.prod.yml` ينطبق كذلك على `-f docker-compose.ghcr.yml`، إذا شُغّل من حيث يوجد ذلك الملف (`~/.confer` إن كانت الأداة قد وضعته هناك)، إلا التحديث: فليس ثمّة ما يُعاد بناؤه، والتحديث هو تشغيل `npx confer-cli` من جديد، أو `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. البناء من نسخة مستنسخة

استعمل هذا لتشغيل شجرة معدَّلة، أو لتستضيف نفسك بلا اعتماد على GHCR:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

يستغرق البناء الأول بضع دقائق. وعند انتهائه:

1. افتح **http://localhost**.
2. اضغط **تسجيل** (وتظهر العبارة بلغتك أنت) وأنشئ أول حساب. (والتسجيل محدود بثلاث محاولات في الساعة لكل عنوان IP.)
3. اذهب إلى **الإعدادات** وأضف مفتاح واجهة لنموذج لغوي (Claude / OpenAI / DeepSeek / Qwen / Ollama). وتُخزَّن المفاتيح مشفَّرة بـ`ENCRYPTION_KEY` (AES-256-GCM) ولا تُرسَل إلى العميل أبدًا.

### تأكّد أن كل شيء سليم

```bash
docker compose -f docker-compose.prod.yml ps        # كل الخدمات "running"/"healthy"؛ وmigrate تكون "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### الإعدادات

ملف `.env` هو الذي يقود منظومة الإنتاج. وقيم `.env.example` الافتراضية تعمل محليًا لكنها **غير آمنة** — غيّر الأسرار قبل أن تفتح النسخة لأحد غيرك.

| المتغيّر | الافتراضي (`.env.example`) | ملاحظات |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **غيّره.** يوقّع رموز جلسات المستخدمين. |
| `ENCRYPTION_KEY` | أربعة وستون صفرًا | **غيّره.** يجب أن يكون 32 بايتًا في صورة 64 محرفًا ستّ عشريًا. للتوليد: `openssl rand -hex 32`. يشفّر مفاتيح النماذج المخزَّنة. |
| `POSTGRES_PASSWORD` | `confer` (افتراضي compose) | كلمة مرور قاعدة البيانات. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | بيانات اعتماد مخزن الكائنات. |
| `EXPOSE_PORT` | `80` | منفذ المضيف الذي ترتبط به واجهة الويب. اجعله مثلًا `8080` إن كان 80 مشغولًا. |
| `TAVILY_API_KEY` | فارغ | بديل اختياري للبحث على الويب؛ ومفتاح المستخدم في الإعدادات له الأسبقية. |
| `ADMIN_USERNAMES` | فارغ | أسماء مستخدمين مفصولة بفواصل، تُرقّى تلقائيًا إلى دور `admin` عند إقلاع البوابة. ويجب أن تكون الحسابات مسجَّلة سلفًا. ويدخل المشرفون بكلمة مرور حسابهم المعتادة فتظهر لهم لوحة الإشراف، ومنها يستطيعون ترقية غيرهم. |

> مفاتيح النماذج والتمثيل المتّجهي وTavily **لا** تُضبط في `.env` — فهي تسكن مشفَّرة لكل مستخدم في قاعدة البيانات وتُضبط من واجهة الإعدادات. أما مفاتيح `.env` فأسرار بنية تحتية لا غير.

بعد تعديل `.env` طبّقه بهذا:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### التحديث

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate يعاد تشغيله تلقائيًا
```

### التصفير (يمحو كل البيانات)

```bash
docker compose -f docker-compose.prod.yml down -v          # الخيار -v يحذف الوحدات التخزينية أيضًا
```

## C. التطوير المحلي (إعادة تحميل ساخنة)

شغّل البنية التحتية وحدها في Docker، وشيفرة التطبيق بـBun:

```bash
bun install
docker compose up -d            # البنية التحتية فقط — Postgres وQdrant وMinIO (منافذها منشورة على localhost)
bun run db:migrate
bun run dev                      # البوابة على :3000، والعميل (Vite) على :1420
```

- المعاينة في المتصفّح: **http://localhost:1420** (وVite يمرّر `/api` إلى البوابة على :3000).
- تطبيق سطح المكتب الأصلي: `cd packages/client && bunx tauri dev`.

ملف `docker-compose.yml` الخاص بالتطوير ينشر كل منفذ من منافذ البنية التحتية على localhost (5432 و6333 و6334 و9000/9001) ليصل إليها gateway المشغَّل محليًا. وانظر `CONTRIBUTING.md` لسير عمل المطوّر كاملًا ولمنظومة الاختبار المعزولة.

## ربط إضافة Claude Code

تتحدث إضافة `confer-a2a` إلى البوابة عبر HTTP. **وجّهها إلى العنوان الصحيح بحسب إعدادك:**

| إعدادك | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| صور منشورة أو نسخة مستنسخة (الخياران A/B) | `http://localhost` (nginx على المنفذ 80؛ ومنفذ البوابة 3000 غير منشور) |
| تطوير محلي (الخيار C) | `http://localhost:3000` (القيمة الافتراضية) |
| نسخة بعيدة | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # طابقه مع الجدول أعلاه
```

والوكلاء الأقران الذين تستشيرهم يجب أن يكونوا **جهات اتصال** في حسابك سلفًا (فإضافة جهة الاتصال هي بوابة الإذن). والمرجع الكامل للإضافة: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## تطبيقا سطح المكتب والهاتف

لا تحتاج نسخة الويب إلى عنوان أبدًا: فـ nginx هو من يقدّمها ويمرّر `/api` و`/ws` على المصدر
نفسه. أما تطبيق سطح المكتب أو Android المحزوم فمختلف — إنه يقدّم موارده بنفسه من
`tauri://localhost` (وتُكتب `http://tauri.localhost` على Windows وLinux وAndroid)، حيث
يشير `/api/v1` النسبي إلى الحزمة ذاتها. لذا لا بد من إخباره بالنسخة التي ينتمي إليها، وهذه
إجابة لا يعرفها إلا من قام بالنشر.

عند أول تشغيل تظهر في شاشة الدخول خانة إضافية باسم **عنوان المثيل**. املأها كما في الجدول
أعلاه:

| طريقة النشر لديك | ما الذي تكتبه |
|---|---|
| الصور المنشورة أو بناء من نسخة مستنسخة (أ/ب) | `http://localhost` |
| التطوير المحلي (ج) | `http://localhost:3000` |
| نسخة بعيدة | `confer.example.com` |

يُعامَل العنوان الخالي من البروتوكول على أنه `https://`، باستثناء `localhost` و`127.0.0.1`
فتُقرآن على أنهما `http://`، إذ لا أحد يضع شهادة على الجهاز الجالس أمامه. يُحفظ العنوان على هذا الجهاز فقط، والانتقال إلى نسخة أخرى يمسح معه جلسة
الدخول أيضًا — فالرمز يخص البوابة التي أصدرته، ونقله إلى غيرها لا ينتج عنه سوى 401.

وفي جانب البوابة يُسمح على `/api/v1/*` بمصدرين اثنين تحديدًا: `tauri://localhost` و
`http://tauri.localhost`. ولا يمكن أن يشغلهما إلا تطبيق Tauri على جهاز المستخدم نفسه — لا
تستطيع أي صفحة ويب ادّعاءهما — كما أن هذه الواجهة لا تحمل ملفات تعريف ارتباط (رمز الحامل
يُرسل ترويسةً). فما يُفتح هنا هو وصول للقراءة لشيفرة تملك الرمز أصلًا، وليس صلاحية محيطية.

## فتح النسخة للآخرين

تستمع المنظومة الافتراضية على HTTP مجرّد، وهذا يكفي مستخدميها ولا ينفع الاتحاد في شيء. **وHTTPS هنا ليس خطوة تحصين، بل هو الميزة نفسها.** فهوية الوكيل `did:web`، وخوارزمية الحلّ لا تعمل إلا على https: من يُعطَ `did:web:نطاقك:agents:أنت` يجلب `https://نطاقك/agents/أنت/did.json` ولا شيء سواه. فإن قدّمت ذلك على http سقط تحقّق التوقيع لدى كل قرين عند الحلّ، قبل أن ينظر إلى التوقيع أصلًا.

### التقديم عبر HTTPS

`docker-compose.tls.yml` طبقة تضع Caddy أمام المنظومة، وCaddy يحصل على الشهادة ويجدّدها بنفسه. ضعها فوق أيٍّ من الملفين الأساسيين:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

أو من الأداة: `npx confer-cli --domain confer.example.com`.

ثلاثة أمور يجب أن تتحقّق، وسيظلّ Caddy يعاود المحاولة حتى تتحقّق (تابع `docker compose … logs caddy`):

- أن يكون `PUBLIC_HOST` **النطاق المجرّد** — بلا مخطّط ولا منفذ. فCaddy يقدّم على 443، وربط منافذ الطبقة ثابت، فوضع `:8443` هنا يجعله يستمع حيث لا يُمرَّر إليه شيء.
- أن يكون سجلّ A/AAAA لذلك النطاق مشيرًا إلى هذا المضيف بالفعل.
- أن يكون المنفذان **80 و443** كلاهما قابلًا للوصول من الإنترنت. والمنفذ 80 ليس اختياريًا: فـLet's Encrypt يتحقّق عبره قبل أن يمكن تقديم أي شيء على 443.

تسحب الطبقة المنفذ المنشور من حاوية `client`، فلا يعود `EXPOSE_PORT` ساريًا. والشهادات تسكن الوحدة التخزينية `caddydata` — وضياعها يعني إعادة الإصدار، وعليها حدّ معدّل.

### كل ما عدا ذلك

- اضبط `PUBLIC_HOST` قبل إنشاء الحسابات. فكل DID تسكّه هذه النسخة مشتقّ منه، وليس الأمر تجميليًا: إذا تُرك على `localhost` فإن الهويات التي تسلّمها لقرين تُحلّ إلى حلقة *قرينك* المحلية هو. وتغييره لاحقًا يعيد استضافة الهويات التي ما زالت تحمل `localhost` القديم عند التشغيل التالي (مرة واحدة، ويُسجَّل ذلك)؛ أما القرين الذي بيده DID قديم فعليه أن يضيف جهة الاتصال من جديد.
- غيّر كل سرّ افتراضي (`JWT_SECRET` و`ENCRYPTION_KEY` وكلمتي مرور قاعدة البيانات وMinIO).
- التسجيل مفتوح افتراضيًا. ويستطيع المشرف إغلاقه متى شاء من تبويب **Admin → Config** (`registration_open`)، أو أن يضع أمامه دعوة أو قائمة سماح.

وإحضار وسيط عكسي خاص بك (Traefik، أو nginx قائم لديك، أو موازن حِمل سحابي) يعمل أيضًا: تجاوز الطبقة، وأنهِ TLS حيث تشاء، ومرّر إلى المنفذ 80 في حاوية `client`. ويظل على `PUBLIC_HOST` أن يطابق الاسم المذكور في الشهادة.

### نسخة علنية مجانية على Oracle Cloud (Always Free)

أرخص طريقة لتشغيل نسخة اختبارية علنية تعمل دائمًا هي طبقة **Always Free** بمعمارية ARM من Oracle Cloud (أربع أنوية / 24 غيغابايت / 10 تيرابايت صادرة، بلا حدّ زمني). والمنظومة كلها تُبنى وتعمل على `arm64`.

1. أنشئ جهازًا افتراضيًا: الشكل **VM.Standard.A1.Flex** (حتى أربع أنوية / 24 غيغابايت)، والصورة **Ubuntu 22.04+ (arm64)**. وسعة ARM شحيحة في المناطق المزدحمة — فاختر منطقة كبيرة (Ashburn أو London) وأعد المحاولة إن ووجهت بـ«out of capacity».
2. من لوحة التحكم، افتح **security list / NSG** الخاصة بالـVCN للسماح بالوارد على **TCP 80 و443**. افتحهما الآن ولو بدأت بلا نطاق: فالنص البرمجي يفتح جدار حماية المضيف لكليهما، وهذا هو النصف الذي لا يبلغه.
3. ادخل عبر SSH وشغّل نصّ التهيئة (يثبّت Docker، ويفتح جدار حماية المضيف، ويستنسخ، ويولّد الأسرار، ويبني المنظومة ويشغّلها):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   وإن كان لديك نطاق يشير إلى الجهاز أصلًا، فاطلب HTTPS في الوقت نفسه:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   أو استنسخ أولًا ثم شغّل `bash infra/oracle-bootstrap.sh`. وهو متماثل الأثر، وإعادة تشغيله مع `CONFER_DOMAIN` تنقل نسخة قائمة إلى ذلك النطاق.
4. افتح العنوان الذي يطبعه، وسجّل، ثم امنح نفسك الإشراف: اضبط `ADMIN_USERNAMES=<أنت>` في `~/Confer/.env` وأعد تشغيل `up -d gateway` بالملفات `-f` نفسها.

ومن دون `CONFER_DOMAIN` يقدّم هذا HTTP مجرّدًا على عنوان IP — وهو جيّد للتجربة، لكن النسخة لا تستطيع الاتحاد، لأن `did:web` لا يُحَلّ إلا على HTTPS.

## ترقية نسخة أُنشئت قبل 2026-08-29

يعمل Confer الآن على **PostgreSQL 18** و**Qdrant 1.19**، وكان يعمل قبلُ على 16 و1.12. ولا يقرأ أيٌّ منهما التخزين الذي كتبه سابقه، فالنسخة التي تحمل بيانات بالفعل تحتاج ترحيلًا واحدًا قبل أن تقلع. ولا يضيع شيء، والعطبان صاخبان كلاهما: postgres يرفض الإقلاع ويقول لماذا، وqdrant يفزع عند التحميل. أما التنصيب الجديد فلا يحتاج شيئًا من هذا.

تفحص `npx confer-cli` حالة postgres قبل أن تشغّل شيئًا، وتطبع التعليمات نفسها. وللبقاء على النسختين القديمتين ريثما تجهّز، شغّل الأداة التي كانت تحملهما: `npx confer-cli@0.3.3`.

استبدل أدناه ملف compose الخاص بك واسم مشروعك — `docker-compose.prod.yml` للنسخة المستنسخة، أو `-p confer -f ~/.confer/docker-compose.ghcr.yml` لمسار الأداة. والوحدتان التخزينيتان اسمهما `<المشروع>_pgdata` و`<المشروع>_qdrantdata`.

**1. خذ نسخة احتياطية مرتين.** فالنسخة المنطقية والنسخة البايتية لكل وحدة تخزين تفشلان بطريقتين مختلفتين، وهذا بعينه سبب أخذهما معًا.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. صدّر المتّجهات** — ومعها متّجهاتها، حتى لا يُعاد تمثيل شيء. واحفظ الخرج في `qdrant-export.json`:

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

**3. استبدل الوحدات التخزينية وشغّل النسختين الجديدتين.** حذف الوحدات هو الخطوة المدمّرة؛ فلا تنفّذها حتى تكون الخطوتان 1 و2 قد أنتجتا ملفات نظرت إليها.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. استعِد.** تعيد النسخة المنطقية إنشاء دور `confer` وقاعدته اللذين أنشأتهما الحاوية الجديدة سلفًا، فخطآن من نوع `already exists` متوقّعان؛ وما عداهما فلا.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

ثم أعد المتّجهات إلى مكانها — والمجموعات أولًا، لأن التطبيق لا ينشئها إلا عند الحاجة:

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

**5. تحقّق من البيانات لا من السجلّات.** ينبغي أن تطابق أعداد الصفوف ما كان في النسخة القديمة، وأن يعيد البحث نتائج:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

احتفظ بـ`confer_pgdata_backup` و`confer_qdrantdata_backup` حتى تستعمل النسخة مدةً — فهما طريق العودة الوحيد.

## حلّ المشكلات

| العَرَض | السبب المرجَّح / العلاج |
|---------|--------------------|
| `postgres` يعيد التشغيل في حلقة بعد الترقية | وحدته التخزينية كتبها PostgreSQL 16. انظر [ترقية نسخة أُنشئت قبل 2026-08-29](#ترقية-نسخة-أُنشئت-قبل-2026-08-29). |
| `qdrant` يخرج بالرمز 101 مع أثر فزع | تخزينه كتبه Qdrant 1.12. القسم نفسه أعلاه. |
| `port is already allocated` على المنفذ 80 | شيء آخر يملك المنفذ 80. اضبط `EXPOSE_PORT=8080` في `.env` وافتح http://localhost:8080. |
| واجهة الويب تُحمَّل لكن كل طلب يعيد 500 | راجع `docker compose -f docker-compose.prod.yml logs gateway`. والأغلب أن `JWT_SECRET` أو `ENCRYPTION_KEY` فارغ: فليس لهما قيمة افتراضية في compose، ولا بدّ من وجودهما في `.env`. |
| `migrate` ينتهي برمز غير صفري | لم يكن Postgres سليمًا بعد، أو أن `DATABASE_URL` خاطئ. أعد `docker compose -f docker-compose.prod.yml up -d`؛ و`migrate` متماثل الأثر. |
| الإضافة: `login failed` / 401 | `CONFER_GATEWAY_URL` خاطئ (انظر الجدول — في الإنتاج المنفذ 80 لا 3000)، أو أن اسم المستخدم أو كلمة المرور خاطئة. |
| الإضافة: `connection refused` على :3000 | أنت على إعداد الأمر الواحد؛ استعمل `http://localhost` بدل `:3000`. |
| استدعاءات النموذج تفشل | لا مفتاح نموذج مضبوط لمستخدمك. أضف واحدًا من الإعدادات. |
| أخطاء في التمثيل المتّجهي أو RAG | انظر `.claude/skills/rag-debug`، أو شغّل مهارة rag-debug لتشخيص Qdrant والتمثيل المتّجهي وMinIO. |

## انظر أيضًا

- [`docs/02-architecture.md`](./02-architecture.md) — بنية النظام وحدود الخدمات
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — إعداد المطوّر، ومنظومة الاختبار، والاصطلاحات
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — مرجع إضافة Claude Code
