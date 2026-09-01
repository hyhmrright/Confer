# Confer — API تفصیلات

کلائنٹ ↔ سرور اور سرور ↔ A2A peer کے درمیان تمام API یہاں متعین ہیں۔

## عام اصول

- Base URL: `https://{instance}/api`
- اینکوڈنگ: JSON، UTF-8
- وقت کی صورت: ISO 8601، UTC (`2024-11-15T14:30:00Z`)
- ID: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- خرابی کی صورت:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## توثیق

- صارف کا کلائنٹ: `Authorization: Bearer <jwt_access_token>`
- access token کی مدت: 15 منٹ؛ refresh token کی مدت: 90 دن
- دونوں ٹوکن `typ` کلیم سے الگ ہوتے ہیں (`access` / `refresh`) اور **ایک دوسرے کی جگہ نہیں چلتے**: `Authorization` ہیڈر صرف `access` لیتا ہے اور `POST /auth/refresh` صرف `refresh`۔ پہلے ان میں فرق صرف `exp` کا تھا، سو refresh token ہر توثیق طلب راستے پر نوے دن کا پروانہ بن جاتا تھا اور access token کے پندرہ منٹ بے معنی رہ جاتے تھے
- ہر بار refresh گھومتا ہے اور `sessions.refresh_token_hash` سے ملایا جاتا ہے؛ نہ ملے تو اسے دوبارہ استعمال سمجھ کر پورا سیشن باطل کر دیا جاتا ہے۔ `sessions.expires_at` سیشن کی **مطلق** حد ہے — گھمانے سے وہ آگے نہیں بڑھتی
- ٹوکن کلائنٹ کے مقامی اسٹوریج میں رہتے ہیں، HTTP-only کوکی میں نہیں (کلائنٹ ایک Tauri ڈیسک ٹاپ ایپ ہے، جہاں ہم-اصل کوکی جیسی کوئی چیز ہے ہی نہیں)

## کلائنٹ API (صارف کا کلائنٹ اسے استعمال کرتا ہے)

### توثیق

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` درخواست:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

جواب:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### صارف اور Agent کی ترتیب

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # ہر فراہم کنندہ ترتیب شدہ ہے یا نہیں (صرف بولین لوٹاتا ہے، کلید کبھی نہیں)
PUT    /api/v1/agents/me/llm-keys      # LLM کی API کلیدیں مشفّر کر کے رکھتا ہے
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # فراہم کنندہ سے براہِ راست پوچھتا ہے کہ اس کے پاس کون سے ماڈل ہیں
```

`provider` کی قدریں `@confer/shared` کی فراہم کنندہ فہرست سے آتی ہیں (`packages/shared/src/llm/catalog.ts`)، اور ساتھ ٹول سروس `tavily`۔ یہ فہرست گیٹ وے، agent-runtime اور کلائنٹ — تینوں پڑھتے ہیں: base URL، ماڈل فہرست کا راستہ اور طے شدہ ماڈل صرف اُسی ایک جگہ لکھے ہیں، سو نیا فراہم کنندہ شامل کرنے کا مطلب صرف فہرست بدلنا ہے۔

`/models` فراہم کنندہ کی اپنی ماڈل فہرست آگے بڑھا دیتا ہے؛ مقامی طور پر رکھی کوئی فہرست کبھی نہیں لوٹاتا:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// خالی فہرست ہمیشہ اپنی وجہ ساتھ لاتی ہے؛ چاروں الگ ہیں اور ہر ایک کا علاج بھی الگ
{ "models": [], "error": "no_key" }        // اس فراہم کنندہ کی کلید ابھی ترتیب نہیں دی گئی
{ "models": [], "error": "unauthorized" }  // فراہم کنندہ نے کلید مسترد کر دی (401/403)
{ "models": [], "error": "unreachable" }   // فراہم کنندہ تک رسائی نہ ہوئی، یا اس نے کوئی اور خرابی لوٹائی
{ "models": [], "error": "unsupported" }   // یہ فراہم کنندہ ماڈل فہرست کا راستہ دیتا ہی نہیں
```

### روابط / دوسرے Agent

```
GET    /api/v1/contacts                     # روابط کی فہرست۔ صفحہ بندی: ?limit=&offset=
POST   /api/v1/contacts                     # رابطہ شامل کریں
GET    /api/v1/contacts/{contact_id}        # ایک رابطے کی تفصیل (peer سمیت)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # alias / tags / pinned / muted میں جزوی تبدیلی (جو خانے نہ بھیجے جائیں وہ مٹتے نہیں)

