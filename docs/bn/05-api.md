# Confer — API নির্দেশনা

ক্লায়েন্ট ↔ সার্ভার এবং সার্ভার ↔ A2A peer-এর সমস্ত API এখানে সংজ্ঞায়িত।

## সাধারণ রীতি

- Base URL: `https://{instance}/api`
- এনকোডিং: JSON, UTF-8
- সময়ের বিন্যাস: ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- ID: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- ত্রুটির বিন্যাস:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## প্রমাণীকরণ

- ব্যবহারকারীর ক্লায়েন্ট: `Authorization: Bearer <jwt_access_token>`
- access token-এর TTL: ১৫ মিনিট; refresh token-এর TTL: ৯০ দিন
- দুই টোকেন `typ` ক্লেইম দিয়ে আলাদা হয় (`access` / `refresh`) এবং **একটির জায়গায় অন্যটি চলে না**: `Authorization` হেডার কেবল `access` নেয়, আর `POST /auth/refresh` কেবল `refresh`। আগে এদের মধ্যে কেবল `exp`-এর তফাত ছিল, ফলে refresh token প্রমাণীকরণ লাগে এমন প্রতিটি প্রান্তবিন্দুতে ৯০ দিনের ছাড়পত্র হয়ে দাঁড়াত, আর access token-এর ১৫ মিনিটের কোনো মানেই থাকত না
- প্রতিবার refresh ঘোরে এবং `sessions.refresh_token_hash`-এর সঙ্গে মিলিয়ে দেখা হয়; না মিললে সেটিকে পুনর্ব্যবহার ধরে গোটা সেশন বাতিল করা হয়। `sessions.expires_at` হলো সেশনের **চূড়ান্ত** সীমা — ঘোরানো সেটিকে বাড়ায় না
- টোকেন ক্লায়েন্টের স্থানীয় স্টোরেজে থাকে, HTTP-only কুকিতে নয় (ক্লায়েন্ট একটি Tauri ডেস্কটপ অ্যাপ, যেখানে same-origin কুকির কোনো প্রতিরূপ নেই)

## ক্লায়েন্ট API (ব্যবহারকারীর ক্লায়েন্ট এটি ব্যবহার করে)

### প্রমাণীকরণ

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` অনুরোধ:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

উত্তর:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### ব্যবহারকারী ও Agent-এর বিন্যাস

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # প্রতিটি সরবরাহকারী বিন্যস্ত কি না (কেবল বুলিয়ান ফেরে, কখনও চাবি নয়)
PUT    /api/v1/agents/me/llm-keys      # LLM-এর API চাবি এনক্রিপ্ট করে রাখে
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # সরবরাহকারীকে সরাসরি জিজ্ঞেস করে তার কী কী মডেল আছে
```

`provider`-এর মান আসে `@confer/shared`-এর সরবরাহকারী-তালিকা থেকে (`packages/shared/src/llm/catalog.ts`), সঙ্গে টুল সেবা `tavily`। এই তালিকা গেটওয়ে, agent-runtime আর ক্লায়েন্ট — তিনেই পড়ে: base URL, মডেল-তালিকার পথ আর ডিফল্ট মডেল কেবল ওই এক জায়গাতেই লেখা, তাই নতুন সরবরাহকারী যোগ করা মানে শুধু তালিকাটি বদলানো।

`/models` সরবরাহকারীর নিজের মডেল-তালিকাই এগিয়ে দেয়; স্থানীয়ভাবে রাখা কোনো তালিকা কখনও ফেরায় না:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// খালি তালিকা সবসময় কারণ সঙ্গে আনে; চারটি আলাদা, আর প্রতিটির প্রতিকারও আলাদা
{ "models": [], "error": "no_key" }        // এই সরবরাহকারীর চাবি এখনও বিন্যস্ত হয়নি
{ "models": [], "error": "unauthorized" }  // সরবরাহকারী চাবিটি নাকচ করেছে (401/403)
{ "models": [], "error": "unreachable" }   // সরবরাহকারীর নাগাল মেলেনি, কিংবা সে অন্য ত্রুটি ফিরিয়েছে
{ "models": [], "error": "unsupported" }   // এই সরবরাহকারী মডেল-তালিকার প্রান্তবিন্দুই দেয় না
```

### পরিচিতজন / ভিন্ন Agent

```
GET    /api/v1/contacts                     # পরিচিতদের তালিকা। পৃষ্ঠাভাগ: ?limit=&offset=
POST   /api/v1/contacts                     # পরিচিত যোগ করুন
GET    /api/v1/contacts/{contact_id}        # একজন পরিচিতের বিবরণ (peer সহ)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # alias / tags / pinned / muted-এর আংশিক বদল (যে ক্ষেত্র পাঠানো হয়নি তা মোছে না)

