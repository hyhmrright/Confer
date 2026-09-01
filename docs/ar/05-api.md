# Confer — مواصفات واجهة البرمجة

تحدّد كل واجهات البرمجة بين العميل والخادوم، وبين الخادوم وأقران A2A.

## اصطلاحات عامة

- Base URL: `https://{instance}/api`
- الترميز: JSON، UTF-8
- صيغة الوقت: ISO 8601 بالتوقيت العالمي (`2024-11-15T14:30:00Z`)
- المعرّفات: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- صيغة الخطأ:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## التوثيق

- عميل المستخدم: `Authorization: Bearer <jwt_access_token>`
- مدة صلاحية رمز الوصول: 15 دقيقة؛ ومدة رمز التجديد: 90 يومًا
- يتمايز الرمزان بحقل `typ` (`access` / `refresh`)، و**لا يقوم أحدهما مقام الآخر**: ترويسة `Authorization` لا تقبل إلا `access`، و`POST /auth/refresh` لا يقبل إلا `refresh`. كانا من قبل لا يختلفان إلا في `exp`، فصار رمز التجديد جواز مرور لتسعين يومًا على كل مسار يشترط التوثيق، وغدت الدقائق الخمس عشرة لرمز الوصول بلا معنى
- يدور رمز التجديد مع كل استعمال ويُقابَل بـ`sessions.refresh_token_hash`؛ فإن لم يطابق عُدّ إعادة استعمال وأُبطلت الجلسة كلها. و`sessions.expires_at` هو الحدّ **المطلق** للجلسة: الدوران لا يمدّه
- تُحفظ الرموز في التخزين المحلي للعميل، لا في كعكة HTTP-only (العميل تطبيق سطح مكتب مبني على Tauri، ولا نظير فيه لكعكات المصدر نفسه)

## واجهة العميل (يستعملها عميل المستخدم)

### التوثيق

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` الطلب:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

الاستجابة:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### إعدادات المستخدم والوكيل

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # هل كل مزوّد مضبوط (يعيد قيمًا منطقية فقط، ولا يعيد المفتاح أبدًا)
PUT    /api/v1/agents/me/llm-keys      # يخزّن مفاتيح واجهات نماذج اللغة مشفَّرة
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # يسأل المزوّد مباشرة عن النماذج المتاحة لديه
```

تأتي قيم `provider` من فهرس المزوّدين في `@confer/shared` (`packages/shared/src/llm/catalog.ts`)، مضافًا إليها خدمة الأدوات `tavily`. يقرأ هذا الفهرس كلٌّ من البوابة وagent-runtime والعميل: عنوان الأساس ومسار قائمة النماذج والنموذج الافتراضي مكتوبة في ذلك الموضع وحده، فإضافة مزوّد جديد لا تعني إلا تعديل الفهرس.

`/models` يمرّر قائمة النماذج التي يقدّمها المزوّد نفسه، ولا يعيد أبدًا قائمة نتعهّدها نحن محليًا:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// القائمة الفارغة تحمل سببها دائمًا، والأسباب الأربعة متمايزة ولكلٍّ منها علاجه
{ "models": [], "error": "no_key" }        // هذا المزوّد لم يُضبط له مفتاح بعد
{ "models": [], "error": "unauthorized" }  // رفض المزوّد المفتاح (401/403)
{ "models": [], "error": "unreachable" }   // تعذّر الوصول إلى المزوّد، أو أعاد خطأً آخر
{ "models": [], "error": "unsupported" }   // هذا المزوّد لا يوفّر مسارًا لسرد النماذج
```

### جهات الاتصال / وكلاء الطرف الآخر

```
GET    /api/v1/contacts                     # سرد جهات الاتصال. التصفّح: ?limit=&offset=
POST   /api/v1/contacts                     # إضافة جهة اتصال
GET    /api/v1/contacts/{contact_id}        # تفاصيل جهة اتصال واحدة (مع قرينها)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # تعديل جزئي لـ alias / tags / pinned / muted (الحقول غير المرسلة لا تُمحى)

