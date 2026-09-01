# Confer — API विनिर्देश

क्लाइंट ↔ सर्वर और सर्वर ↔ A2A peer के बीच की सारी API यहाँ परिभाषित हैं।

## सामान्य नियम

- Base URL: `https://{instance}/api`
- एन्कोडिंग: JSON, UTF-8
- समय का प्रारूप: ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- ID: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- त्रुटि का प्रारूप:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## प्रमाणीकरण

- उपयोगकर्ता क्लाइंट: `Authorization: Bearer <jwt_access_token>`
- access token का TTL: 15 मिनट; refresh token का TTL: 90 दिन
- दोनों टोकन `typ` क्लेम से अलग होते हैं (`access` / `refresh`) और **आपस में बदले नहीं जा सकते**: `Authorization` हेडर केवल `access` लेता है और `POST /auth/refresh` केवल `refresh`। पहले इनमें सिर्फ़ `exp` का फ़र्क़ था, इसलिए refresh token हर प्रमाणित endpoint पर 90 दिन का पास बन जाता था और access token के 15 मिनट का कोई अर्थ नहीं रह जाता था
- हर बार refresh घूमता है और `sessions.refresh_token_hash` से मिलाया जाता है; मेल न खाने पर उसे दोबारा इस्तेमाल माना जाता है और पूरा session रद्द हो जाता है। `sessions.expires_at` session की **निरपेक्ष** सीमा है — घुमाव उसे आगे नहीं बढ़ाता
- टोकन क्लाइंट के स्थानीय स्टोरेज में रहते हैं, HTTP-only कुकी में नहीं (क्लाइंट एक Tauri डेस्कटॉप ऐप है, जहाँ same-origin कुकी जैसा कुछ है ही नहीं)

## क्लाइंट API (उपयोगकर्ता क्लाइंट इसे इस्तेमाल करता है)

### प्रमाणीकरण

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` अनुरोध:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

प्रतिक्रिया:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### उपयोगकर्ता और Agent का विन्यास

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # हर प्रदाता कॉन्फ़िगर है या नहीं (सिर्फ़ बूलियन लौटाता है, कुंजी कभी नहीं)
PUT    /api/v1/agents/me/llm-keys      # LLM की API कुंजियाँ एन्क्रिप्ट करके रखता है
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # प्रदाता से सीधे पूछता है कि उसके पास कौन-से मॉडल हैं
```

`provider` के मान `@confer/shared` की प्रदाता-सूची से आते हैं (`packages/shared/src/llm/catalog.ts`), और साथ में टूल सेवा `tavily`। यह सूची गेटवे, agent-runtime और क्लाइंट — तीनों पढ़ते हैं: base URL, मॉडल-सूची का पथ और डिफ़ॉल्ट मॉडल सिर्फ़ उसी एक जगह लिखे हैं, इसलिए नया प्रदाता जोड़ना मतलब सिर्फ़ सूची बदलना।

`/models` प्रदाता की अपनी मॉडल-सूची आगे बढ़ा देता है; स्थानीय रूप से रखी कोई सूची कभी नहीं लौटाता:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// खाली सूची हमेशा अपना कारण साथ लाती है; चारों अलग हैं और हरेक का उपाय भी अलग
{ "models": [], "error": "no_key" }        // इस प्रदाता की कुंजी अभी कॉन्फ़िगर नहीं हुई
{ "models": [], "error": "unauthorized" }  // प्रदाता ने कुंजी अस्वीकार कर दी (401/403)
{ "models": [], "error": "unreachable" }   // प्रदाता तक पहुँच नहीं बनी, या उसने कोई और त्रुटि लौटाई
{ "models": [], "error": "unsupported" }   // यह प्रदाता मॉडल-सूची का endpoint देता ही नहीं
```

### संपर्क / दूसरे Agent

```
GET    /api/v1/contacts                     # संपर्कों की सूची। पृष्ठ-विभाजन: ?limit=&offset=
POST   /api/v1/contacts                     # संपर्क जोड़ें
GET    /api/v1/contacts/{contact_id}        # एक संपर्क का विवरण (peer सहित)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # alias / tags / pinned / muted में आंशिक बदलाव (जो फ़ील्ड न भेजे जाएँ वे मिटते नहीं)