POST   /api/v1/contacts/lookup              # DID / ডোমেইন / ব্যবহারকারী-নাম দিয়ে খোঁজ
```

`POST /api/v1/contacts/lookup` অনুরোধ:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` `{ contacts, total }` ফেরায়। `limit`-এর ডিফল্ট ৫০, সর্বোচ্চ ১০০; `offset`-এর ডিফল্ট ০; সাজানো হয় `id` (ULID) অনুসারে অবরোহী ক্রমে, অর্থাৎ নতুনটি আগে — ক্রম অনন্য ও নির্ধারিত হওয়াই সেই জিনিস যা offset-এর জানালাকে সারি বাদ দেওয়া বা দুবার দেখানো থেকে ঠেকায়। `total` গোটা গণনা, এই পৃষ্ঠার নয়, আর তা থেকেই ক্লায়েন্ট বোঝে শেষ এসে গেছে। যে `limit`/`offset` পড়া যায় না, তা ত্রুটি না দিয়ে ডিফল্ট মান নেয়।

উত্তর: পাওয়া সম্ভাব্য Agent-দের তালিকা। খোঁজ যেসব peer পায় সেগুলো **`peer_agents`-এ লিখে রাখে** এবং প্রতিটি প্রার্থীর সঙ্গে স্থানীয় `id` (`peer_id`) দেয় — `POST /api/v1/contacts` ওই `id` দিয়েই পরিচিত যোগ করে। `POST /contacts` idempotent: একই peer আবার যোগ করলে ত্রুটি নয়, আগে থেকেই থাকা পরিচিত (`200`) ফেরে।

> পরিচিত যোগ করা আসলে **গ্রহীতার সেই সম্মতি যে অন্যজন তার Agent খরচ করতে পারে**: পরিচিত হিসেবে যুক্ত peer-ই কেবল আমার Agent-কে উত্তর দেওয়াতে (এবং আমার LLM বাজেট খরচ করাতে) পারে। যুক্ত নয় এমন peer-এর A2A বার্তা অনুমোদনের অপেক্ষায় সংযোগের অনুরোধ হয়ে ঝুলে থাকে; দেখুন `03-protocol.md`-এর «সংযোগ সম্মতির দরজা»।

```
POST   /api/v1/contacts/{contact_id}/policies   # স্থায়ী নীতি ঠিক করুন (গোটাটাই প্রতিস্থাপন, PUT-এর মতো অর্থ)
```

`POST /contacts/{id}/policies`-এর body রানটাইম রূপে `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` এবং গোটাটাই `peer_contacts.policy_overrides_json`-এ লেখা হয়। **মিলনের অর্থ**: ভিতরে আসা A2A অনুরোধে সিদ্ধান্ত নেওয়ার সময় এই প্রতি-পরিচিত অগ্রাহ্য নীতি Agent-এর নীতির উপরে বসে — `contact.default` থাকলে তা Agent-এর ডিফল্টের জায়গা নেয়, আর `contact.rules` Agent-এর নিয়মের আগে বসে বলে আগেই মেলে (কোনো পরিচিতের সুনির্দিষ্ট নিয়ম Agent-এর সাধারণ নিয়মের উপরে যায়)। খালি অগ্রাহ্য `{}` অভেদ: সিদ্ধান্ত বাইটে বাইটে ঠিক তা-ই থাকে যা অগ্রাহ্য ছাড়া হতো।

### কথোপকথন

```
GET    /api/v1/conversations                       # আমার কথোপকথনের তালিকা (প্রথম পাতার জন্য)
POST   /api/v1/conversations                       # নতুন কথোপকথন
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # পৃষ্ঠাভাগ: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # বার্তা পাঠান
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # SSE দিয়ে LLM-এর উত্তর ধারা-আকারে নিন

POST   /api/v1/conversations/{id}/participants     # অংশগ্রহণকারী যোগ করুন
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # পঠিত চিহ্নিত করুন
```

`POST /api/v1/conversations/{id}/messages` অনুরোধ:

```json
{
  "content_type": "text",
  "content": "X100-এর 0x40 রেজিস্টারে কোন ফাংশন কোড লাগে?",
  "in_reply_to": null,
  "via": "web"
}
```

উত্তর:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### অনুমতি ব্যবস্থাপনা

```
GET    /api/v1/permissions/pending               # ঝুলে থাকা L2/L3 অনুরোধ
POST   /api/v1/permissions/{id}/decide           # অনুমোদন / নাকচ
GET    /api/v1/permissions/history               # ইতিহাস
```