POST   /api/v1/contacts/lookup              # DID / ڈومین / صارف نام سے تلاش
```

`POST /api/v1/contacts/lookup` درخواست:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` `{ contacts, total }` لوٹاتا ہے۔ `limit` کا طے شدہ 50 اور زیادہ سے زیادہ 100، `offset` کا طے شدہ 0؛ ترتیب `id` (ULID) کے نزولی حساب سے ہے، یعنی تازہ ترین پہلے — ترتیب کا واحد اور یقینی ہونا ہی وہ چیز ہے جو offset کی کھڑکی کو سطریں چھوڑنے یا دہرانے سے روکتی ہے۔ `total` پوری گنتی ہے، اس صفحے کی نہیں، اور اسی سے کلائنٹ جانتا ہے کہ آخر آ گیا۔ جو `limit`/`offset` پڑھے نہ جا سکیں وہ خرابی دینے کے بجائے طے شدہ قدر لے لیتے ہیں۔

جواب: ملنے والے ممکنہ Agent کی فہرست۔ تلاش جن peer کو پاتی ہے انہیں **`peer_agents` میں لکھ دیتی ہے** اور ہر امیدوار کے ساتھ مقامی `id` (`peer_id`) بھی دیتی ہے — `POST /api/v1/contacts` اُسی `id` سے رابطہ شامل کرتا ہے۔ `POST /contacts` idempotent ہے: وہی peer دوبارہ شامل کرنے پر خرابی نہیں، پہلے سے موجود رابطہ (`200`) لوٹتا ہے۔

> رابطہ شامل کرنا دراصل **وصول کنندہ کی وہ رضامندی ہے کہ سامنے والا اس کے Agent کو خرچ کر سکے**: صرف وہی peer میرے Agent سے جواب دلوا سکتا ہے (اور میرا LLM بجٹ خرچ کر سکتا ہے) جو رابطے کے طور پر جڑا ہو۔ غیر جڑے peer کے A2A پیغام منظوری کے انتظار میں کنکشن کی درخواست بن کر معلق رہتے ہیں؛ دیکھیں `03-protocol.md` کا «کنکشن رضامندی کا دروازہ»۔

```
POST   /api/v1/contacts/{contact_id}/policies   # مستقل پالیسیاں طے کریں (مکمل تبدیلی، PUT جیسا مفہوم)
```

`POST /contacts/{id}/policies` کا body رن ٹائم صورت میں `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` ہوتا ہے اور پورا کا پورا `peer_contacts.policy_overrides_json` میں لکھا جاتا ہے۔ **ادغام کا مفہوم**: اندر آتی A2A درخواست پر فیصلہ کرتے وقت یہ فی رابطہ سبقت پالیسی Agent کی پالیسی کے اوپر چڑھتی ہے — `contact.default` موجود ہو تو وہ Agent کے طے شدہ کی جگہ لیتا ہے، اور `contact.rules` Agent کے قواعد سے پہلے آتے ہیں سو پہلے لگتے ہیں (کسی رابطے کا مخصوص قاعدہ Agent کے عمومی قاعدے پر بھاری پڑتا ہے)۔ خالی سبقت `{}` تطابقی ہے: فیصلہ بائٹ در بائٹ وہی رہتا ہے جو بغیر سبقت کے ہوتا۔

### گفتگو

```
GET    /api/v1/conversations                       # میری گفتگوؤں کی فہرست (پہلے صفحے کے لیے)
POST   /api/v1/conversations                       # نئی گفتگو بنائیں
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # صفحہ بندی: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # پیغام بھیجیں
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # SSE سے LLM کا جواب رواں صورت میں لیں

POST   /api/v1/conversations/{id}/participants     # شریک شامل کریں
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # پڑھا ہوا نشان زد کریں
```

`POST /api/v1/conversations/{id}/messages` درخواست:

```json
{
  "content_type": "text",
  "content": "X100 کے رجسٹر 0x40 کے لیے کون سا فنکشن کوڈ چاہیے؟",
  "in_reply_to": null,
  "via": "web"
}
```

جواب:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### اجازتوں کا انتظام

```
GET    /api/v1/permissions/pending               # زیرِ التوا L2/L3 درخواستیں
POST   /api/v1/permissions/{id}/decide           # منظور / مسترد کریں
GET    /api/v1/permissions/history               # تاریخچہ
```