POST   /api/v1/contacts/lookup              # البحث بـ DID أو النطاق أو اسم المستخدم
```

`POST /api/v1/contacts/lookup` الطلب:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

يعيد `GET /api/v1/contacts` الشكل `{ contacts, total }`. قيمة `limit` الافتراضية 50 وحدّها الأعلى 100، و`offset` افتراضها 0؛ والترتيب على `id` (وهو ULID) تنازليًا، أي الأحدث أولًا — وكون الترتيب وحيدًا وحتميًا هو بعينه ما يمنع نافذة الإزاحة من تخطّي صفوف أو تكرارها. و`total` هو العدد الكلي لا عدد هذه الصفحة، وبه يعرف العميل أنه بلغ النهاية. وما لا يمكن تحليله من `limit` أو `offset` يأخذ القيمة الافتراضية بدل أن يثير خطأً.

الاستجابة: قائمة الوكلاء المرشّحين الذين عُثر عليهم. والبحث **يقيّد في `peer_agents`** ما يكتشفه من أقران، ويرفق مع كل مرشّح معرّفه المحلي (`peer_id`) — وهو المعرّف نفسه الذي يستعمله `POST /api/v1/contacts` لإضافة جهة الاتصال. و`POST /contacts` مُتماثل الأثر: إضافة القرين نفسه ثانيةً تعيد جهة الاتصال القائمة (`200`) بدل أن ترمي خطأً.

> إضافة جهة اتصال هي **إذن من الطرف المستقبِل بأن يستهلك الآخرُ وكيلَه**: لا يستطيع أن يستدعي جواب وكيلي (وأن ينفق من ميزانيتي على نماذج اللغة) إلا قرين أُضيف جهةَ اتصال. أما رسائل A2A من قرين غير موصول فتُعلَّق بوصفها طلب اتصال ينتظر الموافقة؛ انظر «بوابة الإذن بالاتصال» في `03-protocol.md`.

```
POST   /api/v1/contacts/{contact_id}/policies   # ضبط السياسات الدائمة (استبدال كامل، بدلالة PUT)
```

جسم `POST /contacts/{id}/policies` على هيئة زمن التشغيل `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }`، ويُكتب كاملًا في `peer_contacts.policy_overrides_json`. **دلالة الدمج**: عند البتّ في طلب A2A وارد، يعلو هذا التجاوز الخاص بجهة الاتصال فوق سياسة الوكيل — فإن حضر `contact.default` حلّ محل افتراض الوكيل، و`contact.rules` تتقدّم قواعد الوكيل فتُطابَق أولًا (فالقاعدة الدقيقة لجهة اتصال تغلب القاعدة العامة للوكيل). أما التجاوز الفارغ `{}` فهو المحايد: يخرج القرار مطابقًا بايتًا ببايت لما كان سيخرج من دون تجاوز.

### المحادثات

```
GET    /api/v1/conversations                       # سرد محادثاتي (لواجهة البداية)
POST   /api/v1/conversations                       # إنشاء محادثة
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # التصفّح: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # إرسال رسالة
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # استقبال جواب النموذج تدفّقًا عبر SSE

POST   /api/v1/conversations/{id}/participants     # إضافة مشارك
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # التعليم كمقروء
```

`POST /api/v1/conversations/{id}/messages` الطلب:

```json
{
  "content_type": "text",
  "content": "أيّ رمز وظيفة يستعمله السجلّ 0x40 في X100؟",
  "in_reply_to": null,
  "via": "web"
}
```

الاستجابة:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### إدارة الأذونات

```
GET    /api/v1/permissions/pending               # طلبات L2/L3 المعلّقة
POST   /api/v1/permissions/{id}/decide           # الموافقة أو الرفض
GET    /api/v1/permissions/history               # السجل
```

`POST /api/v1/permissions/{id}/decide` الطلب:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // نطاق القرار
}
```

ما كان من الطلبات المعلّقة بـ`action='connect'` فهو **طلب اتصال** (يولّده مسار A2A الوارد عند أول اتصال من قرين مجهول). والموافقة (`allow_*`) تكتب ذلك القرين في `peer_contacts` فينعقد الاتصال؛ والرفض لا ينعقد معه شيء.