`POST /api/v1/permissions/{id}/decide` অনুরোধ:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // সিদ্ধান্তের পরিধি
}
```

ঝুলে থাকা অনুরোধের মধ্যে যেগুলোর `action='connect'`, সেগুলো **সংযোগের অনুরোধ** (অচেনা peer প্রথমবার যোগাযোগ করলে A2A প্রবেশপথ এগুলো তৈরি করে)। অনুমোদন (`allow_*`) সেই peer-কে `peer_contacts`-এ লিখে সংযোগ গড়ে; নাকচ করলে গড়ে না।

যেগুলোর `action='ask'`, সেগুলো **আগে থেকেই যুক্ত peer-এর ঝুলে থাকা প্রশ্ন** — Agent-এর নীতি সেই প্রশ্নে `ask_user` স্থির করলে A2A প্রবেশপথ এগুলো তৈরি করে (দেখুন `03-protocol.md`-এর «ঝুলন্ত ইনবক্স (অনুপস্থিতিতে উত্তর)»)। অনুমোদন (`allow_*`) হলে Agent সেই ঝুলে থাকা প্রশ্নের উত্তর দেয়; নাকচ হলে দেয় না।

`GET /pending` প্রতিটি অনুরোধের সঙ্গে একটি `description` দেয় (সংযোগের অনুরোধে কে শুরু করেছে ও তার প্রথম বার্তা; প্রশ্নে কে জিজ্ঞেস করছে ও প্রশ্নের পাঠ) যাতে মালিক বিচার করতে পারেন।

### প্রকল্প-স্মৃতি (Claude Code সংযুক্তি সংক্রান্ত)

```
GET    /api/v1/projects/{project_id}/peers              # এই প্রকল্পে যেসব peer-এর স্মৃতি আছে (join থেকে name/did সহ)  ✅ বাস্তবায়িত
POST   /api/v1/projects/{project_id}/peers              # peer-কে প্রকল্পে স্পষ্টভাবে নিবন্ধন করুন   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ বাস্তবায়িত
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ বাস্তবায়িত
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ বাস্তবায়িত
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ বাস্তবায়িত
```

অর্থ সম্পর্কিত টীকা (v0.1):

- সব অনুসন্ধান `user.sub`-এ সীমাবদ্ধ (ব্যবহারকারীদের মধ্যে পৃথকীকরণ)।
- PUT-এর আগে যাচাই হয় peer সেই ব্যবহারকারীর পরিচিত কি না (`peer_contacts`); না হলে `403 not_a_contact` ফেরে।
- PUT upsert করে: প্রথম লেখায় `version=1`, পরের প্রতিবার `version` বাড়ে ও `updated_at` নতুন হয়। `facts` আর `decisions` স্বাধীন — একটি অংশ লিখলে অন্যটি মুছে যায় না।
- ওই (প্রকল্প, peer) জুটির স্মৃতি এখনও না থাকলে `GET facts/decisions` `200`, খালি স্ট্রিং আর `version:0` ফেরায় (404 নয়; «এই peer-এর এখনও কিছু জমেনি» পড়ার দিক থেকে স্বাভাবিক অবস্থা)।
- `project_id` যাচাই হয় `^[a-zA-Z0-9._\-/]+$` দিয়ে (১–২৫৫ অক্ষর); না মিললে `400 invalid_project_id`।
- খালি প্রকল্পে `GET peers` খালি অ্যারে ফেরায়। (প্রকল্প, peer) সম্পর্ক facts/decisions-এর PUT থেকে আপনা-আপনিই তৈরি হয় (এই পর্বে `POST peers` দিয়ে স্পষ্ট নিবন্ধন নেই)।

### জ্ঞানভাণ্ডার (RAG)

```
GET    /api/v1/knowledge-bases                                  # আমার জ্ঞানভাণ্ডারের তালিকা
POST   /api/v1/knowledge-bases                                  # নতুন তৈরি
PATCH  /api/v1/knowledge-bases/{kb_id}                          # নাম/বিবরণ বদলান, আর বাইরের Agent-এর জন্য খোলা কি না
DELETE /api/v1/knowledge-bases/{kb_id}                          # তার সব নথি ও ভেক্টর সহ মুছে ফেলুন