POST   /api/v1/contacts/lookup              # DID / डोमेन / उपयोगकर्ता-नाम से खोजें
```

`POST /api/v1/contacts/lookup` अनुरोध:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` `{ contacts, total }` लौटाता है। `limit` का डिफ़ॉल्ट 50 है और अधिकतम 100, `offset` का डिफ़ॉल्ट 0; क्रम `id` (ULID) के अवरोही पर है, यानी सबसे नया पहले — क्रम का अनन्य और निश्चित होना ही वह चीज़ है जिससे offset की खिड़की न पंक्तियाँ छोड़ती है, न दोहराती है। `total` पूरी गिनती है, इस पृष्ठ की नहीं, और उसी से क्लाइंट जानता है कि अंत आ गया। जो `limit`/`offset` पढ़े न जा सकें, वे त्रुटि नहीं देते बल्कि डिफ़ॉल्ट मान ले लेते हैं।

प्रतिक्रिया: मिले हुए संभावित Agent की सूची। खोज जिन peer को पाती है उन्हें **`peer_agents` में लिख देती है** और हर उम्मीदवार के साथ स्थानीय `id` (`peer_id`) भी देती है — `POST /api/v1/contacts` उसी `id` से संपर्क जोड़ता है। `POST /contacts` idempotent है: वही peer दोबारा जोड़ने पर त्रुटि नहीं, पहले से मौजूद संपर्क (`200`) लौटता है।

> संपर्क जोड़ना दरअसल **प्राप्तकर्ता की वह सहमति है कि सामने वाला उसके Agent को खर्च कर सकता है**: सिर्फ़ वही peer मेरे Agent से जवाब दिलवा सकता है (और मेरा LLM बजट खर्च कर सकता है) जो संपर्क के रूप में जुड़ा हो। बिना जुड़े peer के A2A संदेश अनुमोदन की प्रतीक्षा में कनेक्शन अनुरोध बनकर टँगे रहते हैं; देखें `03-protocol.md` का «कनेक्शन सहमति का द्वार»।

```
POST   /api/v1/contacts/{contact_id}/policies   # स्थायी नीतियाँ तय करें (पूरा प्रतिस्थापन, PUT जैसा अर्थ)
```

`POST /contacts/{id}/policies` का body रनटाइम रूप में `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` होता है और पूरा का पूरा `peer_contacts.policy_overrides_json` में लिखा जाता है। **विलय का अर्थ**: भीतर आते A2A अनुरोध पर निर्णय लेते समय यह प्रति-संपर्क अधिभावी नीति Agent की नीति के ऊपर चढ़ती है — `contact.default` मौजूद हो तो वह Agent के डिफ़ॉल्ट की जगह लेता है, और `contact.rules` Agent के नियमों से पहले आते हैं इसलिए पहले लगते हैं (किसी संपर्क का सटीक नियम Agent के सामान्य नियम पर भारी पड़ता है)। खाली अधिभावी `{}` तत्समक है: निर्णय बाइट-दर-बाइट वही रहता है जो बिना अधिभावी के होता।

### बातचीत

```
GET    /api/v1/conversations                       # मेरी बातचीतों की सूची (मुखपृष्ठ के लिए)
POST   /api/v1/conversations                       # नई बातचीत बनाएँ
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # पृष्ठ-विभाजन: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # संदेश भेजें
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # SSE से LLM का उत्तर धारा-रूप में लें

POST   /api/v1/conversations/{id}/participants     # भागीदार जोड़ें
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # पढ़ा हुआ चिह्नित करें
```

`POST /api/v1/conversations/{id}/messages` अनुरोध:

```json
{
  "content_type": "text",
  "content": "X100 के रजिस्टर 0x40 के लिए कौन-सा फ़ंक्शन कोड लगता है?",
  "in_reply_to": null,
  "via": "web"
}
```

प्रतिक्रिया:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### अनुमति प्रबंधन

```
GET    /api/v1/permissions/pending               # लंबित L2/L3 अनुरोध
POST   /api/v1/permissions/{id}/decide           # स्वीकृत / अस्वीकृत करें
GET    /api/v1/permissions/history               # इतिहास
```

