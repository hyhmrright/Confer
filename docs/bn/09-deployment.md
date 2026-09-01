# Confer — স্থাপন ও স্ব-হোস্টিং

পুরো একটি Confer ইনস্ট্যান্স নিজে কীভাবে চালাবেন — পরখ করার জন্য নিজের ল্যাপটপে, কিংবা অন্যদের সঙ্গে ভাগ করার জন্য কোনো সার্ভারে। এখানে যা আছে সবই সত্যিকারের, পরীক্ষিত পথ; কিছুই কেবল আকাঙ্ক্ষা নয়।

> **পরিধি:** এই নির্দেশিকা **এক ইনস্ট্যান্সের, স্ব-হোস্ট করা** ব্যবস্থাকে ধরে, TLS সহ বা ছাড়া (নিচে «HTTPS-এ পরিবেশন» দেখুন)। প্রকাশ্য বহু-ভাড়াটে হোস্টিং আর ফেডারেশনের কঠোরীকরণ v0.1-এর পরিধির বাইরে — স্থাপত্যের দিক জানতে `docs/02-architecture.md` দেখুন।

## আপনি কী পাবেন

একটিই আদেশে গোটা প্ল্যাটফর্ম চালু হয়:

| সেবা | ইমেজ / build | ভূমিকা |
|---------|---------------|------|
| `client` | তৈরি হয় `infra/client.Dockerfile` | ওয়েব UI + nginx রিভার্স প্রক্সি (একমাত্র উন্মুক্ত পোর্ট) |
| `gateway` | তৈরি হয় `infra/gateway.Dockerfile` | Hono API, A2A প্রান্তবিন্দু, WebSocket — **একটিই রেপ্লিকা, নিচে দেখুন** |
| `migrate` | একবারই চলে | Drizzle-এর migration চালিয়ে বেরিয়ে যায় |
| `postgres` | `postgres:18-alpine` | প্রধান তথ্যভাণ্ডার |
| `qdrant` | `qdrant/qdrant:v1.19.0` | RAG জ্ঞানভাণ্ডারের জন্য ভেক্টর খোঁজ |
| `minio` | `minio/minio` | S3-সঙ্গতিপূর্ণ ফাইল সংরক্ষণ |

> **`gateway`-কে একটির বেশি রেপ্লিকায় বাড়াবেন না।** WebSocket সংযোগ, A2A-র রিপ্লে-বিরোধী nonce আর হার-সীমার কাউন্টার — সবই ওই প্রসেসের স্মৃতিতে থাকে। দ্বিতীয় রেপ্লিকা পুনরাবৃত্ত A2A অনুরোধ মেনে নেবে (তার nonce তালিকা ফাঁকা), অন্য রেপ্লিকায় যুক্ত ব্যবহারকারীদের WS বিজ্ঞপ্তি মিস করবে, আর হার-সীমাকে রেপ্লিকার সংখ্যা দিয়ে গুণ করে দেবে। আগে কী সরাতে হবে, তা `docs/02-architecture.md`-এ।

nginx (`client`-এর ভিতরে) SPA পরিবেশন করে **৮০** পোর্টে, আর `/api`, `/ws`, `/a2a` ও `/.well-known` gateway-এর দিকে রিভার্স-প্রক্সি করে। gateway-এর নিজের পোর্ট (3000) উৎপাদনে **প্রকাশ করা হয় না** — সবকিছু ৮০-তে nginx দিয়েই যায়।

## আগে যা লাগবে