`POST /api/v1/permissions/{id}/decide` درخواست:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // فیصلے کا دائرہ
}
```

زیرِ التوا درخواستوں میں جن کا `action='connect'` ہے وہ **کنکشن کی درخواستیں** ہیں (اجنبی peer کے پہلے رابطے پر A2A داخلی راستہ انہیں بناتا ہے)۔ منظوری (`allow_*`) اس peer کو `peer_contacts` میں لکھ کر کنکشن بنا دیتی ہے؛ انکار سے نہیں بنتا۔

جن کا `action='ask'` ہے وہ **پہلے سے جڑے peer کے زیرِ التوا سوال** ہیں — جب Agent کی پالیسی اُس سوال پر `ask_user` طے کرتی ہے تب A2A داخلی راستہ انہیں بناتا ہے (دیکھیں `03-protocol.md` کا «معلق ان باکس (غیر حاضری میں جواب)»)۔ منظوری (`allow_*`) پر Agent اُس معلق سوال کا جواب دیتا ہے؛ انکار پر نہیں دیتا۔

`GET /pending` ہر درخواست کے ساتھ ایک `description` دیتا ہے (کنکشن کی درخواست میں پہل کرنے والا اور اس کا پہلا پیغام؛ سوال میں پوچھنے والا اور سوال کا متن) تاکہ مالک فیصلہ کر سکے۔

### منصوبہ یادداشت (Claude Code انضمام سے متعلق)

```
GET    /api/v1/projects/{project_id}/peers              # اس منصوبے میں جن peer کی یادداشت ہے (join سے name/did سمیت)  ✅ نافذ
POST   /api/v1/projects/{project_id}/peers              # peer کو منصوبے میں صراحتاً درج کریں   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ نافذ
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ نافذ
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ نافذ
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ نافذ
```

مفہوم سے متعلق نوٹ (v0.1):

- تمام استفسارات `user.sub` تک محدود ہیں (صارفین کے درمیان علیحدگی)۔
- PUT سے پہلے جانچا جاتا ہے کہ peer اُس صارف کا رابطہ ہے (`peer_contacts`)؛ نہ ہو تو `403 not_a_contact` لوٹتا ہے۔
- PUT upsert کرتا ہے: پہلی تحریر پر `version=1`، ہر اگلی پر `version` بڑھتا ہے اور `updated_at` تازہ ہوتا ہے۔ `facts` اور `decisions` خودمختار ہیں — ایک حصہ لکھنے سے دوسرا نہیں مٹتا۔
- جب اُس (منصوبہ، peer) جوڑے کی کوئی یادداشت نہ ہو تو `GET facts/decisions` `200`، خالی سٹرنگ اور `version:0` لوٹاتا ہے (404 نہیں؛ «اس peer کا ابھی کچھ جمع نہیں ہوا» پڑھنے کے اعتبار سے معمول کی حالت ہے)۔
- `project_id` کی جانچ `^[a-zA-Z0-9._\-/]+$` سے ہوتی ہے (1–255 حروف)؛ نہ ملے تو `400 invalid_project_id`۔
- خالی منصوبے پر `GET peers` خالی صف لوٹاتا ہے۔ (منصوبہ، peer) کا تعلق facts/decisions کے PUT سے ضمناً بنتا ہے (اس مرحلے میں `POST peers` سے صریح اندراج نہیں)۔

### علمی ذخیرہ (RAG)

```
GET    /api/v1/knowledge-bases                                  # میرے علمی ذخیروں کی فہرست
POST   /api/v1/knowledge-bases                                  # نیا بنائیں
PATCH  /api/v1/knowledge-bases/{kb_id}                          # نام/تفصیل بدلیں، اور بیرونی Agent کے لیے کھلا ہے یا نہیں
DELETE /api/v1/knowledge-bases/{kb_id}                          # اس کے تمام دستاویزات اور سمتیوں سمیت مٹا دیں