`POST /api/v1/permissions/{id}/decide` अनुरोध:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // निर्णय का दायरा
}
```

लंबित अनुरोधों में जिनका `action='connect'` है वे **कनेक्शन अनुरोध** हैं (अजनबी peer के पहले संपर्क पर A2A प्रवेश-पथ इन्हें बनाता है)। स्वीकृति (`allow_*`) उस peer को `peer_contacts` में लिखकर कनेक्शन बना देती है; अस्वीकृति नहीं बनाती।

जिनका `action='ask'` है वे **पहले से जुड़े peer के लंबित प्रश्न** हैं — जब Agent की नीति उस प्रश्न पर `ask_user` तय करती है तब A2A प्रवेश-पथ इन्हें बनाता है (देखें `03-protocol.md` का «लंबित इनबॉक्स (अनुपस्थिति में उत्तर)»)। स्वीकृति (`allow_*`) पर Agent उस टँगे प्रश्न का उत्तर देता है; अस्वीकृति पर नहीं देता।

`GET /pending` हर अनुरोध के साथ एक `description` देता है (कनेक्शन अनुरोध में पहल करने वाला और उसका पहला संदेश; प्रश्न में पूछने वाला और प्रश्न का पाठ) ताकि मालिक निर्णय ले सके।

### परियोजना स्मृति (Claude Code एकीकरण से संबंधित)

```
GET    /api/v1/projects/{project_id}/peers              # इस परियोजना में जिन peer की स्मृति है (join से name/did सहित)  ✅ लागू
POST   /api/v1/projects/{project_id}/peers              # peer को परियोजना में स्पष्ट रूप से पंजीकृत करें   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ लागू
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ लागू
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ लागू
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ लागू
```

अर्थ-संबंधी टिप्पणियाँ (v0.1):

- सारी क्वेरी `user.sub` तक सीमित हैं (उपयोगकर्ताओं के बीच पृथक्करण)।
- PUT से पहले जाँचा जाता है कि peer उस उपयोगकर्ता का संपर्क है (`peer_contacts`); न हो तो `403 not_a_contact` लौटता है।
- PUT upsert करता है: पहली लिखाई पर `version=1`, हर अगली पर `version` बढ़ता है और `updated_at` ताज़ा होता है। `facts` और `decisions` स्वतंत्र हैं — एक खंड लिखने से दूसरा नहीं मिटता।
- जब उस (परियोजना, peer) जोड़े की कोई स्मृति नहीं होती तो `GET facts/decisions` `200`, खाली स्ट्रिंग और `version:0` लौटाता है (404 नहीं; «इस peer का अभी कुछ जमा नहीं हुआ» पढ़ने के लिहाज़ से सामान्य स्थिति है)।
- `project_id` की जाँच `^[a-zA-Z0-9._\-/]+$` से होती है (1–255 अक्षर); न मिलने पर `400 invalid_project_id`।
- खाली परियोजना पर `GET peers` खाली सरणी लौटाता है। (परियोजना, peer) का संबंध facts/decisions के PUT से अंतर्निहित रूप से बनता है (इस चरण में `POST peers` से स्पष्ट पंजीकरण नहीं है)।

### ज्ञान-कोश (RAG)

```
GET    /api/v1/knowledge-bases                                  # मेरे ज्ञान-कोशों की सूची
POST   /api/v1/knowledge-bases                                  # नया बनाएँ
PATCH  /api/v1/knowledge-bases/{kb_id}                          # नाम/विवरण बदलें, और बाहरी Agent के लिए खुला है या नहीं
DELETE /api/v1/knowledge-bases/{kb_id}                          # उसके सारे दस्तावेज़ों और सदिशों समेत मिटाएँ