- **Docker**, Compose v2 সহ (`docker compose`, `docker-compose` নয়)। এটিই একমাত্র কঠিন শর্ত।
- **Node 18+** — কেবল `npx confer-cli`-র জন্য (বিকল্প A)। সাদামাটা Compose-এর পথ, সেটিও A-তেই, এটি ছাড়াই চলে।
- ইমেজ ও ভলিউমের জন্য মোটামুটি ৪ GB খালি RAM আর ২ GB ডিস্ক।
- [Bun](https://bun.sh) ≥ 1.1 — কেবল যদি গরম-পুনর্লোডের উন্নয়ন-ধারা (নিচে বিকল্প C) চান, কিংবা migration আবার বানাতে চান।

## A. প্রকাশিত ইমেজ (সুপারিশকৃত)

ক্লোন করার কিছু নেই, বানানোরও কিছু নেই:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) Docker সত্যিই না চললে শুরুই হয় না; `~/.confer`-এ `docker-compose.ghcr.yml` আর `0600` অনুমতির একটি `.env` লেখে — `JWT_SECRET`, `ENCRYPTION_KEY` এবং ডেটাবেস ও বস্তু-ভাণ্ডারের পাসওয়ার্ড, সবই প্রথমবার `crypto.randomBytes` দিয়ে তৈরি এবং পরে পুনর্ব্যবহৃত —, ইমেজ টেনে আনে, migration প্রয়োগ করে, আর তিন মিনিট পর্যন্ত `/health` ঘেঁটে দেখে। সফলতার খবর দেয় তখন, যখন একটি পাতা পরিবেশিত হয় — কনটেইনার ওঠার সময় নয়; আর তা যদি কখনও না ঘটে, তবে `migrate` ও `gateway`-এর লগের শেষ ৪০ লাইন ছাপে। `npx confer-cli down` সব থামায় কিন্তু তথ্য রাখে, আর `npx confer-cli logs` gateway-এর পিছু নেয়।

ফ্ল্যাগ: `--port` (ডিফল্ট ৮০), `--dir` (ডিফল্ট `~/.confer`), `--version` (ইমেজের ট্যাগ), `--project` (compose প্রকল্পের নাম)। `confer` নামে compose প্রকল্প আগে থেকেই থাকলে এবং তা এই CLI না বানালে, CLI সেটিকে আপন না করে থেমে যায় — compose-এর ভলিউম প্রকল্পের নামে বাঁধা, তাই চালু করলে এই ইমেজগুলো ওই অন্য ব্যবস্থার ডেটাবেসের দিকেই তাক করত।

একই জিনিস হাতে, Node নেই এমন হোস্টের জন্য:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

তাতে `POSTGRES_PASSWORD` আর `MINIO_ROOT_PASSWORD` compose ফাইলের ডিফল্টেই (`confer` / `confer-secret`) থেকে যায়, যেগুলো CLI এলোমেলো করে দিত। এদের কোনো পোর্টই প্রকাশিত নয়, তাই এক-ভাড়াটে যন্ত্রে এটি ফাঁক নয় — তবু যে হোস্ট আপনি ভাগ করেন, সেখানে দুটোই `.env`-এ বসান।

`ghcr.io/hyhmrright/confer-gateway` আর `-client` প্রতিবার `main`-এ push হলে linux/amd64 ও linux/arm64-এর জন্য তৈরি হয়, আর `latest`, কমিটের SHA এবং মুক্তির সংস্করণ দিয়ে ট্যাগ করা হয়। কোনো একটিতে আটকাতে চাইলে `.env`-এ `CONFER_VERSION` দিন।

`docker-compose.prod.yml`-এর উল্টো, এই ফাইলটি `migrate` আর `gateway` দুটোকেই *একই* ইমেজ থেকে চালায়। এটি নিরাপদ কেবল এই কারণে যে এখানে কিছুই তৈরি হয় না — বিকল্প B-র সতর্কবার্তা দেখুন, ওখানেই এই দুটি আলাদা হয়ে যেতে পারে।

তারপর **http://localhost** খুলুন, প্রথম অ্যাকাউন্ট নিবন্ধন করুন, আর **সেটিংস**-এ একটি LLM API চাবি যোগ করুন — নিচের B-তে যে তিনটি ধাপ দেওয়া, সেই একই।

এরপর যা কিছু `-f docker-compose.prod.yml` বলে, তা `-f docker-compose.ghcr.yml` দিয়েও সমানভাবে খাটে — ওই ফাইলটি যেখানে আছে সেখান থেকে চালিয়ে (`~/.confer`, যদি CLI সেখানে রেখে থাকে) — কেবল হালনাগাদ ছাড়া: এখানে নতুন করে বানানোর কিছু নেই, তাই হালনাগাদ মানে আবার `npx confer-cli`, কিংবা `docker compose -f docker-compose.ghcr.yml pull && … up -d`।