GET    /api/v1/knowledge-bases/{kb_id}/documents                # পৃষ্ঠাভাগ: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart আপলোড, ক্ষেত্রের নাম file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # আবার সূচিভুক্ত করুন
```

`POST /knowledge-bases`-এর body হলো `{ name, description? }` (`name` ১–২৫৫ অক্ষর), উত্তর `201` + `{ knowledge_base }`।

`PATCH /knowledge-bases/{kb_id}`-এর body হলো `{ name?, description?, shared_with_peers? }`, উত্তর `{ knowledge_base }`। **`shared_with_peers` কেবল এখানেই বদলানো যায়, তৈরির সময় গ্রাহ্য হয় না**: প্রতিটি ভাণ্ডার «কেবল নিজের জন্য» জন্মায়, আর বাইরে খোলা দ্বিতীয় একটি সচেতন কাজ।

`shared_with_peers` ঠিক করে **ভিতরে আসা A2A প্রশ্ন এই ভাণ্ডারে খুঁজতে পারবে কি না**, ডিফল্ট `false`। মালিক নিজে ওয়েবে কথা বললে এতে কিছু বদলায় না — তিনি সবসময় সবই খুঁজে পান। এই সীমারেখা খোঁজের পরিধিতে পড়তে হবে, প্রম্পটে নয়: অন্য পক্ষের প্রশ্ন আর মালিকের নির্দেশ মডেলের কাছে একই জাতের পাঠ হয়ে পৌঁছায়, তাই «Agent নিজেই বুঝে নেবে কী বলা যায়» কোনো সীমারেখাই নয়। একই কারণে ভিতরে আসা A2A প্রশ্ন **কোনো দীর্ঘমেয়াদি স্মৃতি ডাকে না** — দীর্ঘমেয়াদি স্মৃতি মালিকের নিজের কথোপকথন থেকে নিংড়ানো, আর তার একটি এন্ট্রিও এই ইনস্ট্যান্স ছেড়ে যাওয়ার যোগ্য বলে চিহ্নিত নয়।

`GET /knowledge-bases` `{ knowledge_bases }` ফেরায় এবং **পৃষ্ঠায় ভাগ হয় না**: একজন ব্যবহারকারীর ভাণ্ডার হাতে তৈরি, সংখ্যায় সীমিত।

`GET /{kb_id}/documents` `{ documents, total }` ফেরায়। `limit`-এর ডিফল্ট ৫০, সর্বোচ্চ ১০০; `offset`-এর ডিফল্ট ০; সাজানো `id` (ULID) অনুসারে অবরোহী ক্রমে, অর্থাৎ নতুনটি আগে — অনন্য ও নির্ধারিত ক্রমই offset-এর জানালাকে সারি বাদ দেওয়া বা দুবার দেখানো থেকে ঠেকায়। `total` গোটা গণনা, এই পৃষ্ঠার নয়। যে `limit`/`offset` পড়া যায় না তা ডিফল্ট নেয়। এই অংশে এটিই একমাত্র তালিকা যা অসীম বাড়ে, কারণ আপলোডের গন্তব্যই তো জ্ঞানভাণ্ডার।

আপলোড যায় `multipart/form-data`-য়, ফাইলের ক্ষেত্রের নাম সবসময় `file`, আর একটি ফাইলের সর্বোচ্চ **১০ MB** (তার বেশি হলে `400 bad_request`)। `Content-Type` ফর্মে থাকলে সেটিই, না থাকলে এক্সটেনশন থেকে অনুমান। উত্তর `201` + `{ document }`, আর তখনই `status` `processing` হয়ে গেছে: **টুকরো করা, ভেক্টর বানানো ও Qdrant-এ লেখা — সবই উত্তরের পরে অ্যাসিনক্রোনাসভাবে চলে**, আপলোড প্রান্তবিন্দু সেগুলোর অপেক্ষা করে না। তাই ক্লায়েন্ট `status` না বদলানো পর্যন্ত নথির তালিকা ঘেঁটে দেখে।

`status`-এর মান:

| মান | অর্থ |
|---|---|
| `processing` | সংরক্ষিত হয়ে গেছে, টুকরো/ভেক্টর হচ্ছে। আপলোড ও retry-এর পরের প্রাথমিক অবস্থা |
| `ready` | খোঁজা যায়। `chunk_count` ওই নথির টুকরোর সংখ্যা |
| `failed` | সূচিভুক্তি ব্যর্থ (পার্সিং, embedding চাবির অভাব, বা ভেক্টর-ভাণ্ডারে লেখা ব্যর্থ) |

`POST /{doc_id}/retry` বস্তু-ভাণ্ডার থেকে মূল ফাইল এনে আবার সূচিভুক্ত করে; আগে ওই নথির থাকা ভেক্টরগুলো মুছে দেয়, তাই টুকরো দুবার হয় না। মূল ফাইল আর না থাকলে (`storage_key` খালি) কিংবা নথি এখনও `processing`-এ থাকলে `400` ফেরে। উত্তর `{ document }`, `status` আবার `processing` আর `chunk_count` শূন্য।

জ্ঞানভাণ্ডার মুছলে তার সব নথি-সারি আর Qdrant-এর ভেক্টর ধারাবাহিকভাবে মুছে যায়; একটি নথি মুছলে তার ভেক্টর ও বস্তু-ভাণ্ডারের মূল ফাইলও পরিষ্কার হয়। ভেক্টর বা বস্তু-ভাণ্ডারের পরিষ্কার ব্যর্থ হলেও ডেটাবেসের মোছা আটকায় না — মুছে যাওয়া তথ্যের দিকে তাক করা সারির চেয়ে অনাথ বস্তু রেখে দেওয়া ভালো।

সব প্রান্তবিন্দু `user.sub`-এ সীমাবদ্ধ: অন্যের ভাণ্ডার বা নথিতে হাত দিলে `404` ফেরে (`403` নয়, যাতে অস্তিত্বই ফাঁস না হয়)।

> রিভার্স প্রক্সিকে ১০ MB body যেতে দিতে হবে। `infra/nginx.conf`-এ `/api/`-তে `client_max_body_size 10m` দেওয়া আছে; nginx-এর ডিফল্ট ১ MB-তে ১–১০ MB ফাইল গেটওয়ে পর্যন্ত পৌঁছায়ই না, আর ব্রাউজার পায় nginx-এর নিজের 413 পাতা।

### সংযুক্তি

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # ডাউনলোড (স্বাক্ষরিত URL-এ 302)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### প্রান্তবিন্দু

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

হ্যান্ডশেকের প্রমাণীকরণ REST-এর মতোই, «স্বাক্ষর মিলেছে তো ছেড়ে দাও» নয়: `typ` হতে হবে `access`, `sid` এমন একটি সেশনের দিকে হতে হবে যা এখনও আছে, আর অ্যাকাউন্ট `disabled` হতে পারবে না। তিনটিই অপরিহার্য — এগুলো ছাড়া নিষিদ্ধ অ্যাকাউন্টের কেবল টোকেন না ফুরালেই চলে, সে বারবার যুক্ত হয়ে বার্তা পেতে থাকবে, অথচ নিষেধাজ্ঞা নিজে (সব সেশন মুছে দেওয়া) এই পথে কিছুই বাতিল করে না। নিষেধাজ্ঞা ওই ব্যবহারকারীর **আগে থেকে খোলা socket-ও বন্ধ করে**: nginx `/ws`-কে এক দিনের `proxy_read_timeout` দেয়, আর পরের হ্যান্ডশেক আটকালে আগে জোড়া সংযোগ আটকায় না।

### বার্তার বিন্যাস

সব WS বার্তা JSON, আর তাতে `type` ক্ষেত্র থাকে:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### ক্লায়েন্ট → সার্ভার

```
ping                          // হৃৎস্পন্দন
subscribe.conversation        // কোনো কথোপকথনে সাবস্ক্রাইব (সার্ভার যাচাই করে আপনি অংশগ্রহণকারী কি না)
unsubscribe.conversation
typing.start                  // কেবল সাবস্ক্রাইব করা কথোপকথনেই কাজ করে
typing.stop
read.ack                      // পড়ার স্বীকৃতি
```

`typing.*`-এর সম্প্রচার ওই socket-এর সাবস্ক্রিপশনের সেট মেনে চলে। সাবস্ক্রিপশনে দরজা থাকলে অথচ টাইপিংয়ের ঘটনায় না থাকলে, কেবল একটি কথোপকথনের id জানাই যথেষ্ট — তাতে «অমুক লিখছে» ঢুকিয়ে দেওয়া যায়, নিজের ব্যবহারকারী-নাম সমেত।

### সার্ভার → ক্লায়েন্ট

```
pong
message.new                   // নতুন বার্তা
message.updated
message.deleted
typing.update                 // কে লিখছে
presence.update               // পরিচিতজনের আসা-যাওয়া
permission.request            // যে অনুমতির অনুরোধে ব্যবহারকারীকে সিদ্ধান্ত নিতে হবে
agent.status                  // আমার Agent কী করছে («ABC-র Agent-কে জিজ্ঞেস করছি…»)
conversation.updated
```

`message.new` উদাহরণ:

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
    "content": "0x03, Read Holding Registers দিয়ে…",
    "citations": [
      {
        "source": "X100 যোগাযোগ নির্দেশিকা v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "bn",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` উদাহরণ:

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