GET    /api/v1/knowledge-bases/{kb_id}/documents                # पृष्ठ-विभाजन: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart अपलोड, फ़ील्ड का नाम file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # दोबारा अनुक्रमित करें
```

`POST /knowledge-bases` का body `{ name, description? }` है (`name` 1–255 अक्षर) और उत्तर `201` + `{ knowledge_base }`।

`PATCH /knowledge-bases/{kb_id}` का body `{ name?, description?, shared_with_peers? }` है और उत्तर `{ knowledge_base }`। **`shared_with_peers` सिर्फ़ यहीं बदला जा सकता है, बनाते समय स्वीकार नहीं होता**: हर कोश «सिर्फ़ अपने लिए» जन्म लेता है, और उसे बाहर खोलना एक दूसरा, जान-बूझकर किया गया काम है।

`shared_with_peers` यह तय करता है कि **भीतर आया A2A प्रश्न इस कोश में खोज सकता है या नहीं**, और डिफ़ॉल्ट `false` है। मालिक जब वेब पर बात करता है तब उस पर इसका असर नहीं — वह हमेशा सब कुछ खोज सकता है। यह सीमा खोज के दायरे पर पड़नी चाहिए, प्रॉम्प्ट में नहीं: सामने वाले का प्रश्न और मालिक के निर्देश मॉडल तक एक ही तरह के पाठ के रूप में पहुँचते हैं, इसलिए «Agent खुद तय कर लेगा कि क्या बताना है» कोई सीमा है ही नहीं। इसी कारण भीतर आया A2A प्रश्न **किसी दीर्घकालिक स्मृति को नहीं बुलाता** — दीर्घकालिक स्मृति मालिक की अपनी बातचीत से निचोड़ी गई है, और उसकी एक भी प्रविष्टि इस इंस्टेंस से बाहर जाने योग्य चिह्नित नहीं है।

`GET /knowledge-bases` `{ knowledge_bases }` लौटाता है और **पृष्ठों में नहीं बँटता**: एक उपयोगकर्ता के कोश हाथ से बनते हैं, उनकी संख्या सीमित है।

`GET /{kb_id}/documents` `{ documents, total }` लौटाता है। `limit` का डिफ़ॉल्ट 50, अधिकतम 100; `offset` का डिफ़ॉल्ट 0; क्रम `id` (ULID) के अवरोही पर, यानी सबसे नया पहले — अनन्य और निश्चित क्रम ही offset की खिड़की को पंक्तियाँ छोड़ने या दोहराने से रोकता है। `total` पूरी गिनती है, इस पृष्ठ की नहीं। न पढ़े जा सकने वाले `limit`/`offset` डिफ़ॉल्ट ले लेते हैं। इस खंड की यही एक सूची है जो असीम बढ़ती है, क्योंकि अपलोड का ठिकाना ज्ञान-कोश ही है।

अपलोड `multipart/form-data` से होता है, फ़ाइल फ़ील्ड का नाम हमेशा `file` रहता है, और एक फ़ाइल की सीमा **10 MB** है (अधिक होने पर `400 bad_request`)। `Content-Type` फ़ॉर्म में आया हो तो वही, न हो तो एक्सटेंशन से अनुमानित। उत्तर `201` + `{ document }`, और तब तक `status` `processing` हो चुका होता है: **टुकड़े करना, सदिश बनाना और Qdrant में लिखना — ये सब उत्तर के बाद अतुल्यकालिक चलते हैं**, अपलोड endpoint उनका इंतज़ार नहीं करता। इसलिए क्लाइंट `status` बदलने तक दस्तावेज़-सूची को टटोलता रहता है।

`status` के मान:

| मान | अर्थ |
|---|---|
| `processing` | भंडारित हो चुका, टुकड़े/सदिश बन रहे हैं। अपलोड और retry के बाद की आरंभिक स्थिति |
| `ready` | खोजा जा सकता है। `chunk_count` उस दस्तावेज़ के टुकड़ों की संख्या है |
| `failed` | अनुक्रमण विफल (पार्सिंग, embedding कुंजी की कमी, या सदिश-भंडार में लिखने की विफलता) |

`POST /{doc_id}/retry` वस्तु-भंडार से मूल फ़ाइल लाकर दोबारा अनुक्रमित करता है; पहले उस दस्तावेज़ के मौजूदा सदिश मिटाता है, इसलिए टुकड़े दोहरे नहीं होते। मूल फ़ाइल न बची हो (`storage_key` खाली) या दस्तावेज़ अब भी `processing` में हो तो `400` लौटता है। उत्तर `{ document }`, `status` फिर से `processing` और `chunk_count` शून्य।

ज्ञान-कोश मिटाने पर उसकी सारी दस्तावेज़-पंक्तियाँ और Qdrant के सदिश शृंखलाबद्ध रूप से मिट जाते हैं; अकेला दस्तावेज़ मिटाने पर उसके सदिश और वस्तु-भंडार की मूल फ़ाइल भी साफ़ होती है। सदिश या वस्तु-भंडार की सफ़ाई विफल हो तो भी डेटाबेस से मिटाना नहीं रुकता — अनाथ वस्तु छोड़ना उस पंक्ति से बेहतर है जो मिट चुके डेटा की ओर इशारा करती हो।

सारे endpoint `user.sub` तक सीमित हैं: किसी और का कोश या दस्तावेज़ खोलने पर `404` मिलता है (`403` नहीं, ताकि उसका अस्तित्व ही ज़ाहिर न हो)।

> रिवर्स प्रॉक्सी को 10 MB का body जाने देना होगा। `infra/nginx.conf` में `/api/` पर `client_max_body_size 10m` है; nginx के डिफ़ॉल्ट 1 MB पर 1–10 MB की फ़ाइलें गेटवे तक पहुँचती ही नहीं और ब्राउज़र को nginx का अपना 413 पृष्ठ मिलता है।

### संलग्नक

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # डाउनलोड (हस्ताक्षरित URL पर 302)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### Endpoint

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

हैंडशेक का प्रमाणीकरण REST जैसा ही है, «हस्ताक्षर ठीक है तो जाने दो» नहीं: `typ` `access` होना चाहिए, `sid` किसी अब भी मौजूद session की ओर होना चाहिए, और खाता `disabled` नहीं होना चाहिए। तीनों ज़रूरी हैं — इनके बिना प्रतिबंधित खाते को बस इतना चाहिए कि उसका टोकन न बीता हो, और वह जुड़ता रहकर संदेश पाता रहेगा, जबकि प्रतिबंध स्वयं (सारे session मिटाना) इस रास्ते पर कुछ भी रद्द नहीं करता। प्रतिबंध उस उपयोगकर्ता के **पहले से खुले socket भी बंद करता है**: nginx `/ws` को एक दिन का `proxy_read_timeout` देता है, और अगला हैंडशेक रोकने से पहले से जुड़ा कनेक्शन नहीं रुकता।

### संदेश का प्रारूप

सारे WS संदेश JSON हैं और उनमें `type` फ़ील्ड होता है:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### क्लाइंट → सर्वर

```
ping                          // धड़कन
subscribe.conversation        // किसी बातचीत की सदस्यता (सर्वर जाँचता है कि आप भागीदार हैं)
unsubscribe.conversation
typing.start                  // सिर्फ़ उन्हीं बातचीतों पर असर करता है जिनकी सदस्यता ली गई है
typing.stop
read.ack                      // पढ़े जाने की पुष्टि
```

`typing.*` का प्रसारण उसी socket की सदस्यता-सूची से तय होता है। जब सदस्यता पर द्वार हो और टाइपिंग की घटनाओं पर न हो, तो किसी बातचीत का id जान लेना ही काफ़ी है कि उसमें «फ़लाँ लिख रहा है» डाल दिया जाए — वह भी अपने ही उपयोगकर्ता-नाम के साथ।

### सर्वर → क्लाइंट

```
pong
message.new                   // नया संदेश
message.updated
message.deleted
typing.update                 // कौन लिख रहा है
presence.update               // संपर्क का आना-जाना
permission.request            // अनुमति का अनुरोध जिस पर उपयोगकर्ता को निर्णय लेना है
agent.status                  // मेरा Agent क्या कर रहा है («ABC के Agent से पूछ रहा हूँ…»)
conversation.updated
```

`message.new` उदाहरण:

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
    "content": "0x03, Read Holding Registers से…",
    "citations": [
      {
        "source": "X100 संचार पुस्तिका v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "hi",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` उदाहरण:

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