## B. ক্লোন থেকে বানানো

বদলানো কোড চালাতে, কিংবা GHCR-এর উপর নির্ভর না করে স্ব-হোস্ট করতে এটি ব্যবহার করুন:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

প্রথমবার তৈরি হতে কয়েক মিনিট লাগে। শেষ হলে:

1. **http://localhost** খুলুন।
2. **নিবন্ধন**-এ ক্লিক করুন (লেখাটি আপনার নিজের ভাষায় দেখাবে) আর প্রথম অ্যাকাউন্ট বানান। (নিবন্ধন প্রতি IP-তে ঘণ্টায় ৩ বার পর্যন্ত সীমিত।)
3. **সেটিংস**-এ গিয়ে একটি LLM API চাবি যোগ করুন (Claude / OpenAI / DeepSeek / Qwen / Ollama)। চাবিগুলো `ENCRYPTION_KEY` দিয়ে (AES-256-GCM) এনক্রিপ্ট করে রাখা হয় এবং ক্লায়েন্টে কখনও পাঠানো হয় না।

### সব ঠিক আছে কি না দেখুন

```bash
docker compose -f docker-compose.prod.yml ps        # সব সেবা "running"/"healthy"; migrate থাকে "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### বিন্যাস

`.env` উৎপাদন ব্যবস্থাকে চালায়। `.env.example`-এর ডিফল্টগুলো স্থানীয় ব্যবহারে কাজ করে কিন্তু **অনিরাপদ** — ইনস্ট্যান্স অন্য কারও সামনে খোলার আগে গোপন মানগুলো বদলে নিন।

| চলক | ডিফল্ট (`.env.example`) | টীকা |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **এটি বদলান।** ব্যবহারকারীর সেশন টোকেনে স্বাক্ষর করে। |
| `ENCRYPTION_KEY` | ৬৪টি শূন্য | **এটি বদলান।** ৩২ বাইট, অর্থাৎ ৬৪টি হেক্স অক্ষর হতে হবে। বানান: `openssl rand -hex 32`। জমা রাখা LLM চাবি এনক্রিপ্ট করে। |
| `POSTGRES_PASSWORD` | `confer` (compose-এর ডিফল্ট) | ডেটাবেসের পাসওয়ার্ড। |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | বস্তু-ভাণ্ডারের পরিচয়পত্র। |
| `EXPOSE_PORT` | `80` | হোস্টের যে পোর্টে ওয়েব UI বাঁধা পড়ে। ৮০ দখলে থাকলে যেমন `8080` দিন। |
| `TAVILY_API_KEY` | ফাঁকা | ওয়েব খোঁজের জন্য ঐচ্ছিক বিকল্প; সেটিংসে দেওয়া প্রতি-ব্যবহারকারী চাবি অগ্রাধিকার পায়। |
| `ADMIN_USERNAMES` | ফাঁকা | কমা দিয়ে আলাদা করা ব্যবহারকারী-নাম, gateway চালু হওয়ার সময় যাদের আপনা-আপনি `admin` ভূমিকা দেওয়া হয়। অ্যাকাউন্টগুলো আগে থেকেই নিবন্ধিত থাকতে হবে। প্রশাসকরা নিজের সাধারণ অ্যাকাউন্টের পাসওয়ার্ড দিয়েই ঢোকেন আর প্রশাসন ফলক পান; সেখান থেকে তাঁরা অন্যদেরও উন্নীত করতে পারেন। |

> LLM / embedding / Tavily চাবি `.env`-এ **বসে না** — সেগুলো ডেটাবেসে প্রতি ব্যবহারকারীর জন্য এনক্রিপ্ট করা থাকে এবং সেটিংসের UI দিয়ে বিন্যস্ত হয়। `.env`-এর চাবিগুলো কেবল অবকাঠামোর গোপন মান।

`.env` সম্পাদনার পর এটি দিয়ে প্রয়োগ করুন:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### হালনাগাদ

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate আপনা-আপনিই আবার চলে
```