وما كان بـ`action='ask'` فهو **سؤال معلّق من قرين موصول من قبل**، يولّده مسار A2A الوارد حين تقضي سياسة الوكيل في ذلك السؤال بـ`ask_user` (انظر «صندوق الانتظار (الجواب في غياب صاحبه)» في `03-protocol.md`). فالموافقة (`allow_*`) تدفع الوكيل إلى الإجابة عن السؤال المعلّق؛ والرفض يدعه بلا جواب.

يرفق `GET /pending` بكل طلب حقل `description` (ففي طلب الاتصال اسم المبادِر ورسالته الأولى، وفي السؤال اسم السائل ونصّ سؤاله) ليتمكّن صاحب الوكيل من الحكم.

### ذاكرة المشروع (متعلقة بالتكامل مع Claude Code)

```
GET    /api/v1/projects/{project_id}/peers              # الأقران الذين لهم ذاكرة في هذا المشروع (مع name/did عبر الوصل)  ✅ منجَز
POST   /api/v1/projects/{project_id}/peers              # تسجيل قرين في المشروع تسجيلًا صريحًا   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ منجَز
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ منجَز
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ منجَز
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ منجَز
```

إيضاحات الدلالة (الإصدار v0.1):

- كل الاستعلامات محصورة في `user.sub` (عزل بين المستخدمين).
- قبل أي PUT يُتحقّق من أن القرين جهةُ اتصال لذلك المستخدم (`peer_contacts`)؛ فإن لم يكن أُعيد `403 not_a_contact`.
- يعمل PUT بالإدراج أو التحديث: تضع الكتابة الأولى `version=1`، وكل كتابة تالية تزيد `version` وتُحدّث `updated_at`. و`facts` و`decisions` مستقلّان — فكتابة أحد القسمين لا تمحو الآخر.
- يعيد `GET facts/decisions` رمز `200` وسلسلة فارغة و`version:0` حين لا تكون لذلك الزوج (مشروع، قرين) ذاكرةٌ بعد (لا 404؛ فقولنا «لم يترك هذا القرين شيئًا بعد» حالٌ طبيعية في القراءة).
- يُتحقّق من `project_id` بالنمط `^[a-zA-Z0-9._\-/]+$` (من 1 إلى 255 محرفًا)؛ وما خالف ذلك يعيد `400 invalid_project_id`.
- يعيد `GET peers` مصفوفة فارغة في مشروع خالٍ. وتنشأ علاقة (المشروع، القرين) ضمنيًا عند PUT على facts/decisions (ولا تسجيل صريح بـ`POST peers` في هذه المرحلة).

### قاعدة المعرفة (RAG)

```
GET    /api/v1/knowledge-bases                                  # سرد قواعد معرفتي
POST   /api/v1/knowledge-bases                                  # إنشاء قاعدة
PATCH  /api/v1/knowledge-bases/{kb_id}                          # تغيير الاسم أو الوصف، وهل تُفتح للوكلاء الخارجيين
DELETE /api/v1/knowledge-bases/{kb_id}                          # حذفها ومعها كل مستنداتها ومتّجهاتها

GET    /api/v1/knowledge-bases/{kb_id}/documents                # التصفّح: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # رفع multipart، واسم الحقل file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # إعادة الفهرسة
```

جسم `POST /knowledge-bases` هو `{ name, description? }` (و`name` من 1 إلى 255 محرفًا)، والاستجابة `201` مع `{ knowledge_base }`.

جسم `PATCH /knowledge-bases/{kb_id}` هو `{ name?, description?, shared_with_peers? }`، والاستجابة `{ knowledge_base }`. و**`shared_with_peers` لا يُغيَّر إلا هنا ولا يُقبل عند الإنشاء**: فكل قاعدة تولد «لي وحدي»، وفتحها للخارج فعلٌ ثانٍ مقصود.