GET    /api/v1/knowledge-bases/{kb_id}/documents                # صفحہ بندی: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart اپلوڈ، خانے کا نام file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # دوبارہ فہرست بند کریں
```

`POST /knowledge-bases` کا body `{ name, description? }` ہے (`name` 1–255 حروف)، جواب `201` + `{ knowledge_base }`۔

`PATCH /knowledge-bases/{kb_id}` کا body `{ name?, description?, shared_with_peers? }` ہے، جواب `{ knowledge_base }`۔ **`shared_with_peers` صرف یہیں بدلا جا سکتا ہے، بناتے وقت قبول نہیں ہوتا**: ہر ذخیرہ «صرف اپنے لیے» جنم لیتا ہے، اور اسے باہر کھولنا ایک دوسرا، جان بوجھ کر کیا گیا کام ہے۔

`shared_with_peers` یہ طے کرتا ہے کہ **اندر آیا A2A سوال اس ذخیرے میں تلاش کر سکتا ہے یا نہیں**، اور طے شدہ `false` ہے۔ مالک جب ویب پر بات کرتا ہے تو اس پر اثر نہیں پڑتا — وہ ہمیشہ سب کچھ تلاش کر سکتا ہے۔ یہ سرحد تلاش کے دائرے پر پڑنی چاہیے، پرامپٹ میں نہیں: سامنے والے کا سوال اور مالک کی ہدایات ماڈل تک ایک ہی طرح کے متن کے طور پر پہنچتے ہیں، سو «Agent خود فیصلہ کر لے گا کہ کیا بتانا ہے» کوئی سرحد ہے ہی نہیں۔ اسی سبب اندر آیا A2A سوال **کسی طویل مدتی یادداشت کو نہیں بلاتا** — طویل مدتی یادداشت مالک کی اپنی گفتگو سے کشید کی گئی ہے، اور اس کا ایک اندراج بھی اس انسٹنس سے باہر جانے کے قابل نشان زد نہیں۔

`GET /knowledge-bases` `{ knowledge_bases }` لوٹاتا ہے اور **صفحوں میں نہیں بٹتا**: ایک صارف کے ذخیرے ہاتھ سے بنتے ہیں، ان کی تعداد محدود ہے۔

`GET /{kb_id}/documents` `{ documents, total }` لوٹاتا ہے۔ `limit` کا طے شدہ 50، زیادہ سے زیادہ 100؛ `offset` کا طے شدہ 0؛ ترتیب `id` (ULID) کے نزولی حساب سے، یعنی تازہ ترین پہلے — واحد اور یقینی ترتیب ہی offset کی کھڑکی کو سطریں چھوڑنے یا دہرانے سے روکتی ہے۔ `total` پوری گنتی ہے، اس صفحے کی نہیں۔ نہ پڑھے جا سکنے والے `limit`/`offset` طے شدہ قدر لے لیتے ہیں۔ اس حصے کی یہی ایک فہرست ہے جو بے حد بڑھتی ہے، کیونکہ اپلوڈ کی منزل علمی ذخیرہ ہی ہے۔

اپلوڈ `multipart/form-data` سے ہوتا ہے، فائل کے خانے کا نام ہمیشہ `file` رہتا ہے، اور ایک فائل کی حد **10 MB** ہے (اس سے زیادہ پر `400 bad_request`)۔ `Content-Type` فارم میں آیا ہو تو وہی، نہ ہو تو ایکسٹینشن سے اخذ۔ جواب `201` + `{ document }`، اور تب تک `status` `processing` ہو چکا ہوتا ہے: **ٹکڑے کرنا، سمتی نمائندگی اور Qdrant میں لکھنا — یہ سب جواب کے بعد غیر ہم وقت چلتے ہیں**، اپلوڈ کا راستہ ان کا انتظار نہیں کرتا۔ سو کلائنٹ `status` بدلنے تک دستاویزات کی فہرست ٹٹولتا رہتا ہے۔

`status` کی قدریں:

| قدر | مفہوم |
|---|---|
| `processing` | محفوظ ہو چکا، ٹکڑے/سمتیں بن رہی ہیں۔ اپلوڈ اور retry کے بعد کی ابتدائی حالت |
| `ready` | تلاش کیا جا سکتا ہے۔ `chunk_count` اُس دستاویز کے ٹکڑوں کی تعداد ہے |
| `failed` | فہرست بندی ناکام (تجزیہ، embedding کلید کی کمی، یا سمتی ذخیرے میں لکھنے کی ناکامی) |

`POST /{doc_id}/retry` شے-ذخیرے سے اصل فائل لا کر دوبارہ فہرست بند کرتا ہے؛ پہلے اُس دستاویز کی موجود سمتیں مٹاتا ہے، سو ٹکڑے دُہرے نہیں ہوتے۔ اصل فائل باقی نہ رہی ہو (`storage_key` خالی) یا دستاویز اب بھی `processing` میں ہو تو `400` لوٹتا ہے۔ جواب `{ document }`، `status` پھر سے `processing` اور `chunk_count` صفر۔

علمی ذخیرہ مٹانے پر اس کی تمام دستاویز سطریں اور Qdrant کی سمتیں سلسلہ وار مٹ جاتی ہیں؛ اکیلی دستاویز مٹانے پر اس کی سمتیں اور شے-ذخیرے کی اصل فائل بھی صاف ہوتی ہے۔ سمتوں یا اشیا کی صفائی ناکام ہو تب بھی ڈیٹابیس سے حذف نہیں رکتا — یتیم شے چھوڑنا اُس سطر سے بہتر ہے جو مٹ چکے مواد کی طرف اشارہ کرے۔

تمام راستے `user.sub` تک محدود ہیں: کسی اور کا ذخیرہ یا دستاویز کھولنے پر `404` ملتا ہے (`403` نہیں، تاکہ اس کا وجود ہی ظاہر نہ ہو)۔

> ریورس پراکسی کو 10 MB کا body گزرنے دینا ہو گا۔ `infra/nginx.conf` میں `/api/` پر `client_max_body_size 10m` ہے؛ nginx کے طے شدہ 1 MB پر 1–10 MB کی فائلیں گیٹ وے تک پہنچتی ہی نہیں اور براؤزر کو nginx کا اپنا 413 صفحہ ملتا ہے۔

### منسلکات

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # ڈاؤن لوڈ (دستخط شدہ URL پر 302)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### راستہ

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

ہینڈ شیک کی توثیق REST جیسی ہی ہے، «دستخط ٹھیک ہے تو جانے دو» نہیں: `typ` `access` ہونا چاہیے، `sid` کسی ایسے سیشن کی طرف ہونا چاہیے جو اب بھی موجود ہو، اور کھاتہ `disabled` نہ ہو۔ تینوں لازم ہیں — ان کے بغیر ممنوع کھاتے کو بس اتنا چاہیے کہ اس کا ٹوکن نہ بیتا ہو، اور وہ جڑتا رہ کر پیغام پاتا رہے گا، جبکہ پابندی خود (تمام سیشن مٹانا) اس راستے پر کچھ بھی منسوخ نہیں کرتی۔ پابندی اُس صارف کے **پہلے سے کھلے socket بھی بند کرتی ہے**: nginx `/ws` کو ایک دن کا `proxy_read_timeout` دیتا ہے، اور اگلا ہینڈ شیک روکنے سے پہلے سے جڑا کنکشن نہیں رکتا۔

### پیغام کی صورت

تمام WS پیغام JSON ہیں اور ان میں `type` خانہ ہوتا ہے:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### کلائنٹ → سرور

```
ping                          // دھڑکن
subscribe.conversation        // کسی گفتگو کی رکنیت (سرور جانچتا ہے کہ آپ شریک ہیں)
unsubscribe.conversation
typing.start                  // صرف اُنہی گفتگوؤں پر اثر کرتا ہے جن کی رکنیت لی گئی ہو
typing.stop
read.ack                      // پڑھے جانے کی تصدیق
```

`typing.*` کی نشریات اُسی socket کی رکنیت کی فہرست کے مطابق ہوتی ہیں۔ جب رکنیت پر دروازہ ہو اور ٹائپنگ کے واقعات پر نہ ہو، تو کسی گفتگو کا id جان لینا ہی کافی ہے کہ اس میں «فلاں لکھ رہا ہے» ڈال دیا جائے — وہ بھی اپنے ہی صارف نام کے ساتھ۔

### سرور → کلائنٹ

```
pong
message.new                   // نیا پیغام
message.updated
message.deleted
typing.update                 // کون لکھ رہا ہے
presence.update               // رابطے کا آنا جانا
permission.request            // اجازت کی درخواست جس پر صارف کو فیصلہ کرنا ہے
agent.status                  // میرا Agent کیا کر رہا ہے («ABC کے Agent سے پوچھ رہا ہوں…»)
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
    "content": "0x03، یعنی Read Holding Registers سے…",
    "citations": [
      {
        "source": "X100 مواصلاتی دستی v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "ur",
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

**پے لوڈ میں `description` نہیں ہے، اور یہ جان بوجھ کر ہے۔** سرور نہیں جانتا کہ پڑھنے والا کس زبان میں پڑھتا ہے، سو وہ صرف ساختہ حقائق بھیجتا ہے (`action` + peer کی شناخت + محفوظ `scope`)، اور منظوری کے وقت نظر آنے والا جملہ کلائنٹ اپنی i18n سے بناتا ہے (`packages/client/src/lib/permission-text.ts`)۔ یہ معاہدہ `@confer/shared` کے `permissionRequestEventSchema` کا اپنا ہے: گیٹ وے بھیجنے سے پہلے اسی سے parse کرتا ہے، کلائنٹ پانے کے بعد اسی سے۔

`GET /api/v1/permissions/pending` کی ہر سطر بالکل اسی شکل کی ہے (ایک اضافی `decision` خانے کے ساتھ) اور اسی بنانے والے سے آتی ہے، سو ٹٹول کر ملی سطر اور socket سے آئی سطر بائٹ در بائٹ ایک جیسی ہوتی ہیں۔

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

واقعات کی اقسام:

```
event: token
data: {"text":"0x03، "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"X100 مواصلاتی دستی v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API (باہر کی طرف — Confer کے دوسرے انسٹنس اسے پکارتے ہیں)

تفصیل `docs/03-protocol.md` میں۔ یہاں صرف راستے گنائے گئے ہیں۔

ایک ہی سابقے کے نیچے دو بائنڈنگ ساتھ رہتی ہیں اور ایک ہی دروازوں کے سلسلے (`a2a/inbound.ts`) سے گزرتی ہیں؛ فرق صرف تار پر کی صورت کا ہے۔

**A2A کی معیاری HTTP+JSON بائنڈنگ** (راستے تفصیلات کی §11.3 سے بعینہٖ لیے گئے ہیں؛ Agent Card اسی کا اعلان کرتا ہے):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks(کرسر سے صفحہ بندی)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # غیر نافذ → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # غیر نافذ → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # غیر نافذ → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Confer کی اپنی بولی** (انسٹنسوں کے درمیان؛ `/.well-known/agents.json` سے دریافت ہوتی ہے):

```
POST   /a2a/v1/messages                  # بیرونی Agent کے پیغام لیتا ہے
GET    /a2a/v1/stream/{message_id}       # جواب رواں صورت میں کھینچتا ہے (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # عوامی AgentFacts
```

تمام A2A راستوں پر HTTP پیغام کے دستخط کی جانچ لازم ہے۔

## .well-known endpoints

```
GET    /.well-known/did.json                # بنیادی DID دستاویز
GET    /.well-known/agents.json             # اس انسٹنس کے تمام عوامی Agent کی فہرست
GET    /.well-known/agent-card.json         # A2A معیاری Agent Card (صرف جب انسٹنس پر ایک ہی عوامی Agent ہو)
GET    /.well-known/openid-configuration    # آگے چل کر: OIDC مطابقت (v2)
```

## A2A معیاری Agent Card (باہمی عمل کی دریافت پرت)

```
GET    /agents/{username}/agent-card.json   # اُس Agent کا A2A معیاری Card
GET    /.well-known/agent-card.json         # وہی، صرف جب اس انسٹنس پر ایک ہی عوامی Agent ہو
```

Linux Foundation کے **Agent2Agent v1.0** کے `AgentCard` کے مطابق (خانے `a2aproject/A2A` کی `specification/a2a.proto` @ v1.0.1 سے، proto3 کے JSON نقشے میں، اسی لیے camelCase)۔ مقصد یہ ہے کہ A2A کا نظام اس انسٹنس کے Agent کو **دریافت کر سکے** — نام تو ملتے تھے مگر پروٹوکول نہیں: سامنے والے کی دریافت دستاویز `/.well-known/agent-card.json` پر ہوتی ہے، جبکہ اس انسٹنس پر صرف `/.well-known/agents.json` تھا۔

چند جان بوجھ کر کیے گئے فیصلے:

- **ہر Agent کا اپنا Card**، جس میں `supportedInterfaces[].tenant` = صارف نام۔ تفصیلات کا well-known فرض کرتا ہے کہ ایک ڈومین پر ایک Agent ہے، جبکہ یہ انسٹنس کثیر کرایہ دار ہے؛ `tenant` ٹھیک وہی راہ گزینی کا انتخاب کنندہ ہے جسے تفصیلات نے «ایک ہی A2A راستے کے پیچھے کئی Agent» کے لیے متعین کیا۔ `/.well-known/agent-card.json` تبھی جواب دیتا ہے جب **ٹھیک ایک عوامی Agent** ہو (اکیلے خود میزبانی کرنے والے کی صورت)، ورنہ 404 دیتا ہے اور خرابی کے پیغام میں `agents.json` کی طرف اشارہ کرتا ہے — کسی بھی کھاتے کو اٹھا کر «اس ڈومین کا Agent» کہہ دینا غلط ہوتا۔
- **`streaming: false`**۔ رواں راستے واقعی موجود ہیں، مگر وہ Confer کی اپنی صورت کے ہیں، تفصیلات کے `SendStreamingMessage` کے نہیں۔ ایسی صلاحیت کا اعلان کرنا جسے معیاری کلائنٹ برت ہی نہ سکے، اعلان نہ کرنے سے بدتر ہے۔
- **`securitySchemes` کا اعلان نہیں ہوتا**۔ تفصیلات وہاں API کلید، HTTP توثیق، OAuth2، OIDC یا mTLS دیتی ہیں، اور یہ راستہ ان میں سے ایک بھی نہیں لیتا — اسے دستخط شدہ درخواست چاہیے۔ کوئی بھی ایک بھر دینا کلائنٹ سے یہ کہنے کے مترادف ہے کہ وہ ایسے طریقے سے توثیق کر سکتا ہے جو یقیناً مسترد ہو گا۔ اصل تقاضا **لازمی توسیع** کے طور پر بیان ہوتا ہے (`capabilities.extensions`، جس میں `uri` RFC 9421 کا پتہ ہے اور `required: true`) — تفصیلات نے اسی کام کے لیے یہ طریقہ رکھا ہے۔
- Card ایک **دریافت دستاویز** ہے اور اس کی نمائش بالکل `/.well-known/agents.json` جیسی ہے: غیر عوامی یا معطل Agent ہمیشہ 404 دیتا ہے، ورنہ یہ راستہ اُن کھاتوں کو گننے کا ذریعہ بن جاتا جنہیں مالک نے عام کرنے کا ارادہ ہی نہ کیا تھا۔

- **اعلان صرف ایک بائنڈنگ کا**۔ Confer کی اپنی بولی اسی URL کے نیچے رہتی ہے، مگر Card میں نہیں لکھی جاتی: §5.1 تقاضا کرتی ہے کہ کسی Agent کی اعلان کردہ ہر بائنڈنگ کارکردگی میں ہم پلہ ہو، اور بولی میں task کی زندگی کا چکر ہے ہی نہیں۔ وہ `/.well-known/agents.json` سے دریافت ہوتی ہے، اور یوں Card ایسا کوئی وعدہ نہیں کرتا جو نبھا نہ سکے۔

### پیغام پرت (Task کا مفہوم)

`POST /a2a/v1/message:send` تفصیلات کا `SendMessageRequest` لیتا ہے اور `Task` لوٹاتا ہے۔ **ایک task یعنی ایک اندر آیا سوال**: اس کا `id` اُسی پیغام کا id ہے، `contextId` وہ گفتگو ہے جس میں وہ محفوظ ہوتا ہے، اور حالت آگے پیش آنے والی باتوں سے نکلتی ہے — اُسی حقیقت کا سایہ رکھنے کے لیے الگ `tasks` جدول نہیں بنایا جاتا۔

Confer کا غیر ہم وقت + رضامندی کے دروازے والا ڈھانچہ تفصیلات کی حالت مشین پر ٹھیک بیٹھتا ہے:

| صورت | حالت |
|---|---|
| Agent جواب دے رہا ہے | `TASK_STATE_WORKING` |
| جواب مکمل | `TASK_STATE_COMPLETED` |
| یہ باری شروع ہی نہیں ہو سکتی (ماڈل ترتیب نہیں، یا فراہم کنندہ نے خرابی دی) | `TASK_STATE_FAILED` |
| `ask_user` پالیسی سے معلق، مالک کی منظوری کا انتظار | `TASK_STATE_AUTH_REQUIRED`(تعطل کی حالت، آخری نہیں) |
| مالک نے انکار کر دیا | `TASK_STATE_REJECTED` |

دو جگہ لوٹانے کو task ہے ہی **نہیں**، کیونکہ سطر بنی ہی نہیں: اجنبی peer (جو معلق کنکشن درخواست بن کر رہتا ہے) اور پالیسی سے براہِ راست انکار۔ دونوں `403 PERMISSION_DENIED` دیتے ہیں اور `ErrorInfo.metadata.confer_status` سے الگ پہچانے جاتے ہیں — ایسا task id گھڑ دینا جو اگلی پکار پر 404 دے، اس سے بدتر ہوتا۔

باقی رویہ تفصیلات سے نکتہ بہ نکتہ ملایا گیا ہے: خرابی کا جسم `google.rpc.Status` کی شکل کا ہے اور اس میں `ErrorInfo.reason` **ہمیشہ** ہوتا ہے (کئی A2A خرابیاں ایک ہی HTTP کوڈ بانٹتی ہیں، اور `reason` ہی واحد خانہ ہے جو انہیں الگ کرتا ہے)؛ جس کلائنٹ نے لازمی توسیع کا اعلان نہ کیا ہو اسے §3.3.4 کے مطابق `ExtensionSupportRequiredError` ملتا ہے، نہ کہ کچھ نہ سمجھانے والا 401؛ `historyLength=0` کا مطلب ہے **پورا خانہ ہی چھوڑ دینا**، خالی صف بھیجنا نہیں؛ اور `nextPageToken` ہمیشہ موجود رہتا ہے، اگلا صفحہ نہ ہو تو خالی سٹرنگ کے طور پر۔

دو جان بوجھ کر کیے گئے انحراف، دونوں کوڈ کے تبصروں میں درج ہیں: روکنے والے `message:send` کے انتظار کی **بالائی حد ہے** (55 سیکنڈ، اس کے بعد اب بھی `WORKING` والا task لوٹا کر کلائنٹ کو ٹٹولنے دیا جاتا ہے) — §3.2.2 وقت سے نکلنے کا راستہ نہیں دیتی، جبکہ LLM کی ایک پکار کی کوئی بالائی حد نہیں؛ اور `messageId` سے idempotency (§3.3.1 کا ایک MAY) **نہیں کی گئی**، کیونکہ کرایہ دار محفوظ منفرد کلید کو مالک کا دائرہ چاہیے، اور پہلے پیغام کی تار صورت میں وہ ملتا نہیں۔

## Webhooks (اختیاری، v1.5+)

بیرونی نظام واقعات کی رکنیت لے سکیں، اس کے لیے:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

معاون واقعات: `message.new.peer`، `permission.granted`، `thread.archived`۔

## شرحِ حد کی پالیسی

| راستہ | حد |
|---|---|
| `/api/v1/auth/login` | 10/منٹ فی IP |
| `/api/v1/auth/register` | 3/گھنٹہ فی IP |
| `/api/v1/conversations/*/messages` POST | 60/منٹ فی صارف |
| `/a2a/v1/*` | 100/منٹ فی peer ڈومین (سفید فہرست میں زیادہ) |
| WSS | فی صارف زیادہ سے زیادہ 10 بیک وقت کنکشن |

حد پار ہونے پر جواب:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## مشورہ API (صارف کی پہل پر باہر جاتا A2A)

صارف (یا اس کی جانب سے MCP سرور) **جو پہلے سے رابطہ ہو** ایسے peer Agent سے اپنی پہل پر سوال کر سکے اور بعد میں غیر ہم وقت جواب لے سکے۔ دستخط اور ترسیل پوری کی پوری گیٹ وے کے اندر ہوتی ہے؛ نجی کلید گیٹ وے سے باہر نہیں جاتی۔

> «گفتگو API» سے فرق: `/api/v1/conversations` + `/api/v1/stream` **اپنے ہی مقامی LLM معاون** سے بات کرنا ہے؛ `/api/v1/consult` وہ ہے جو A2A سے **کسی اور کے Agent** کو جاتا ہے۔

### POST `/api/v1/consult/:peerId`

`type='consult'` والی گفتگو شروع یا جاری کرتا ہے (ہر peer کے لیے وہی ایک گفتگو دوبارہ کام آتی ہے)، اور `message.type='question'` پر دستخط کر کے اسے پہنچاتا ہے۔

```jsonc
// درخواست کا body (consultRequestSchema)
{ "question": "کلیدیں کیسے گھمائی جائیں؟", "code_context": "…اختیاری کوڈ…", "language": "ur" }
```

| جواب | مفہوم |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | دستخط شدہ اور پہنچا دیا گیا |
| `502 { ..., status: "failed", error }` | ترسیل ناکام (peer آف لائن / راستہ نہیں / دستخط کا مسئلہ) |
| `403 not_a_contact` | peer موجودہ صارف کا رابطہ نہیں ہے |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

peer کے غیر ہم وقت جواب کے لیے طویل انتظار (جواب اندر آتے `/a2a/v1/messages` سے اپنے `thread_id` سمیت آتا ہے، اور گیٹ وے اسے اُسی دھاگے پر واپس ٹانک دیتا ہے)۔ `wait` کی حد 55 سیکنڈ۔

- `200 { status: "answered", message }` — جواب آ گیا
- `200 { status: "pending" }` — وقت گزر گیا مگر جواب نہیں؛ بعد میں پھر ٹٹولا جا سکتا ہے

### GET `/api/v1/consult/:conversationId`

اُس مشورہ دھاگے کی پوری پیغام تاریخ لوٹاتا ہے (زیادہ سے زیادہ 200)۔

> معاہدہ: اندر آتا A2A صرف `message.type==='question'` پر مقامی agent کا خودکار جواب چلاتا ہے؛ `answer`/`notification` صرف محفوظ اور نشر ہوتے ہیں، تاکہ مشورے کا جواب لامتناہی سوال جواب نہ چھیڑ دے۔