### সব মুছে নতুন করা (সমস্ত তথ্য যায়)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v ভলিউমগুলোও মুছে দেয়
```

## C. স্থানীয় উন্নয়ন (গরম পুনর্লোড)

Docker-এ কেবল অবকাঠামো চালান, আর অ্যাপের কোড Bun দিয়ে:

```bash
bun install
docker compose up -d            # কেবল অবকাঠামো — Postgres, Qdrant, MinIO (পোর্ট localhost-এ প্রকাশিত)
bun run db:migrate
bun run dev                      # gateway :3000-এ, ক্লায়েন্ট (Vite) :1420-এ
```

- ওয়েব প্রাকদর্শন: **http://localhost:1420** (Vite `/api`-কে :3000-এর gateway-এ প্রক্সি করে)।
- নিজস্ব ডেস্কটপ অ্যাপ: `cd packages/client && bunx tauri dev`।

উন্নয়নের `docker-compose.yml` প্রতিটি অবকাঠামো পোর্ট localhost-এ প্রকাশ করে (5432, 6333, 6334, 9000/9001), যাতে স্থানীয়ভাবে চলা gateway সেগুলোর নাগাল পায়। পুরো ডেভেলপার-ধারা আর আলাদা করা পরীক্ষা-ব্যবস্থার জন্য `CONTRIBUTING.md` দেখুন।

## Claude Code প্লাগিন যুক্ত করা

`confer-a2a` প্লাগিন gateway-এর সঙ্গে HTTP-তে কথা বলে। **আপনার ব্যবস্থার উপযুক্ত URL-এর দিকে তাকে তাক করান:**

| আপনার ব্যবস্থা | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| প্রকাশিত ইমেজ বা একটি ক্লোন (বিকল্প A/B) | `http://localhost` (nginx ৮০ পোর্টে; gateway-এর 3000 প্রকাশিত নয়) |
| স্থানীয় উন্নয়ন (বিকল্প C) | `http://localhost:3000` (ডিফল্ট) |
| দূরবর্তী ইনস্ট্যান্স | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # উপরের সারণির সঙ্গে মেলান
```

যেসব peer Agent-এর পরামর্শ নেবেন, তাদের আগে থেকেই আপনার অ্যাকাউন্টের **পরিচিত** হতে হবে (পরিচিত যোগ করাই সম্মতির দরজা)। প্লাগিনের পূর্ণ নির্দেশিকা: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)।

## ইনস্ট্যান্সটি অন্যদের সামনে খোলা

ডিফল্ট ব্যবস্থা সাদামাটা HTTP-তে শোনে, যা নিজের ব্যবহারকারীদের জন্য চলে আর ফেডারেশনের জন্য অকেজো। **এখানে HTTPS কঠোরীকরণের ধাপ নয়, এটিই বৈশিষ্ট্য।** কোনো agent-এর পরিচয় হলো একটি `did:web`, আর সমাধানের পদ্ধতি কেবল https: যাকে `did:web:আপনার.ডোমেইন:agents:আপনি` দেওয়া হলো, সে `https://আপনার.ডোমেইন/agents/আপনি/did.json` আনে, আর কিছু নয়। সেটি http-তে পরিবেশন করুন, আর প্রতিটি peer-এর স্বাক্ষর-যাচাই সমাধানেই ভেঙে পড়বে — স্বাক্ষরের দিকে তাকানোরও আগে।

### HTTPS-এ পরিবেশন

`docker-compose.tls.yml` হলো একটি আস্তরণ, যা ব্যবস্থার সামনে Caddy বসায়; Caddy নিজেই সনদ নেয় ও নবায়ন করে। দুটি ভিত্তি-ফাইলের যেকোনোটির উপর এটি চাপান:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

কিংবা CLI থেকে, `npx confer-cli --domain confer.example.com`।