ما يقرّره `shared_with_peers` هو **هل يستطيع سؤال A2A وارد أن يبحث في هذه القاعدة**، وقيمته الافتراضية `false`. ولا أثر له على صاحب الوكيل حين يحاور من المتصفّح: هو يبحث في كل شيء دائمًا. ويجب أن تقع هذه الحدود على نطاق البحث لا في التوجيه النصّي: فسؤال الطرف الآخر وتعليمات صاحب الوكيل يبلغان النموذج بوصفهما نصًّا من جنس واحد، فقولنا «سيقدّر الوكيل بنفسه ما يجوز إفشاؤه» ليس حدًّا البتة. وللسبب نفسه، لا يستدعي السؤال الوارد عبر A2A **أيّ ذاكرة بعيدة المدى**: فتلك مستخلَصة من محاورات صاحب الوكيل نفسه، وليس فيها مدخلة واحدة موسومة بأنها تصلح لمغادرة هذه النسخة.

يعيد `GET /knowledge-bases` الشكل `{ knowledge_bases }` و**لا يُصفَّح**: فقواعد المستخدم يبنيها بيده وعددها محدود.

يعيد `GET /{kb_id}/documents` الشكل `{ documents, total }`. قيمة `limit` الافتراضية 50 وحدّها 100، و`offset` افتراضه 0؛ والترتيب على `id` (ULID) تنازليًا، أي الأحدث أولًا — والترتيب الوحيد الحتمي هو ما يمنع نافذة الإزاحة من تخطّي صفوف أو تكرارها. و`total` هو العدد الكلي لا عدد هذه الصفحة. وما لا يُقرأ من `limit` أو `offset` يأخذ الافتراضي بدل أن يثير خطأً. وهذه هي القائمة الوحيدة في هذا القسم التي تنمو بلا حدّ، لأن قاعدة المعرفة هي بعينها وجهة الرفع.

يجري الرفع عبر `multipart/form-data`، واسم حقل الملف `file` دائمًا، وحدّ الملف الواحد **10 ميغابايت** (وما زاد أعاد `400 bad_request`). ويؤخذ `Content-Type` من النموذج إن ورد فيه، وإلا استُنبط من الامتداد. والاستجابة `201` مع `{ document }`، وقيمة `status` عندئذٍ `processing` سلفًا: **فالتقطيع والتمثيل المتّجهي والكتابة في Qdrant تجري لاحقًا وبالتوازي بعد الاستجابة**، ولا ينتظرها مسار الرفع. ومن ثمّ يستطلع العميل قائمة المستندات حتى تتغيّر `status`.

قيم `status`:

| القيمة | المعنى |
|---|---|
| `processing` | حُفظ، ويجري تقطيعه أو تمثيله متّجهيًا. وهي الحال الأولى بعد الرفع وبعد إعادة المحاولة |
| `ready` | صار قابلًا للبحث. و`chunk_count` عدد أجزاء ذلك المستند |
| `failed` | أخفقت الفهرسة (تعذّر التحليل، أو غاب مفتاح التمثيل المتّجهي، أو أخفقت الكتابة في قاعدة المتّجهات) |

يجلب `POST /{doc_id}/retry` الملف الأصلي من مخزن الكائنات ويعيد فهرسته؛ وهو يمحو أولًا متّجهات ذلك المستند القائمة، فلا تنشأ أجزاء مكرّرة. ويعيد `400` إن لم يعد الملف الأصلي موجودًا (`storage_key` فارغ) أو كان المستند لا يزال في `processing`. والاستجابة `{ document }`، وقد عادت `status` إلى `processing` و`chunk_count` إلى الصفر.

حذف قاعدة المعرفة يحذف تِبَاعًا كل صفوف مستنداتها ومتّجهاتها في Qdrant؛ وحذف مستند بمفرده ينظّف كذلك متّجهاته وملفه الأصلي في مخزن الكائنات. وإخفاق تنظيف المتّجهات أو الكائنات لا يعطّل الحذف من قاعدة البيانات: فبقاء كائن يتيم خير من بقاء صفّ يشير إلى بيانات محذوفة.

كل المسارات محصورة في `user.sub`: والوصول إلى قاعدة غيرك أو مستنده يعيد `404` (لا `403`، كي لا يُفشى وجوده أصلًا).

