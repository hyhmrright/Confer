# Confer — तैनाती और स्व-होस्टिंग

पूरा Confer इंस्टेंस ख़ुद कैसे चलाएँ — आज़माने के लिए अपने लैपटॉप पर, या दूसरों के साथ साझा करने के लिए किसी सर्वर पर। यहाँ जो कुछ है वह असली, आज़माया हुआ रास्ता है; कुछ भी केवल इरादा नहीं।

> **दायरा:** यह मार्गदर्शिका **एकल इंस्टेंस, स्व-होस्ट** व्यवस्था को समेटती है, TLS के साथ या बिना (नीचे [HTTPS पर परोसना](#https-पर-परोसना) देखें)। सार्वजनिक बहु-किरायेदार होस्टिंग और फ़ेडरेशन की मज़बूती v0.1 के दायरे से बाहर हैं — वास्तुशिल्पीय दिशा के लिए `docs/02-architecture.md` देखें।

## आपको क्या मिलता है

एक ही आदेश पूरा मंच खड़ा कर देता है:

| सेवा | इमेज / build | भूमिका |
|---------|---------------|------|
| `client` | इससे बनी: `infra/client.Dockerfile` | वेब UI + nginx रिवर्स प्रॉक्सी (एकमात्र उजागर पोर्ट) |
| `gateway` | इससे बनी: `infra/gateway.Dockerfile` | Hono API, A2A endpoints, WebSocket — **एकल प्रतिकृति, नीचे देखें** |
| `migrate` | एक बार चलने वाली | Drizzle की migrations चलाकर बाहर हो जाती है |
| `postgres` | `postgres:18-alpine` | प्राथमिक डेटा-भंडार |
| `qdrant` | `qdrant/qdrant:v1.19.0` | RAG ज्ञान-कोश के लिए सदिश खोज |
| `minio` | `minio/minio` | S3-संगत फ़ाइल भंडारण |

> **`gateway` को एक से अधिक प्रतिकृति तक न बढ़ाएँ।** WebSocket संयोजन, A2A की पुनरावृत्ति-रोधी nonce और दर-सीमा की गिनतियाँ — सब उसी प्रक्रिया की स्मृति में रहती हैं। दूसरी प्रतिकृति दोहराए गए A2A अनुरोध स्वीकार कर लेगी (उसकी nonce तालिका ख़ाली है), दूसरी प्रतिकृति से जुड़े उपयोगकर्ताओं के WS संदेश चूक जाएगी, और दर-सीमाओं को प्रतिकृतियों की संख्या से गुणा कर देगी। पहले क्या हटाना होगा, यह `docs/02-architecture.md` में है।

nginx (`client` के भीतर) SPA को पोर्ट **80** पर परोसता है और `/api`, `/ws`, `/a2a` तथा `/.well-known` को gateway की ओर रिवर्स-प्रॉक्सी करता है। gateway का अपना पोर्ट (3000) उत्पादन में **प्रकाशित नहीं** होता — सब कुछ 80 पर nginx से होकर जाता है।

## पूर्वापेक्षाएँ

- **Docker**, Compose v2 सहित (`docker compose`, `docker-compose` नहीं)। यही एकमात्र कड़ी शर्त है।
- **Node 18+** — केवल `npx confer-cli` (विकल्प A) के लिए। सादा Compose वाला रास्ता, जो A में ही है, इसके बिना चल जाता है।
- इमेज और वॉल्यूम के लिए लगभग 4 GB खाली RAM और 2 GB डिस्क।
- [Bun](https://bun.sh) ≥ 1.1 — केवल तभी जब आपको गर्म-पुनर्भरण वाला विकास-प्रवाह (नीचे विकल्प C) चाहिए या migrations दोबारा बनानी हों।

## A. प्रकाशित इमेज (अनुशंसित)

कुछ क्लोन नहीं करना, कुछ बनाना नहीं:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) तब तक शुरू नहीं होती जब तक Docker सचमुच चल न रहा हो; यह `~/.confer` में `docker-compose.ghcr.yml` और `0600` अनुमति वाली `.env` लिखती है — `JWT_SECRET`, `ENCRYPTION_KEY` तथा डेटाबेस और वस्तु-भंडार के पासवर्ड, सब पहली बार `crypto.randomBytes` से बने और फिर दोबारा इस्तेमाल होते हैं —, इमेज खींचती है, migrations लगाती है, और तीन मिनट तक `/health` टटोलती है। सफलता वह तब बताती है जब कोई पन्ना परोसा जाए, तब नहीं जब कंटेनर उठें; और यदि ऐसा कभी न हो तो `migrate` तथा `gateway` के लॉग की अंतिम 40 पंक्तियाँ छाप देती है। `npx confer-cli down` सब रोक देता है पर डेटा रखता है, और `npx confer-cli logs` gateway का पीछा करता है।

विकल्प: `--port` (डिफ़ॉल्ट 80), `--dir` (डिफ़ॉल्ट `~/.confer`), `--version` (इमेज का tag), `--project` (compose परियोजना का नाम)। यदि `confer` नाम की compose परियोजना पहले से है और उसे इस CLI ने नहीं बनाया, तो CLI उसे अपनाने के बजाय रुक जाती है — compose के वॉल्यूम परियोजना-नाम से बँधे होते हैं, इसलिए चालू करने पर ये इमेज उसी दूसरी व्यवस्था के डेटाबेस की ओर तक जातीं।

वही चीज़ हाथ से, ऐसे होस्ट के लिए जिस पर Node नहीं:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

इससे `POSTGRES_PASSWORD` और `MINIO_ROOT_PASSWORD` compose फ़ाइल के डिफ़ॉल्ट (`confer` / `confer-secret`) पर ही रह जाते हैं, जिन्हें CLI यादृच्छिक कर देती। इनमें से कोई पोर्ट प्रकाशित नहीं होता, सो एकल-किरायेदार मशीन पर यह छेद नहीं है — पर जिस भी होस्ट को आप साझा करें, वहाँ दोनों `.env` में डालें।

`ghcr.io/hyhmrright/confer-gateway` और `-client` हर बार `main` पर push होने पर linux/amd64 और linux/arm64 के लिए बनती हैं, और `latest`, कमिट के SHA तथा रिलीज़ के संस्करण से चिह्नित होती हैं। किसी एक पर टिकना हो तो `.env` में `CONFER_VERSION` लगाएँ।

`docker-compose.prod.yml` के उलट, यह फ़ाइल `migrate` और `gateway` को *एक ही* इमेज से चलाती है। यह केवल इसलिए सुरक्षित है कि यहाँ कुछ बनता ही नहीं — विकल्प B की चेतावनी देखें, जहाँ ये दोनों अलग हो सकते हैं।

फिर **http://localhost** खोलें, पहला खाता बनाएँ, और **सेटिंग्स** में एक LLM API कुंजी जोड़ें — वही तीन चरण जो नीचे B में गिनाए गए हैं।

इसके बाद जो कुछ `-f docker-compose.prod.yml` कहे, वह `-f docker-compose.ghcr.yml` के साथ भी वैसा ही लागू होता है — जहाँ वह फ़ाइल है वहीं से चलाकर (`~/.confer`, यदि CLI ने उसे वहाँ रखा हो) — सिवाय अद्यतन के: यहाँ दोबारा बनाने को कुछ है ही नहीं, सो अद्यतन का अर्थ है फिर से `npx confer-cli`, या `docker compose -f docker-compose.ghcr.yml pull && … up -d`।

## B. क्लोन से बनाना

इसका उपयोग बदले हुए पेड़ को चलाने के लिए करें, या GHCR पर निर्भर हुए बिना स्व-होस्ट करने के लिए:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

पहली बार बनने में कुछ मिनट लगते हैं। जब पूरा हो जाए:

1. **http://localhost** खोलें।
2. **पंजीकरण** पर क्लिक करें (लेबल आपकी अपनी भाषा में दिखेगा) और पहला खाता बनाएँ। (पंजीकरण प्रति IP प्रति घंटे 3 प्रयासों तक सीमित है।)
3. **सेटिंग्स** में जाकर एक LLM API कुंजी जोड़ें (Claude / OpenAI / DeepSeek / Qwen / Ollama)। कुंजियाँ `ENCRYPTION_KEY` से (AES-256-GCM) एन्क्रिप्ट होकर रखी जाती हैं और क्लाइंट को कभी नहीं भेजी जातीं।

### जाँचें कि सब ठीक है

```bash
docker compose -f docker-compose.prod.yml ps        # सभी सेवाएँ "running"/"healthy"; migrate "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### विन्यास

`.env` उत्पादन व्यवस्था को चलाता है। `.env.example` के डिफ़ॉल्ट स्थानीय उपयोग के लिए काम करते हैं पर **असुरक्षित** हैं — इंस्टेंस किसी और के सामने खोलने से पहले गुप्त मान बदल लें।

| चर | डिफ़ॉल्ट (`.env.example`) | टिप्पणियाँ |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **इसे बदलें।** उपयोगकर्ता के session टोकन पर हस्ताक्षर करता है। |
| `ENCRYPTION_KEY` | 64 शून्य | **इसे बदलें।** 32 बाइट, यानी 64 हेक्स अक्षर होने चाहिए। बनाएँ: `openssl rand -hex 32`। संचित LLM कुंजियों को एन्क्रिप्ट करता है। |
| `POSTGRES_PASSWORD` | `confer` (compose का डिफ़ॉल्ट) | डेटाबेस का पासवर्ड। |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | वस्तु-भंडार के प्रमाण-पत्र। |
| `EXPOSE_PORT` | `80` | होस्ट का वह पोर्ट जिससे वेब UI बँधता है। 80 व्यस्त हो तो जैसे `8080` रखें। |
| `TAVILY_API_KEY` | ख़ाली | वेब खोज के लिए वैकल्पिक विकल्प; सेटिंग्स में दी गई प्रति-उपयोगकर्ता कुंजी को वरीयता मिलती है। |
| `ADMIN_USERNAMES` | ख़ाली | अल्पविराम से अलग किए उपयोगकर्ता-नाम, जिन्हें gateway के आरंभ पर अपने-आप `admin` भूमिका मिल जाती है। खाते पहले से पंजीकृत होने चाहिए। प्रशासक अपने सामान्य खाते के पासवर्ड से आते हैं और उन्हें प्रशासन पटल मिलता है; वहाँ से वे औरों को भी पदोन्नत कर सकते हैं। |

> LLM / embedding / Tavily कुंजियाँ `.env` में **नहीं** रखी जातीं — वे डेटाबेस में प्रति उपयोगकर्ता एन्क्रिप्टेड रहती हैं और सेटिंग्स के UI से विन्यस्त होती हैं। `.env` की कुंजियाँ केवल अवसंरचना के गुप्त मान हैं।

`.env` संपादित करने के बाद इसे लागू करें:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### अद्यतन

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate अपने-आप फिर चलती है
```

### सब मिटाकर नया करना (सारा डेटा जाता है)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v वॉल्यूम भी मिटा देता है
```

## C. स्थानीय विकास (गर्म पुनर्भरण)

Docker में केवल अवसंरचना चलाएँ और ऐप का कोड Bun से:

```bash
bun install
docker compose up -d            # केवल अवसंरचना — Postgres, Qdrant, MinIO (पोर्ट localhost पर प्रकाशित)
bun run db:migrate
bun run dev                      # gateway :3000 पर, क्लाइंट (Vite) :1420 पर
```

- वेब पूर्वावलोकन: **http://localhost:1420** (Vite `/api` को :3000 वाले gateway की ओर प्रॉक्सी करता है)।
- देशी डेस्कटॉप ऐप: `cd packages/client && bunx tauri dev`।

विकास का `docker-compose.yml` हर अवसंरचना पोर्ट को localhost पर प्रकाशित करता है (5432, 6333, 6334, 9000/9001), ताकि स्थानीय रूप से चल रहा gateway उन तक पहुँच सके। पूरे डेवलपर-प्रवाह और अलग किए गए परीक्षण-ढाँचे के लिए `CONTRIBUTING.md` देखें।

## Claude Code प्लगिन जोड़ना

`confer-a2a` प्लगिन gateway से HTTP पर बात करता है। **उसे अपनी व्यवस्था के अनुसार सही URL की ओर लगाएँ:**

| आपकी व्यवस्था | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| प्रकाशित इमेज या क्लोन (विकल्प A/B) | `http://localhost` (nginx पोर्ट 80 पर; gateway का 3000 प्रकाशित नहीं) |
| स्थानीय विकास (विकल्प C) | `http://localhost:3000` (डिफ़ॉल्ट) |
| दूरस्थ इंस्टेंस | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # ऊपर की तालिका से मिलाएँ
```

जिन peer Agent से आप सलाह लें, वे पहले से आपके खाते के **संपर्क** होने चाहिए (संपर्क जोड़ना ही सहमति का द्वार है)। प्लगिन का पूरा संदर्भ: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)।

## डेस्कटॉप और मोबाइल ऐप

वेब संस्करण को कभी किसी पते की ज़रूरत नहीं पड़ती: nginx उसे परोसता है और `/api` तथा `/ws` को उसी
ऑरिजिन पर प्रॉक्सी करता है। पैकेज किया हुआ डेस्कटॉप या Android ऐप अलग है — वह अपने ही संसाधन
`tauri://localhost` से परोसता है (Windows, Linux और Android पर यह `http://tauri.localhost`
लिखा जाता है), जहाँ सापेक्ष `/api/v1` खुद ऐप बंडल पर ही जा गिरता है। उसे बताना पड़ता है कि वह किस
इंस्टेंस का है, और यह उत्तर सिर्फ़ तैनात करने वाले को पता होता है।

पहली बार चलाने पर लॉगिन स्क्रीन पर एक अतिरिक्त फ़ील्ड — **इंस्टेंस का पता** — दिखता है। ऊपर की
तालिका की तरह ही भरें:

| आपकी तैनाती | क्या लिखें |
|---|---|
| प्रकाशित इमेज या क्लोन से बिल्ड (A/B) | `http://localhost` |
| लोकल डेवलपमेंट (C) | `http://localhost:3000` |
| दूरस्थ इंस्टेंस | `confer.example.com` |

बिना स्कीम वाले पते को `https://` माना जाता है — सिवाय `localhost` और `127.0.0.1` के, जिन्हें
`http://` पढ़ा जाता है, क्योंकि अपनी ही मशीन पर कोई प्रमाणपत्र नहीं लगाता। पता सिर्फ़ उसी डिवाइस पर रहता है, और दूसरे इंस्टेंस पर स्विच करने से लॉगिन सत्र भी साथ ही मिट
जाता है — टोकन उसी gateway का होता है जिसने उसे जारी किया, और उसे कहीं और ले जाने पर 401 ही
मिलेगा।

gateway की तरफ़ `/api/v1/*` पर ठीक दो ऑरिजिन की अनुमति है: `tauri://localhost` और
`http://tauri.localhost`। इन्हें सिर्फ़ उपयोगकर्ता की अपनी मशीन पर चल रहा Tauri ऐप ही ले सकता है —
कोई वेब पेज इन पर दावा नहीं कर सकता — और यह API कुकी नहीं भेजता (bearer टोकन हेडर में जाता है),
इसलिए यहाँ जो खुलता है वह उस कोड के लिए पढ़ने की अनुमति है जिसके पास पहले से टोकन है, कोई
परिवेशगत अधिकार नहीं।

## इंस्टेंस को दूसरों के सामने खोलना

डिफ़ॉल्ट व्यवस्था सादे HTTP पर सुनती है, जो अपने ही उपयोगकर्ताओं के लिए ठीक है और फ़ेडरेशन के लिए बेकार। **यहाँ HTTPS मज़बूती का क़दम नहीं, यही सुविधा है।** किसी agent की पहचान एक `did:web` है, और समाधान की विधि केवल https है: जिसे `did:web:आपका.डोमेन:agents:आप` थमाया गया, वह `https://आपका.डोमेन/agents/आप/did.json` लाता है और कुछ नहीं। उसे http पर परोसिए, और हर peer की हस्ताक्षर-जाँच समाधान पर ही ढेर हो जाएगी — हस्ताक्षर देखने की नौबत आने से पहले।

### HTTPS पर परोसना

`docker-compose.tls.yml` एक परत है जो व्यवस्था के आगे Caddy लगा देती है, और Caddy प्रमाणपत्र ख़ुद लेता और नवीनीकृत करता है। इसे दोनों में से किसी भी आधार फ़ाइल पर चढ़ाएँ:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

या CLI से, `npx confer-cli --domain confer.example.com`।

तीन बातें सच होनी चाहिए, और जब तक न हों Caddy कोशिश करता रहेगा (`docker compose … logs caddy` देखें):

- `PUBLIC_HOST` **नंगा डोमेन** हो — न योजना, न पोर्ट। Caddy 443 परोसता है और परत की पोर्ट-मैपिंग निश्चित है, सो यहाँ `:8443` वहाँ सुनेगा जहाँ कुछ अग्रेषित ही नहीं होता।
- उस डोमेन का A/AAAA रिकॉर्ड पहले से इसी होस्ट की ओर हो।
- **80 और 443** — दोनों पोर्ट इंटरनेट से पहुँच योग्य हों। 80 वैकल्पिक नहीं: Let's Encrypt उसी से सत्यापन करता है, इससे पहले कि 443 पर कुछ परोसा जा सके।

यह परत `client` कंटेनर से प्रकाशित पोर्ट छीन लेती है, सो `EXPOSE_PORT` अब लागू नहीं होता। प्रमाणपत्र `caddydata` वॉल्यूम में रहते हैं — उसे खोने का अर्थ है दोबारा जारी कराना, जिस पर दर-सीमा है।

### बाक़ी सब

- खाते बनाने से पहले `PUBLIC_HOST` तय कर लें। यह इंस्टेंस जो भी DID गढ़ता है वह इसी से निकलता है, सो यह सजावट नहीं: `localhost` पर छोड़ दिया तो जो पहचान आप किसी peer को थमाते हैं वह *उसी peer के अपने* loopback पर हल होती है। बाद में बदलने पर, अगली बार चलने पर, वे पहचानें जो अब भी पुराना `localhost` लिए हैं, नए होस्ट पर ले ली जाती हैं (एक ही बार, और लॉग में दर्ज); पर जिस peer के पास पहले से पुराना DID है उसे संपर्क दोबारा जोड़ना होगा।
- हर डिफ़ॉल्ट गुप्त मान बदलें (`JWT_SECRET`, `ENCRYPTION_KEY`, डेटाबेस और MinIO के पासवर्ड)।
- पंजीकरण डिफ़ॉल्ट में खुला है। प्रशासक जब चाहे उसे **Admin → Config** टैब से बंद कर सकता है (`registration_open`), या आगे निमंत्रण/अनुमति-सूची लगा सकता है।

अपना रिवर्स प्रॉक्सी लाना (Traefik, पहले से चल रहा nginx, कोई क्लाउड लोड बैलेंसर) भी चलता है — परत छोड़ दें, TLS जहाँ चाहें वहाँ समाप्त करें, और `client` कंटेनर के पोर्ट 80 पर अग्रेषित करें। `PUBLIC_HOST` फिर भी प्रमाणपत्र के नाम से मेल खाना चाहिए।

### Oracle Cloud पर मुफ़्त सार्वजनिक इंस्टेंस (Always Free)

हमेशा चालू रहने वाला सार्वजनिक परीक्षण इंस्टेंस चलाने का सबसे सस्ता तरीक़ा Oracle Cloud का **Always Free** ARM स्तर है (4 OCPU / 24 GB / 10 TB निर्गम, समय की कोई सीमा नहीं)। पूरी व्यवस्था `arm64` पर बनती और चलती है।

1. एक VM बनाएँ: आकार **VM.Standard.A1.Flex** (4 OCPU / 24 GB तक), इमेज **Ubuntu 22.04+ (arm64)**। लोकप्रिय क्षेत्रों में ARM क्षमता तंग रहती है — कोई बड़ा क्षेत्र चुनें (Ashburn, London) और «out of capacity» मिले तो फिर कोशिश करें।
2. Console में VCN की **security list / NSG** खोलकर **TCP 80 और 443** पर आवक की अनुमति दें। दोनों अभी खोल दें, चाहे आप बिना डोमेन के शुरू कर रहे हों — स्क्रिप्ट होस्ट का फ़ायरवॉल दोनों के लिए खोलती है, और यही वह आधा है जहाँ उसकी पहुँच नहीं।
3. SSH से भीतर जाएँ और bootstrap चलाएँ (Docker लगाता है, होस्ट का फ़ायरवॉल खोलता है, क्लोन करता है, गुप्त मान बनाता है, व्यवस्था बनाकर चालू करता है):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   यदि डोमेन पहले से VM की ओर लगा है, तो साथ ही HTTPS भी माँग लें:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   या पहले क्लोन करके `bash infra/oracle-bootstrap.sh` चलाएँ। यह idempotent है, और `CONFER_DOMAIN` के साथ दोबारा चलाने पर मौजूदा इंस्टेंस को उसी डोमेन पर ले जाता है।
4. जो URL यह छापे उसे खोलें, पंजीकरण करें, फिर ख़ुद को प्रशासक बनाएँ: `~/Confer/.env` में `ADMIN_USERNAMES=<आप>` लिखें और उन्हीं `-f` फ़ाइलों के साथ `up -d gateway` फिर चलाएँ।

`CONFER_DOMAIN` के बिना यह IP पर सादा HTTP परोसता है — परखने के लिए ठीक, पर इंस्टेंस फ़ेडरेट नहीं कर सकता, क्योंकि `did:web` केवल HTTPS पर हल होता है।

## 2026-08-29 से पहले बने इंस्टेंस का उन्नयन

Confer अब **PostgreSQL 18** और **Qdrant 1.19** चलाता है; पहले 16 और 1.12 चलाता था। इनमें से कोई भी उस भंडारण को नहीं पढ़ता जो पुराने ने लिखा था, सो जिस इंस्टेंस में पहले से डेटा है उसे चलने से पहले एक प्रवास चाहिए। कुछ भी खोता नहीं, और दोनों विफलताएँ शोरगुल वाली हैं: postgres चलने से इनकार करता है और कारण बताता है, और qdrant लोड करते समय panic कर जाता है। नई स्थापना को इसमें से कुछ नहीं चाहिए।

`npx confer-cli` कुछ भी चालू करने से पहले postgres वाली स्थिति जाँच लेती है और यही निर्देश छापती है। तब तक पुराने संस्करणों पर बने रहना हो तो वही CLI चलाएँ जो उन्हें लाती थी: `npx confer-cli@0.3.3`।

नीचे अपनी compose फ़ाइल और परियोजना-नाम रखें — क्लोन के लिए `docker-compose.prod.yml`, या CLI वाले रास्ते के लिए `-p confer -f ~/.confer/docker-compose.ghcr.yml`। वॉल्यूम के नाम `<परियोजना>_pgdata` और `<परियोजना>_qdrantdata` होते हैं।

**1. दो बार बैकअप लें।** तार्किक dump और हर वॉल्यूम की बाइट-दर-बाइट प्रति अलग-अलग तरीक़ों से विफल होती हैं — दोनों लेने का यही कारण है।

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. सदिश निर्यात करें** — उनके सदिशों समेत, ताकि कुछ भी दोबारा embed न करना पड़े। आउटपुट `qdrant-export.json` में सहेजें:

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

**3. वॉल्यूम बदलें और नए संस्करण चालू करें।** वॉल्यूम हटाना ही विनाशकारी चरण है; तब तक न चलाएँ जब तक चरण 1 और 2 ऐसी फ़ाइलें न दे दें जिन्हें आपने देख लिया हो।

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. पुनर्स्थापित करें।** dump वही `confer` भूमिका और डेटाबेस दोबारा बनाता है जो नया कंटेनर पहले ही बना चुका है, सो `already exists` की दो त्रुटियाँ अपेक्षित हैं; इसके अलावा कुछ भी नहीं।

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

फिर सदिश वापस रखें — पहले संग्रह, क्योंकि ऐप उन्हें केवल ज़रूरत पड़ने पर बनाता है:

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

**5. लॉग से नहीं, डेटा से जाँचें।** पंक्तियों की गिनती वही आनी चाहिए जो पुराने इंस्टेंस में थी, और खोज से परिणाम आने चाहिए:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

`confer_pgdata_backup` और `confer_qdrantdata_backup` तब तक रखें जब तक इंस्टेंस कुछ समय बरत न लें — वापसी का यही एकमात्र रास्ता है।

## समस्या-निवारण

| लक्षण | संभावित कारण / उपाय |
|---------|--------------------|
| उन्नयन के बाद `postgres` बार-बार पुनःआरंभ होता है | उसका वॉल्यूम PostgreSQL 16 ने लिखा था। देखें [2026-08-29 से पहले बने इंस्टेंस का उन्नयन](#2026-08-29-से-पहले-बने-इंस्टेंस-का-उन्नयन)। |
| `qdrant` 101 के साथ panic backtrace देकर बाहर हो जाता है | उसका भंडारण Qdrant 1.12 ने लिखा था। वही खंड जो ऊपर है। |
| 80 पर `port is already allocated` | पोर्ट 80 पर कोई और क़ब्ज़ा है। `.env` में `EXPOSE_PORT=8080` रखें और http://localhost:8080 खोलें। |
| वेब UI तो लदता है पर हर अनुरोध 500 देता है | `docker compose -f docker-compose.prod.yml logs gateway` देखें। अक्सर `JWT_SECRET` या `ENCRYPTION_KEY` ख़ाली होती है — compose में उनका कोई डिफ़ॉल्ट नहीं, सो उन्हें `.env` में होना ही चाहिए। |
| `migrate` शून्येतर कोड के साथ बाहर होती है | Postgres अभी स्वस्थ नहीं हुआ था, या `DATABASE_URL` ग़लत है। `docker compose -f docker-compose.prod.yml up -d` दोबारा चलाएँ; `migrate` idempotent है। |
| प्लगिन: `login failed` / 401 | `CONFER_GATEWAY_URL` ग़लत है (तालिका देखें — उत्पादन में पोर्ट 80 है, 3000 नहीं), या उपयोगकर्ता-नाम/पासवर्ड ग़लत। |
| प्लगिन: :3000 पर `connection refused` | आप एक-आदेश वाली व्यवस्था पर हैं; `:3000` के बजाय `http://localhost` लें। |
| LLM की कॉल विफल होती हैं | आपके उपयोगकर्ता के लिए कोई LLM कुंजी विन्यस्त नहीं। सेटिंग्स में एक जोड़ें। |
| Embedding/RAG की त्रुटियाँ | `.claude/skills/rag-debug` देखें, या Qdrant/embedding/MinIO की जाँच के लिए rag-debug skill चलाएँ। |

## यह भी देखें

- [`docs/02-architecture.md`](./02-architecture.md) — सिस्टम की वास्तुकला और सेवाओं की सीमाएँ
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — डेवलपर व्यवस्था, परीक्षण-ढाँचा, परिपाटियाँ
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code प्लगिन का संदर्भ