তিনটি শর্ত সত্য হতে হবে, আর যতক্ষণ না হয় Caddy চেষ্টা চালিয়ে যাবে (`docker compose … logs caddy` দেখুন):

- `PUBLIC_HOST` হবে **খালি ডোমেইন** — স্কিম নয়, পোর্টও নয়। Caddy ৪৪৩ পরিবেশন করে আর আস্তরণের পোর্ট-মানচিত্র নির্দিষ্ট, তাই এখানে `:8443` এমন জায়গায় শুনত যেখানে কিছুই পাঠানো হয় না।
- সেই ডোমেইনের A/AAAA রেকর্ড আগে থেকেই এই হোস্টের দিকে তাক করা।
- **৮০ ও ৪৪৩** — দুটি পোর্টই ইন্টারনেট থেকে নাগালে। ৮০ ঐচ্ছিক নয়: ৪৪৩-এ কিছু পরিবেশন করার আগেই Let's Encrypt ওটি দিয়েই যাচাই করে।

আস্তরণটি `client` কনটেইনার থেকে প্রকাশিত পোর্ট কেড়ে নেয়, তাই `EXPOSE_PORT` আর খাটে না। সনদগুলো `caddydata` ভলিউমে থাকে — সেটি হারানো মানে আবার ইস্যু করানো, আর তাতে হার-সীমা আছে।

### বাকি সব

- অ্যাকাউন্ট বানানোর আগেই `PUBLIC_HOST` ঠিক করুন। এই ইনস্ট্যান্স যে DID-ই গড়ে, তা এখান থেকেই আসে, তাই এটি সাজসজ্জা নয়: `localhost`-এ ফেলে রাখলে আপনি কোনো peer-কে যে পরিচয় দেন, তা *সেই peer-এর নিজের* loopback-এ গিয়ে ঠেকে। পরে বদলালে, পরের বার চালু হওয়ার সময়, যেসব পরিচয় এখনও পুরোনো `localhost` বয়ে বেড়ায় সেগুলো নতুন হোস্টে সরে যায় (একবারই, আর লগে থাকে); তবে যে peer-এর কাছে আগেই পুরোনো DID আছে, তাকে পরিচিত আবার যোগ করতে হবে।
- প্রতিটি ডিফল্ট গোপন মান বদলান (`JWT_SECRET`, `ENCRYPTION_KEY`, ডেটাবেস ও MinIO-র পাসওয়ার্ড)।
- নিবন্ধন ডিফল্টে খোলা। প্রশাসক যেকোনো সময় **Admin → Config** ট্যাব থেকে তা বন্ধ করতে পারেন (`registration_open`), কিংবা সামনে আমন্ত্রণ বা অনুমোদিত-তালিকা বসাতে পারেন।

নিজের রিভার্স প্রক্সি আনাও চলে (Traefik, আগে থেকেই চলা nginx, কোনো ক্লাউড লোড ব্যালান্সার) — আস্তরণটি বাদ দিন, TLS যেখানে খুশি শেষ করুন, আর `client` কনটেইনারের ৮০ পোর্টে পাঠান। `PUBLIC_HOST` তবু সনদের নামের সঙ্গে মিলতে হবে।

### Oracle Cloud-এ বিনামূল্যের প্রকাশ্য ইনস্ট্যান্স (Always Free)

সবসময় চালু থাকা একটি প্রকাশ্য পরীক্ষামূলক ইনস্ট্যান্স চালানোর সবচেয়ে সস্তা উপায় হলো Oracle Cloud-এর **Always Free** ARM স্তর (৪ OCPU / ২৪ GB / ১০ TB নির্গমন, সময়ের সীমা নেই)। গোটা ব্যবস্থা `arm64`-এ তৈরি হয় ও চলে।