> على الوسيط العكسي أن يسمح بأجسام حجمها 10 ميغابايت. وقد ضبط `infra/nginx.conf` القيمة `client_max_body_size 10m` على `/api/`؛ أما بقيمة nginx الافتراضية، وهي ميغابايت واحد، فالملفات بين 1 و10 ميغابايت لا تبلغ البوابة أصلًا، ويتلقّى المتصفّح صفحة 413 من nginx نفسه.

### المرفقات

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # تنزيل (تحويل 302 إلى عنوان موقَّع)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### المسار

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

توثيق المصافحة مطابق تمامًا لتوثيق REST، وليس «صحّ التوقيع فليمرّ»: فـ`typ` يجب أن يكون `access`، و`sid` يجب أن يشير إلى جلسة لا تزال قائمة، والحساب يجب ألّا يكون `disabled`. والشروط الثلاثة لا يُستغنى عن واحد منها: فبدونها يكفي الحسابَ المحظور أن يكون رمزه لم ينتهِ ليظلّ يعيد الاتصال ويستقبل الرسائل، بينما الحظر نفسه (محو جلساته كلها) لا يُبطل شيئًا على هذا المسار. والحظر يُغلق أيضًا **المقابس المفتوحة أصلًا** لذلك المستخدم: فـnginx يمنح `/ws` مهلة `proxy_read_timeout` مقدارها يوم كامل، وإيقاف المصافحة التالية لا يوقف اتصالًا قائمًا.

### صيغة الرسائل

كل رسائل WS من نوع JSON وتحمل حقل `type`:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### من العميل إلى الخادوم

```
ping                          // نبضة
subscribe.conversation        // الاشتراك في محادثة (يتحقّق الخادوم من كونك مشاركًا فيها)
unsubscribe.conversation
typing.start                  // لا يسري إلا على المحادثات المشترَك فيها
typing.stop
read.ack                      // إقرار القراءة
```

يجري بثّ `typing.*` وفق مجموعة اشتراكات ذلك المقبس. فحين يكون للاشتراك بوابة ولا تكون لأحداث الكتابة بوابة، تكفي معرفة معرّف محادثة ما لحقن «فلان يكتب الآن» فيها — وباسم المستخدم نفسه فوق ذلك.

### من الخادوم إلى العميل

```
pong
message.new                   // رسالة جديدة
message.updated
message.deleted
typing.update                 // من يكتب الآن
presence.update               // اتصال جهة اتصال أو انقطاعها
permission.request            // طلب إذن يحتاج قرار المستخدم
agent.status                  // ماذا يفعل وكيلي («أستشير وكيل ABC…»)
conversation.updated
```

`message.new` مثال:

```json
{
  "type": "message.new",
  "data": {
    "id": "01HXKQ...",
    "conversation_id": "01HX...",
    "sender_type": "peer_agent",
    "sender_id": "01HY...",
    "sender_did": "did:web:acme.com:agents:support",
    "content_type": "text",
    "content": "بالرمز 0x03، أي Read Holding Registers…",
    "citations": [
      {
        "source": "دليل اتصالات X100 الإصدار 3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "ar",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` مثال:

```json
{
  "type": "permission.request",
  "data": {
    "id": "01HXP...",
    "level": "L2",
    "action": "share_files",
    "scope": {
      "peer": "did:web:acme.com:agents:support",
      "paths": ["src/modbus/"],
      "exclude": [".env", "secrets/"]
    },
    "peer_name": "ABC Agent",
    "peer_did": "did:web:acme.com:agents:support",
    "requested_at": "2024-11-15T14:30:00Z"
  }
}
```

**ليس في الحمولة حقل `description`، وهذا مقصود.** فالخادوم لا يدري بأي لغة يقرأ المتلقّي، فلا يرسل إلا وقائع مبنيّة (`action` + هوية القرين + `scope` المخزَّن)، أما الجملة التي تُقرأ عند الموافقة فيؤلّفها العميل وفق تعريبه (`packages/client/src/lib/permission-text.ts`). وهذا العقد ملك خالص لـ`permissionRequestEventSchema` في `@confer/shared`: به تحلّل البوابةُ قبل الإرسال، وبه يحلّل العميل بعد الاستقبال.