**পেলোডে `description` নেই, আর সেটি ইচ্ছাকৃত।** সার্ভার জানে না পাঠক কোন ভাষায় পড়েন, তাই সে কেবল কাঠামোবদ্ধ তথ্য পাঠায় (`action` + peer-এর পরিচয় + সংরক্ষিত `scope`), আর অনুমোদনের সময় যে বাক্যটি পড়া হয় তা ক্লায়েন্ট নিজের i18n দিয়ে গড়ে (`packages/client/src/lib/permission-text.ts`)। এই চুক্তিটি `@confer/shared`-এর `permissionRequestEventSchema`-র নিজস্ব: গেটওয়ে পাঠানোর আগে তা দিয়েই parse করে, ক্লায়েন্ট পাওয়ার পর তা দিয়েই।

`GET /api/v1/permissions/pending`-এর প্রতিটি সারির আকার হুবহু একই (বাড়তি একটি `decision` ক্ষেত্র সহ) এবং একই নির্মাতা থেকে আসে, তাই ঘেঁটে পাওয়া সারি আর socket-এ ঠেলে দেওয়া সারি বাইটে বাইটে মেলে।

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

ঘটনার ধরন:

```
event: token
data: {"text":"0x03, "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"X100 যোগাযোগ নির্দেশিকা v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API (বাইরের দিকে — Confer-এর অন্য ইনস্ট্যান্স এটি ডাকে)

বিস্তারিত `docs/03-protocol.md`-এ। এখানে কেবল প্রান্তবিন্দুগুলোর তালিকা।

একই উপসর্গের নিচে দুটি বাইন্ডিং পাশাপাশি থাকে আর একই দরজাগুলোর সেট (`a2a/inbound.ts`) দিয়েই যায়; তফাত কেবল তারের উপরের বিন্যাসে।

**A2A-র প্রমিত HTTP+JSON বাইন্ডিং** (পথগুলো নির্দেশনার §11.3 থেকে হুবহু নেওয়া; Agent Card এটিই ঘোষণা করে):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks(কার্সর দিয়ে পৃষ্ঠাভাগ)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # অবাস্তবায়িত → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # অবাস্তবায়িত → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # অবাস্তবায়িত → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Confer-এর নিজস্ব উপভাষা** (ইনস্ট্যান্সে-ইনস্ট্যান্সে; `/.well-known/agents.json` দিয়ে খুঁজে পাওয়া যায়):

```
POST   /a2a/v1/messages                  # বাইরের Agent-এর বার্তা নেয়
GET    /a2a/v1/stream/{message_id}       # উত্তর ধারা-আকারে টানে (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # প্রকাশ্য AgentFacts
```

সব A2A প্রান্তবিন্দুতে HTTP বার্তা-স্বাক্ষরের যাচাই বাধ্যতামূলক।

## .well-known endpoints

```
GET    /.well-known/did.json                # মূল DID নথি
GET    /.well-known/agents.json             # এই ইনস্ট্যান্সের সব প্রকাশ্য Agent-এর তালিকা
GET    /.well-known/agent-card.json         # A2A প্রমিত Agent Card (কেবল যখন ইনস্ট্যান্সে একটিই প্রকাশ্য Agent)
GET    /.well-known/openid-configuration    # ভবিষ্যতে: OIDC সঙ্গতি (v2)
```

## A2A প্রমিত Agent Card (আন্তঃক্রিয়াশীল আবিষ্কার-স্তর)

```
GET    /agents/{username}/agent-card.json   # ওই Agent-এর A2A প্রমিত Card
GET    /.well-known/agent-card.json         # একই, কেবল যখন এই ইনস্ট্যান্সে একটিই প্রকাশ্য Agent
```

Linux Foundation-এর **Agent2Agent v1.0**-এর `AgentCard` অনুসারে (ক্ষেত্রগুলো `a2aproject/A2A`-র `specification/a2a.proto` @ v1.0.1 থেকে, proto3-এর JSON মানচিত্রণে, তাই camelCase)। উদ্দেশ্য হলো A2A বাস্তুতন্ত্র যেন এই ইনস্ট্যান্সের Agent **খুঁজে পায়** — নাম মিলত কিন্তু প্রোটোকল মিলত না: অন্য পক্ষের আবিষ্কার-নথি থাকে `/.well-known/agent-card.json`-এ, অথচ এই ইনস্ট্যান্সে ছিল কেবল `/.well-known/agents.json`।

কয়েকটি সচেতন সিদ্ধান্ত:

- **প্রতি Agent-এ একটি Card**, যেখানে `supportedInterfaces[].tenant` = ব্যবহারকারী-নাম। নির্দেশনার well-known ধরে নেয় এক ডোমেইনে এক Agent, অথচ এই ইনস্ট্যান্স বহু-ভাড়াটে; «একই A2A প্রান্তবিন্দুর পিছনে একাধিক Agent»-এর জন্য নির্দেশনা যে রাউটিং নির্বাচক দিয়েছে, `tenant` ঠিক সেটাই। `/.well-known/agent-card.json` কেবল তখনই উত্তর দেয় যখন **ঠিক একটিই প্রকাশ্য Agent** থাকে (একা স্ব-হোস্ট করার ক্ষেত্র), নইলে 404 দেয় আর ত্রুটি-বার্তায় `agents.json`-এর দিকে দেখায় — যেকোনো একটি অ্যাকাউন্ট বেছে «এই ডোমেইনের Agent» বলা ভুল হতো।
- **`streaming: false`**। ধারা-আকারের প্রান্তবিন্দু সত্যিই আছে, তবে সেগুলো Confer-এর নিজস্ব আকারের, নির্দেশনার `SendStreamingMessage`-এর নয়। প্রমিত ক্লায়েন্ট ব্যবহার করতে পারবে না এমন সামর্থ্য ঘোষণা করা, না করার চেয়েও খারাপ।
- **`securitySchemes` ঘোষণা করা হয় না**। নির্দেশনা সেখানে দেয় API চাবি, HTTP auth, OAuth2, OIDC কিংবা mTLS — এই প্রান্তবিন্দু এদের একটিও নেয় না; তার চাই স্বাক্ষরিত অনুরোধ। যেকোনো একটি বসিয়ে দেওয়া মানে ক্লায়েন্টকে বলা যে সে এমন উপায়ে প্রমাণীকরণ করতে পারে যা নিশ্চিতভাবেই নাকচ হবে। আসল দাবিটি ঘোষিত হয় **আবশ্যিক এক্সটেনশন** হিসেবে (`capabilities.extensions`, যেখানে `uri` হলো RFC 9421-এর ঠিকানা আর `required: true`) — নির্দেশনা এই কাজের জন্যই এই কলটি রেখেছে।
- Card একটি **আবিষ্কার-নথি**, আর তার দৃশ্যমানতা হুবহু `/.well-known/agents.json`-এর মতো: অপ্রকাশ্য বা নিষ্ক্রিয় Agent সবসময় 404 দেয়, নইলে এই পথই হয়ে দাঁড়াত মালিক যেসব অ্যাকাউন্ট প্রকাশ করতে চাননি সেগুলো গুনে নেওয়ার উপায়।

- **ঘোষণা কেবল একটিই বাইন্ডিংয়ের।** Confer-এর নিজস্ব উপভাষা এই একই URL-এর নিচে থাকে, তবু Card-এ লেখা হয় না: §5.1 দাবি করে কোনো Agent যে বাইন্ডিংগুলো ঘোষণা করে তার প্রতিটি কার্যত সমতুল্য হোক, আর উপভাষায় task-এর জীবনচক্রই নেই। সেটি `/.well-known/agents.json` দিয়ে খুঁজে পাওয়া যায়, ফলে Card এমন কোনো কথা রাখে না যা সে রক্ষা করতে পারবে না।

### বার্তা-স্তর (Task-এর অর্থ)

`POST /a2a/v1/message:send` নির্দেশনার `SendMessageRequest` নেয় আর `Task` ফেরায়। **একটি task মানেই একটি ভিতরে আসা প্রশ্ন**: তার `id` সেই বার্তার id, `contextId` সেই কথোপকথন যেখানে সেটি জমা থাকে, আর অবস্থা পরে যা ঘটে তা থেকে বেরিয়ে আসে — একই ঘটনার ছায়া রাখতে আলাদা `tasks` টেবিল বানানো হয় না।

Confer-এর অ্যাসিনক্রোনাস + সম্মতির দরজা মডেলটি নির্দেশনার অবস্থা-যন্ত্রে ঠিকঠাক বসে যায়:

| পরিস্থিতি | অবস্থা |
|---|---|
| Agent উত্তর দিচ্ছে | `TASK_STATE_WORKING` |
| উত্তর শেষ | `TASK_STATE_COMPLETED` |
| এই পালাটা শুরুই হতে পারছে না (মডেল বিন্যস্ত নেই, কিংবা সরবরাহকারী ত্রুটি দিয়েছে) | `TASK_STATE_FAILED` |
| `ask_user` নীতিতে ঝুলে আছে, মালিকের অনুমোদনের অপেক্ষায় | `TASK_STATE_AUTH_REQUIRED`(বিঘ্নের অবস্থা, চূড়ান্ত নয়) |
| মালিক নাকচ করেছেন | `TASK_STATE_REJECTED` |

দুই জায়গায় ফেরানোর মতো task-ই **নেই**, কারণ সারিই তৈরি হয়নি: অচেনা peer (যা ঝুলন্ত সংযোগ-অনুরোধ হয়ে থাকে) আর নীতির সরাসরি নাকচ। দুটোই `403 PERMISSION_DENIED` ফেরায় এবং `ErrorInfo.metadata.confer_status` দিয়ে আলাদা হয় — এমন একটি task id বানিয়ে দেওয়া যা পরের ডাকেই 404 দেবে, তার চেয়ে এ ভালো।

বাকি আচরণ নির্দেশনার সঙ্গে বিন্দু ধরে ধরে মেলানো: ত্রুটির শরীর `google.rpc.Status`-এর আকারের আর তাতে `ErrorInfo.reason` **সবসময়** থাকে (একাধিক A2A ত্রুটি একই HTTP কোড ভাগ করে, আর `reason`-ই একমাত্র ক্ষেত্র যা তাদের আলাদা করে); যে ক্লায়েন্ট আবশ্যিক এক্সটেনশন ঘোষণা করেনি তাকে §3.3.4 অনুসারে `ExtensionSupportRequiredError` দেওয়া হয়, কিছুই ব্যাখ্যা করে না এমন 401 নয়; `historyLength=0` মানে **গোটা ক্ষেত্রটাই বাদ দেওয়া**, খালি অ্যারে পাঠানো নয়; আর `nextPageToken` সবসময় থাকে, পরের পাতা না থাকলে খালি স্ট্রিং হয়ে।

দুটি সচেতন বিচ্যুতি, দুটোই কোডের মন্তব্যে লেখা: অবরোধক `message:send`-এর অপেক্ষার **উপরের সীমা আছে** (৫৫ সেকেন্ড, তারপর এখনও `WORKING` অবস্থার task ফিরিয়ে ক্লায়েন্টকে ঘেঁটে দেখতে দেওয়া হয়) — §3.2.2 সময়ের বেরোনোর পথ দেয় না, অথচ LLM-এর একটি ডাকের কোনো ঊর্ধ্বসীমা নেই; আর `messageId` দিয়ে idempotency (§3.3.1-এর একটি MAY) **করা হয়নি**, কারণ ভাড়াটে-নিরাপদ অনন্য চাবির জন্য মালিকের পরিধি দরকার, আর প্রথম বার্তার তার-বিন্যাসে তা মেলে না।

## Webhooks (ঐচ্ছিক, v1.5+)

বাইরের তন্ত্র যাতে ঘটনায় সাবস্ক্রাইব করতে পারে:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

সমর্থিত ঘটনা: `message.new.peer`, `permission.granted`, `thread.archived`।

## হার-সীমার নীতি

| পথ | সীমা |
|---|---|
| `/api/v1/auth/login` | ১০/মিনিট প্রতি IP |
| `/api/v1/auth/register` | ৩/ঘণ্টা প্রতি IP |
| `/api/v1/conversations/*/messages` POST | ৬০/মিনিট প্রতি ব্যবহারকারী |
| `/a2a/v1/*` | ১০০/মিনিট প্রতি peer ডোমেইন (শ্বেততালিকায় বেশি) |
| WSS | প্রতি ব্যবহারকারীতে সর্বোচ্চ ১০টি যুগপৎ সংযোগ |

সীমা ছাড়ালে উত্তর:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## পরামর্শ API (ব্যবহারকারীর উদ্যোগে বাইরে যাওয়া A2A)

ব্যবহারকারী (কিংবা তাঁর হয়ে MCP সার্ভার) যেন **আগে থেকেই পরিচিত** কোনো peer Agent-কে নিজের উদ্যোগে প্রশ্ন করতে এবং পরে অ্যাসিনক্রোনাস উত্তর নিতে পারেন। স্বাক্ষর ও পৌঁছে দেওয়া পুরোটাই গেটওয়ের ভিতরে হয়; ব্যক্তিগত চাবি গেটওয়ে ছাড়ে না।

> «কথোপকথন API»-র সঙ্গে তফাত: `/api/v1/conversations` + `/api/v1/stream` হলো **নিজের স্থানীয় LLM সহকারীর** সঙ্গে কথা বলা; `/api/v1/consult` হলো যা A2A দিয়ে **অন্যের Agent**-এর কাছে যায়।

### POST `/api/v1/consult/:peerId`

`type='consult'` কথোপকথন শুরু করে বা চালিয়ে যায় (প্রতি peer-এ সেই একই কথোপকথন কাজে লাগে), আর `message.type='question'`-এ স্বাক্ষর করে তা পৌঁছে দেয়।

```jsonc
// অনুরোধের body (consultRequestSchema)
{ "question": "চাবি কীভাবে ঘোরাব?", "code_context": "…ঐচ্ছিক কোড…", "language": "bn" }
```

| উত্তর | অর্থ |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | স্বাক্ষরিত ও পৌঁছে দেওয়া হয়েছে |
| `502 { ..., status: "failed", error }` | পৌঁছে দেওয়া ব্যর্থ (peer অফলাইন / endpoint নেই / স্বাক্ষরের সমস্যা) |
| `403 not_a_contact` | peer বর্তমান ব্যবহারকারীর পরিচিত নয় |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

peer-এর অ্যাসিনক্রোনাস উত্তরের জন্য দীর্ঘ অপেক্ষা (উত্তর ভিতরে আসা `/a2a/v1/messages` দিয়ে তার `thread_id` সমেত আসে, আর গেটওয়ে সেটিকে ঠিক সুতোয় ফিরিয়ে ঝোলায়)। `wait`-এর সীমা ৫৫ সেকেন্ড।

- `200 { status: "answered", message }` — উত্তর এসেছে
- `200 { status: "pending" }` — সময় ফুরিয়েছে, উত্তর নেই; পরে আবার ঘেঁটে দেখা যায়

### GET `/api/v1/consult/:conversationId`

ওই পরামর্শ-সুতোর পুরো বার্তা-ইতিহাস ফেরায় (সর্বোচ্চ ২০০টি)।

> চুক্তি: ভিতরে আসা A2A কেবল `message.type==='question'`-এ স্থানীয় agent-এর স্বয়ংক্রিয় উত্তর চালু করে; `answer`/`notification` কেবল জমা হয় ও সম্প্রচারিত হয়, যাতে পরামর্শের উত্তর অনন্ত প্রশ্নোত্তর শুরু করে না দেয়।