1. একটি VM বানান: আকার **VM.Standard.A1.Flex** (৪ OCPU / ২৪ GB পর্যন্ত), ইমেজ **Ubuntu 22.04+ (arm64)**। জনপ্রিয় অঞ্চলে ARM ক্ষমতা টানাটানির — বড় কোনো অঞ্চল বাছুন (Ashburn, London) আর «out of capacity» পেলে আবার চেষ্টা করুন।
2. Console-এ VCN-এর **security list / NSG** খুলে **TCP ৮০ ও ৪৪৩**-এ আগমন অনুমোদন করুন। ডোমেইন ছাড়া শুরু করলেও দুটিই এখনই খুলে রাখুন — স্ক্রিপ্ট হোস্টের ফায়ারওয়াল দুটির জন্যই খোলে, আর এই অর্ধেকটাতেই তার নাগাল নেই।
3. SSH দিয়ে ঢুকে bootstrap চালান (Docker বসায়, হোস্টের ফায়ারওয়াল খোলে, ক্লোন করে, গোপন মান বানায়, ব্যবস্থা গড়ে ও চালু করে):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   ডোমেইন আগে থেকেই VM-এর দিকে তাক করা থাকলে, সঙ্গে সঙ্গেই HTTPS চেয়ে নিন:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   কিংবা আগে ক্লোন করে `bash infra/oracle-bootstrap.sh` চালান। এটি idempotent, আর `CONFER_DOMAIN` দিয়ে আবার চালালে বিদ্যমান ইনস্ট্যান্সকে সেই ডোমেইনে সরিয়ে নেয়।
4. যে URL এটি ছাপে তা খুলুন, নিবন্ধন করুন, তারপর নিজেকে প্রশাসক করুন: `~/Confer/.env`-এ `ADMIN_USERNAMES=<আপনি>` বসিয়ে একই `-f` ফাইলগুলো দিয়ে আবার `up -d gateway` চালান।

`CONFER_DOMAIN` ছাড়া এটি IP-তে সাদামাটা HTTP পরিবেশন করে — পরখের জন্য চলে, তবে ইনস্ট্যান্সটি ফেডারেট করতে পারবে না, কারণ `did:web` কেবল HTTPS-এই সমাধান হয়।

## ২০২৬-০৮-২৯-এর আগে বানানো ইনস্ট্যান্সের উন্নয়ন

Confer এখন **PostgreSQL 18** আর **Qdrant 1.19** চালায়; আগে চালাত 16 আর 1.12। আগেরটি যা লিখেছে, নতুনটি তা পড়ে না; তাই যে ইনস্ট্যান্সে আগে থেকেই তথ্য আছে, চালু হওয়ার আগে তার একটি স্থানান্তর দরকার। কিছুই হারায় না, আর দুটি ব্যর্থতাই সরব: postgres চলতে অস্বীকার করে এবং কারণ বলে, আর qdrant লোড করার সময় panic করে। নতুন স্থাপনায় এসবের কিছুই লাগে না।

`npx confer-cli` কিছু চালু করার আগেই postgres-এর ব্যাপারটি দেখে নেয় এবং এই একই নির্দেশ ছাপে। আপাতত পুরোনো সংস্করণে থাকতে চাইলে যে CLI সেগুলো আনত, সেটিই চালান: `npx confer-cli@0.3.3`।

নিচে নিজের compose ফাইল ও প্রকল্পের নাম বসান — ক্লোনের জন্য `docker-compose.prod.yml`, কিংবা CLI-র পথের জন্য `-p confer -f ~/.confer/docker-compose.ghcr.yml`। ভলিউমের নাম `<প্রকল্প>_pgdata` ও `<প্রকল্প>_qdrantdata`।

**১. দুবার ব্যাকআপ নিন।** যৌক্তিক dump আর প্রতিটি ভলিউমের বাইট-প্রতিলিপি আলাদা আলাদাভাবে ব্যর্থ হয় — দুটোই নেওয়ার কারণ ঠিক এটাই।

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**২. ভেক্টর রপ্তানি করুন** — ভেক্টর সমেত, যাতে কিছুই আবার embed করতে না হয়। ফলাফল `qdrant-export.json`-এ রাখুন:

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