كل صفّ من `GET /api/v1/permissions/pending` على الهيئة نفسها (مع حقل `decision` زائد)، ويصدر عن المُنشئ نفسه، فيتطابق الصفّ الذي يأتي بالاستطلاع والصفّ الذي يدفعه المقبس بايتًا ببايت.

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

أنواع الأحداث:

```
event: token
data: {"text":"بالرمز "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"دليل اتصالات X100 الإصدار 3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## واجهة A2A (إلى الخارج، تستدعيها نسخ Confer الأخرى)

التفصيل في `docs/03-protocol.md`. وهنا سرد المسارات فحسب.

يتعايش ربطان تحت البادئة نفسها ويمرّان بالبوّابات نفسها (`a2a/inbound.ts`)، ولا يفترقان إلا في صيغة السلك.

**ربط A2A القياسي HTTP+JSON** (المسارات منقولة حرفيًا عن §11.3 من المواصفة، وهو الذي تعلنه بطاقة الوكيل):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks(تصفّح بمؤشّر)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # غير منجَز → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # غير منجَز → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # غير منجَز → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**لهجة Confer الخاصة** (بين النسخ؛ تُكتشف عبر `/.well-known/agents.json`):

```
POST   /a2a/v1/messages                  # يستقبل رسائل الوكلاء الخارجيين
GET    /a2a/v1/stream/{message_id}       # يسحب الجواب تدفّقًا (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # AgentFacts العلنية
```

كل مسارات A2A تشترط التحقّق من توقيع رسالة HTTP.

## .well-known endpoints

```
GET    /.well-known/did.json                # مستند DID الرئيس
GET    /.well-known/agents.json             # قائمة كل الوكلاء العلنيين في هذه النسخة
GET    /.well-known/agent-card.json         # بطاقة الوكيل القياسية لـA2A (فقط إن كان في النسخة وكيل علني واحد)
GET    /.well-known/openid-configuration    # مستقبلًا: التوافق مع OIDC (الإصدار v2)
```

## بطاقة الوكيل القياسية لـA2A (طبقة الاكتشاف المتوافقة)

```
GET    /agents/{username}/agent-card.json   # بطاقة A2A القياسية لذلك الوكيل
GET    /.well-known/agent-card.json         # المثل، فقط إن كان في هذه النسخة وكيل علني واحد
```

تتبع `AgentCard` من **Agent2Agent v1.0** لمؤسسة لينكس (والحقول مأخوذة من `specification/a2a.proto` في `a2aproject/A2A` @ v1.0.1، بتخطيط JSON الخاص بـproto3، ومن ثمّ جاءت بصيغة camelCase). والغاية أن **يكتشف** نظامُ A2A وكلاءَ هذه النسخة — فقد تشابهت الأسماء ولم تتفاهم البروتوكولات: مستند الاكتشاف عند الطرف الآخر في `/.well-known/agent-card.json`، ولم يكن في هذه النسخة إلا `/.well-known/agents.json`.

بضعة اختيارات مقصودة:

- **بطاقة لكل وكيل**، وفيها `supportedInterfaces[].tenant` = اسم المستخدم. فمسار well-known في المواصفة يفترض وكيلًا واحدًا لكل نطاق، وهذه النسخة متعدّدة المستأجرين؛ و`tenant` هو بعينه مُحدِّد التوجيه الذي عرّفته المواصفة لحالة «عدّة وكلاء خلف مسار A2A واحد». ولا يجيب `/.well-known/agent-card.json` إلا إذا كان الوكيل العلني **واحدًا بالضبط** (حالة من يستضيف لنفسه وحده)، وإلا أعاد 404 وأشار في نص الخطأ إلى `agents.json` — فاختيار حساب أيًّا كان وتسميته «وكيل هذا النطاق» باطل.
- **`streaming: false`**. المسارات التدفّقية موجودة فعلًا، لكنها على هيئة Confer الخاصة لا على `SendStreamingMessage` الذي في المواصفة. والإعلان عن قدرة لا يستطيع عميل قياسي استعمالها أسوأ من ترك الإعلان.
- **لا يُعلَن `securitySchemes`**. فما تعرضه المواصفة هناك هو مفتاح واجهة أو توثيق HTTP أو OAuth2 أو OIDC أو mTLS، وهذا المسار لا يقبل واحدًا منها: إنما يريد طلبًا موقَّعًا. وملء أيٍّ منها اعتباطًا يعادل إخبار العميل بأنه يستطيع التوثّق بطريقة سيُرفض بها حتمًا. أما الاشتراط الحقيقي فمعلَن بوصفه **امتدادًا لازمًا** (`capabilities.extensions`، حيث `uri` عنوان RFC 9421 و`required: true`)، وهي الآلية التي وفّرتها المواصفة لهذا الغرض بعينه.
- البطاقة **مستند اكتشاف**، وظهورها مطابق تمامًا لظهور `/.well-known/agents.json`: فالوكيل غير العلني أو المعطَّل يعيد 404 دائمًا، وإلا صار هذا المسار طريقًا إلى تعداد حسابات لم يُرِد صاحبها إعلانها.

- **لا يُعلَن إلا ربط واحد.** فلهجة Confer الخاصة تسكن هذا العنوان نفسه، ولا تُكتب في البطاقة: إذ تشترط §5.1 أن يكون كل ربط يعلنه وكيلٌ مكافئًا لغيره وظيفيًا، وليس للّهجة دورة حياة للمهام. وهي تُكتشف عبر `/.well-known/agents.json`، فلا تبقى في البطاقة كلمة لا تُنجَز.

### طبقة الرسائل (دلالة Task)

يستقبل `POST /a2a/v1/message:send` رسالة `SendMessageRequest` المعرّفة في المواصفة ويعيد `Task`. و**المهمة هي سؤال وارد واحد**: معرّفها هو معرّف تلك الرسالة، و`contextId` هي المحادثة التي تحفظها، وحالتها تُستنبط ممّا يجري بعدُ — فلا يُنشأ جدول `tasks` منفصل يظلّل الواقعة نفسها.

ونموذج Confer اللامتزامن ببوابة الإذن يقع تمامًا على آلة الحالات في المواصفة:

| الحال | الحالة |
|---|---|
| الوكيل يجيب | `TASK_STATE_WORKING` |
| انتهى الجواب | `TASK_STATE_COMPLETED` |
| هذه الجولة لا تنطلق أصلًا (لا نموذج مضبوط، أو أخفق المزوّد) | `TASK_STATE_FAILED` |
| معلَّق بسياسة `ask_user` بانتظار صاحب الوكيل | `TASK_STATE_AUTH_REQUIRED`(حال انقطاع لا حال نهاية) |
| رفض صاحب الوكيل | `TASK_STATE_REJECTED` |

وثمّة موضعان **لا** مهمّة فيهما تُعاد، لأن صفًّا لم يُنشأ أصلًا: القرين المجهول (ويُعلَّق طلبَ اتصال) والرفض المباشر بالسياسة. وكلاهما يعيد `403 PERMISSION_DENIED` ويتمايزان بـ`ErrorInfo.metadata.confer_status` — فاختلاق معرّف مهمّة يعيد 404 في الاستدعاء التالي أسوأ.

وسائر السلوك موافق للمواصفة بندًا بندًا: جسم الخطأ على هيئة `google.rpc.Status` ويحمل `ErrorInfo.reason` **دائمًا** (فعدّة أخطاء في A2A تشترك في رمز HTTP واحد، و`reason` هو الحقل الوحيد الذي يميّزها)؛ والعميل الذي لم يعلن الامتداد اللازم يُجاب بـ`ExtensionSupportRequiredError` وفق §3.3.4، لا برمز 401 لا يفسّر شيئًا؛ و`historyLength=0` معناه **إسقاط الحقل بتمامه** لا إرسال مصفوفة فارغة؛ و`nextPageToken` حاضر أبدًا، ويكون سلسلة فارغة حين لا صفحة بعده.

وانحرافان مقصودان، كلاهما مدوَّن في تعليقات الشيفرة: انتظار `message:send` الحاجب **له سقف** (55 ثانية، ثم تُعاد المهمّة وهي لا تزال `WORKING` ليستطلعها العميل) — فالبند §3.2.2 لا يترك مخرجًا زمنيًا، ولا حدّ أعلى لاستدعاء نموذج لغوي؛ وتماثل الأثر بـ`messageId` (وهو MAY في §3.3.1) **لم يُنجَز**، لأن المفتاح الفريد الآمن بين المستأجرين يحتاج نطاق المالك، وصيغة السلك في الرسالة الأولى لا تحمله.

## خطّافات الويب (اختياري، الإصدار v1.5+)

تتيح للأنظمة الخارجية الاشتراك في الأحداث:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

الأحداث المدعومة: `message.new.peer` و`permission.granted` و`thread.archived`.

## سياسة تحديد المعدّل

| المسار | الحدّ |
|---|---|
| `/api/v1/auth/login` | 10 في الدقيقة لكل عنوان IP |
| `/api/v1/auth/register` | 3 في الساعة لكل عنوان IP |
| `/api/v1/conversations/*/messages` POST | 60 في الدقيقة لكل مستخدم |
| `/a2a/v1/*` | 100 في الدقيقة لكل نطاق قرين (وأعلى لمن في القائمة البيضاء) |
| WSS | عشرة اتصالات متزامنة للمستخدم الواحد على الأكثر |

الاستجابة عند تجاوز الحدّ:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## واجهة الاستشارة (A2A صادر بمبادرة المستخدم)

تتيح للمستخدم (أو لخادوم MCP نائبًا عنه) أن يسأل بمبادرته وكيلًا قرينًا **هو جهة اتصال له أصلًا**، ثم يستردّ الجواب لاحقًا. ويتمّ التوقيع والتسليم داخل البوابة كلّه، ولا يغادرها المفتاح الخاص.

> الفرق عن «واجهة المحادثات»: `/api/v1/conversations` مع `/api/v1/stream` هو محاورة **مساعد نماذج اللغة المحلي الخاص بك**؛ أما `/api/v1/consult` فهو ما يُرسَل عبر A2A إلى **وكيل شخص آخر**.

### POST `/api/v1/consult/:peerId`

يفتح محادثة من `type='consult'` أو يواصلها (ولكل قرين المحادثة نفسها يُعاد استعمالها)، ثم يوقّع `message.type='question'` ويسلّمه.

```jsonc
// جسم الطلب (consultRequestSchema)
{ "question": "كيف تُدوَّر المفاتيح؟", "code_context": "…شيفرة اختيارية…", "language": "ar" }
```

| الاستجابة | المعنى |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | وُقِّعت وسُلِّمت |
| `502 { ..., status: "failed", error }` | أخفق التسليم (القرين غير متصل، أو لا مسار له، أو خلل في التوقيع) |
| `403 not_a_contact` | القرين ليس جهة اتصال للمستخدم الحالي |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

ينتظر باستطلاع طويل جوابَ القرين اللامتزامن (يصل عبر مسار `/a2a/v1/messages` الوارد حاملًا `thread_id`، فتعيد البوابة تعليقه في خيطه). وسقف `wait` خمس وخمسون ثانية.

- `200 { status: "answered", message }` — وصل الجواب
- `200 { status: "pending" }` — انقضت المهلة ولا جواب؛ ويمكن الاستطلاع مرة أخرى لاحقًا

### GET `/api/v1/consult/:conversationId`

يعيد سجلّ رسائل خيط الاستشارة كاملًا (مئتا رسالة على الأكثر).

> العقد: لا يُطلق A2A الوارد جوابَ الوكيل المحلي التلقائي إلا لـ`message.type==='question'`؛ أما `answer` و`notification` فيُحفظان ويُبثّان فقط، كي لا يستدرج جوابُ الاستشارة تبادلًا لا ينتهي.