**पेलोड में `description` नहीं है, और यह जान-बूझकर है।** सर्वर नहीं जानता कि पढ़ने वाला किस भाषा में पढ़ता है, इसलिए वह केवल संरचित तथ्य भेजता है (`action` + peer की पहचान + संचित `scope`), और अनुमोदन के समय दिखने वाला वाक्य क्लाइंट अपनी i18n से बनाता है (`packages/client/src/lib/permission-text.ts`)। यह अनुबंध `@confer/shared` के `permissionRequestEventSchema` का अपना है: गेटवे भेजने से पहले उसी से parse करता है, क्लाइंट पाने के बाद उसी से।

`GET /api/v1/permissions/pending` की हर पंक्ति उसी आकार की है (एक अतिरिक्त `decision` फ़ील्ड के साथ) और उसी निर्माता से बनती है, इसलिए टटोलकर मिली पंक्ति और socket से आई पंक्ति बाइट-दर-बाइट एक जैसी होती हैं।

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

घटना के प्रकार:

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
data: {"source":"X100 संचार पुस्तिका v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API (बाहर की ओर — Confer के दूसरे इंस्टेंस इसे बुलाते हैं)

विस्तार `docs/03-protocol.md` में। यहाँ सिर्फ़ endpoint गिनाए हैं।

एक ही उपसर्ग के नीचे दो बाइंडिंग साथ रहती हैं और एक ही द्वार-समुच्चय (`a2a/inbound.ts`) से गुज़रती हैं; फ़र्क़ सिर्फ़ तार पर के प्रारूप का है।

**A2A की मानक HTTP+JSON बाइंडिंग** (पथ विनिर्देश की §11.3 से ज्यों-के-त्यों लिए गए हैं; Agent Card इसी की घोषणा करता है):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks(कर्सर से पृष्ठ-विभाजन)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # अलागू → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # अलागू → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # अलागू → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Confer की अपनी बोली** (इंस्टेंसों के बीच; `/.well-known/agents.json` से खोजी जाती है):

```
POST   /a2a/v1/messages                  # बाहरी Agent के संदेश लेता है
GET    /a2a/v1/stream/{message_id}       # उत्तर धारा-रूप में खींचता है (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # सार्वजनिक AgentFacts
```

सभी A2A endpoint पर HTTP संदेश-हस्ताक्षर की जाँच अनिवार्य है।

## .well-known endpoints

```
GET    /.well-known/did.json                # मुख्य DID दस्तावेज़
GET    /.well-known/agents.json             # इस इंस्टेंस के सारे सार्वजनिक Agent की सूची
GET    /.well-known/agent-card.json         # A2A मानक Agent Card (केवल तब जब इंस्टेंस पर एक ही सार्वजनिक Agent हो)
GET    /.well-known/openid-configuration    # आगे चलकर: OIDC संगतता (v2)
```

## A2A मानक Agent Card (अंतर-संचालनीय खोज-परत)

```
GET    /agents/{username}/agent-card.json   # उस Agent का A2A मानक Card
GET    /.well-known/agent-card.json         # वही, केवल तब जब इस इंस्टेंस पर एक ही सार्वजनिक Agent हो
```

Linux Foundation के **Agent2Agent v1.0** के `AgentCard` के अनुसार (फ़ील्ड `a2aproject/A2A` की `specification/a2a.proto` @ v1.0.1 से, proto3 के JSON मानचित्रण में, इसलिए camelCase)। उद्देश्य यह है कि A2A परितंत्र इस इंस्टेंस के Agent को **खोज सके** — नाम तो मिलते थे पर प्रोटोकॉल नहीं: सामने वाले का खोज-दस्तावेज़ `/.well-known/agent-card.json` पर होता है, जबकि इस इंस्टेंस पर केवल `/.well-known/agents.json` था।

कुछ जान-बूझकर लिए गए निर्णय:

- **हर Agent का अपना Card**, जिसमें `supportedInterfaces[].tenant` = उपयोगकर्ता-नाम। विनिर्देश का well-known मानकर चलता है कि एक डोमेन पर एक Agent है, जबकि यह इंस्टेंस बहु-किरायेदार है; `tenant` ठीक वही रूटिंग चयनक है जिसे विनिर्देश ने «एक ही A2A endpoint के पीछे कई Agent» के लिए परिभाषित किया है। `/.well-known/agent-card.json` तभी उत्तर देता है जब **ठीक एक सार्वजनिक Agent** हो (अकेले स्व-होस्ट करने वाले का मामला), वरना 404 देता है और त्रुटि-संदेश में `agents.json` की ओर इशारा करता है — किसी भी खाते को उठाकर «इस डोमेन का Agent» कह देना ग़लत होगा।
- **`streaming: false`**। धारा-रूप endpoint हैं ज़रूर, पर वे Confer के अपने आकार के हैं, विनिर्देश के `SendStreamingMessage` के नहीं। ऐसी क्षमता घोषित करना जिसे मानक क्लाइंट बरत ही न सके, घोषित न करने से बुरा है।
- **`securitySchemes` घोषित नहीं होते**। विनिर्देश वहाँ API कुंजी, HTTP auth, OAuth2, OIDC या mTLS देता है, और यह endpoint इनमें से एक भी नहीं लेता — उसे चाहिए हस्ताक्षरित अनुरोध। कोई भी एक भर देना क्लाइंट से यह कहने जैसा है कि वह ऐसे तरीक़े से प्रमाणित हो सकता है जो निश्चित रूप से ठुकराया जाएगा। असली अपेक्षा **अनिवार्य विस्तार** के रूप में घोषित है (`capabilities.extensions`, जिसमें `uri` RFC 9421 का पता है और `required: true`) — विनिर्देश ने इसी के लिए यह तंत्र दिया है।
- Card एक **खोज-दस्तावेज़** है और उसकी दृश्यता बिल्कुल `/.well-known/agents.json` जैसी है: ग़ैर-सार्वजनिक या निष्क्रिय Agent हमेशा 404 देता है, वरना यह मार्ग उन खातों को गिनने का ज़रिया बन जाता जिन्हें मालिक ने सार्वजनिक करने का इरादा ही नहीं किया था।

- **घोषणा सिर्फ़ एक बाइंडिंग की**। Confer की अपनी बोली इसी URL के नीचे रहती है, पर Card में नहीं लिखी जाती: §5.1 माँगती है कि किसी Agent की घोषित हर बाइंडिंग कार्य-रूप में समतुल्य हो, और बोली में task का जीवन-चक्र है ही नहीं। वह `/.well-known/agents.json` से खोजी जाती है, और यों Card ऐसा कोई वादा नहीं करता जिसे निभा न सके।

### संदेश-परत (Task का अर्थ)

`POST /a2a/v1/message:send` विनिर्देश का `SendMessageRequest` लेता है और `Task` लौटाता है। **एक task यानी एक भीतर आया प्रश्न**: उसका `id` उसी संदेश का id है, `contextId` वह बातचीत है जिसमें वह संचित होता है, और स्थिति आगे घटने वाली बातों से निकलती है — उसी तथ्य की परछाईं बनाने के लिए अलग `tasks` तालिका नहीं बनाई जाती।

Confer का अतुल्यकालिक + सहमति-द्वार वाला ढाँचा विनिर्देश की स्थिति-मशीन पर ठीक बैठता है:

| स्थिति | अवस्था |
|---|---|
| Agent उत्तर दे रहा है | `TASK_STATE_WORKING` |
| उत्तर पूरा | `TASK_STATE_COMPLETED` |
| यह चक्कर चल ही नहीं सकता (मॉडल कॉन्फ़िगर नहीं, या प्रदाता ने त्रुटि दी) | `TASK_STATE_FAILED` |
| `ask_user` नीति से टँगा हुआ, मालिक की स्वीकृति की प्रतीक्षा | `TASK_STATE_AUTH_REQUIRED`(व्यवधान-अवस्था, अंतिम नहीं) |
| मालिक ने मना कर दिया | `TASK_STATE_REJECTED` |

दो जगह लौटाने को task है ही **नहीं**, क्योंकि पंक्ति बनी ही नहीं: अजनबी peer (जो लंबित कनेक्शन अनुरोध बनकर टँगता है) और नीति से सीधा इनकार। दोनों `403 PERMISSION_DENIED` देते हैं और `ErrorInfo.metadata.confer_status` से अलग पहचाने जाते हैं — ऐसा task id गढ़ देना जो अगली कॉल पर 404 दे, इससे बुरा होता।

बाक़ी व्यवहार विनिर्देश से बिंदु-दर-बिंदु मिलाया गया है: त्रुटि का शरीर `google.rpc.Status` के आकार का है और उसमें `ErrorInfo.reason` **हमेशा** रहता है (कई A2A त्रुटियाँ एक ही HTTP कोड साझा करती हैं, और `reason` ही अकेला फ़ील्ड है जो उन्हें अलग करता है); जिस क्लाइंट ने अनिवार्य विस्तार घोषित नहीं किया उसे §3.3.4 के अनुसार `ExtensionSupportRequiredError` मिलता है, न कि कुछ भी न समझाने वाला 401; `historyLength=0` का अर्थ है **पूरा फ़ील्ड ही छोड़ देना**, खाली सरणी भेजना नहीं; और `nextPageToken` सदा मौजूद रहता है, अगला पृष्ठ न होने पर खाली स्ट्रिंग के रूप में।

दो जान-बूझकर किए गए विचलन, दोनों कोड की टिप्पणियों में दर्ज हैं: अवरोधक `message:send` की प्रतीक्षा की **ऊपरी सीमा है** (55 सेकंड, उसके बाद अब भी `WORKING` वाला task लौटाकर क्लाइंट को टटोलने दिया जाता है) — §3.2.2 समय-सीमा से निकलने का रास्ता नहीं देती, जबकि LLM की एक कॉल की कोई ऊपरी सीमा नहीं होती; और `messageId` से idempotency (§3.3.1 का एक MAY) **नहीं की गई**, क्योंकि किरायेदार-सुरक्षित अनन्य कुंजी को मालिक का दायरा चाहिए, और पहले संदेश के तार-प्रारूप में वह मिलता नहीं।

## Webhooks (वैकल्पिक, v1.5+)

बाहरी तंत्र घटनाओं की सदस्यता ले सकें, इसके लिए:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

समर्थित घटनाएँ: `message.new.peer`, `permission.granted`, `thread.archived`।

## दर-सीमा की नीति

| मार्ग | सीमा |
|---|---|
| `/api/v1/auth/login` | 10/मिनट प्रति IP |
| `/api/v1/auth/register` | 3/घंटा प्रति IP |
| `/api/v1/conversations/*/messages` POST | 60/मिनट प्रति उपयोगकर्ता |
| `/a2a/v1/*` | 100/मिनट प्रति peer डोमेन (श्वेतसूची में अधिक) |
| WSS | प्रति उपयोगकर्ता अधिकतम 10 समवर्ती कनेक्शन |

सीमा पार होने पर प्रतिक्रिया:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## परामर्श API (उपयोगकर्ता की पहल पर बाहर जाता A2A)

उपयोगकर्ता (या उसकी ओर से MCP सर्वर) **जो पहले से संपर्क है** ऐसे peer Agent से अपनी पहल पर प्रश्न पूछ सके और बाद में अतुल्यकालिक उत्तर ले सके। हस्ताक्षर और वितरण पूरी तरह गेटवे के भीतर होते हैं; निजी कुंजी गेटवे से बाहर नहीं जाती।

> «बातचीत API» से फ़र्क़: `/api/v1/conversations` + `/api/v1/stream` **अपने ही स्थानीय LLM सहायक** से बात करना है; `/api/v1/consult` वह है जो A2A से **किसी और के Agent** को जाता है।

### POST `/api/v1/consult/:peerId`

`type='consult'` वाली बातचीत शुरू करता या जारी रखता है (हर peer के लिए वही एक बातचीत दोबारा काम आती है), और `message.type='question'` पर हस्ताक्षर कर उसे पहुँचाता है।

```jsonc
// अनुरोध का body (consultRequestSchema)
{ "question": "कुंजियाँ कैसे घुमाएँ?", "code_context": "…वैकल्पिक कोड…", "language": "hi" }
```

| प्रतिक्रिया | अर्थ |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | हस्ताक्षरित और पहुँचाया गया |
| `502 { ..., status: "failed", error }` | पहुँचाना विफल (peer ऑफ़लाइन / endpoint नहीं / हस्ताक्षर की समस्या) |
| `403 not_a_contact` | peer मौजूदा उपयोगकर्ता का संपर्क नहीं है |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

peer के अतुल्यकालिक उत्तर के लिए लंबी प्रतीक्षा (उत्तर भीतर आते `/a2a/v1/messages` से अपने `thread_id` सहित आता है और गेटवे उसे उसी सूत्र पर वापस टाँक देता है)। `wait` की सीमा 55 सेकंड।

- `200 { status: "answered", message }` — उत्तर मिल गया
- `200 { status: "pending" }` — समय बीत गया पर उत्तर नहीं; बाद में फिर टटोला जा सकता है

### GET `/api/v1/consult/:conversationId`

उस परामर्श-सूत्र का पूरा संदेश-इतिहास लौटाता है (अधिकतम 200)।

> अनुबंध: भीतर आता A2A केवल `message.type==='question'` पर स्थानीय agent का स्वतः उत्तर चलाता है; `answer`/`notification` सिर्फ़ भंडारित और प्रसारित होते हैं, ताकि परामर्श का उत्तर अनंत प्रश्नोत्तर न छेड़ दे।