**৩. ভলিউম বদলান আর নতুন সংস্করণ চালু করুন।** ভলিউম মুছে ফেলাই ধ্বংসাত্মক ধাপ; ১ আর ২ নম্বর ধাপ এমন ফাইল না দেওয়া পর্যন্ত এটি চালাবেন না, যেগুলো আপনি চোখে দেখেছেন।

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**৪. পুনরুদ্ধার করুন।** dump সেই `confer` ভূমিকা আর ডেটাবেস আবার বানায়, যা নতুন কনটেইনার আগেই বানিয়ে ফেলেছে; তাই `already exists`-এর দুটি ত্রুটি প্রত্যাশিত, বাকি কোনোটিই নয়।

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

তারপর ভেক্টরগুলো ফিরিয়ে দিন — আগে সংগ্রহ, কারণ অ্যাপ সেগুলো কেবল দরকার পড়লেই বানায়:

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

**৫. লগ নয়, তথ্যের বিরুদ্ধে যাচাই করুন।** সারির গণনা পুরোনো ইনস্ট্যান্সের সঙ্গে মিলবে, আর খোঁজে ফল আসবে:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

`confer_pgdata_backup` আর `confer_qdrantdata_backup` রেখে দিন যতক্ষণ না ইনস্ট্যান্সটি কিছুদিন ব্যবহার করেন — ফেরার পথ কেবল ওই দুটিই।

## সমস্যা সমাধান

| লক্ষণ | সম্ভাব্য কারণ / সমাধান |
|---------|--------------------|
| উন্নয়নের পর `postgres` ঘুরে ঘুরে পুনরায় চালু হয় | তার ভলিউম PostgreSQL 16 লিখেছিল। দেখুন «২০২৬-০৮-২৯-এর আগে বানানো ইনস্ট্যান্সের উন্নয়ন»। |
| `qdrant` 101 কোডে panic backtrace দিয়ে বেরিয়ে যায় | তার ভাণ্ডার Qdrant 1.12 লিখেছিল। উপরের সেই একই অংশ। |
| ৮০-তে `port is already allocated` | ৮০ পোর্ট অন্য কিছুর দখলে। `.env`-এ `EXPOSE_PORT=8080` দিন আর http://localhost:8080 খুলুন। |
| ওয়েব UI ওঠে কিন্তু প্রতিটি অনুরোধে 500 আসে | `docker compose -f docker-compose.prod.yml logs gateway` দেখুন। বেশির ভাগ সময় `JWT_SECRET` বা `ENCRYPTION_KEY` ফাঁকা — compose-এ এদের কোনো ডিফল্ট নেই, তাই `.env`-এ থাকতেই হবে। |
| `migrate` শূন্য নয় এমন কোডে শেষ হয় | Postgres তখনও সুস্থ হয়নি, কিংবা `DATABASE_URL` ভুল। আবার চালান `docker compose -f docker-compose.prod.yml up -d`; `migrate` idempotent। |
| প্লাগিন: `login failed` / 401 | `CONFER_GATEWAY_URL` ভুল (সারণি দেখুন — উৎপাদনে ৮০ পোর্ট, 3000 নয়), কিংবা ব্যবহারকারী-নাম/পাসওয়ার্ড ভুল। |
| প্লাগিন: :3000-এ `connection refused` | আপনি এক-আদেশের ব্যবস্থায় আছেন; `:3000`-এর বদলে `http://localhost` ব্যবহার করুন। |
| LLM-এর ডাক ব্যর্থ হয় | আপনার ব্যবহারকারীর জন্য কোনো LLM চাবি বিন্যস্ত নেই। সেটিংসে একটি যোগ করুন। |
| Embedding/RAG-এর ত্রুটি | `.claude/skills/rag-debug` দেখুন, কিংবা Qdrant/embedding/MinIO পরীক্ষার জন্য rag-debug skill চালান। |

## আরও দেখুন

- [`docs/02-architecture.md`](./02-architecture.md) — সিস্টেমের স্থাপত্য ও সেবার সীমানা
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — ডেভেলপার ব্যবস্থা, পরীক্ষা-ব্যবস্থা, রীতি
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code প্লাগিনের নির্দেশিকা
