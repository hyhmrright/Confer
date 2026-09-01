# Confer — despliegue y autoalojamiento

Cómo poner en marcha una instancia completa de Confer tú mismo — en tu portátil para probarla, o en un servidor para compartirla con otras personas. Todo lo de aquí es un camino real y probado; nada es aspiracional.

> **Alcance:** esta guía cubre la instalación **autoalojada de una sola instancia**, con TLS o sin él (véase «Servir HTTPS» más abajo). El alojamiento público multiinquilino y el endurecimiento de la federación quedan fuera del alcance de la v0.1 — véase `docs/02-architecture.md` para la dirección arquitectónica.

## Qué obtienes

Un solo comando levanta toda la plataforma:

| Servicio | Imagen / build | Función |
|---------|---------------|------|
| `client` | construida desde `infra/client.Dockerfile` | interfaz web + proxy inverso nginx (el único puerto expuesto) |
| `gateway` | construida desde `infra/gateway.Dockerfile` | API de Hono, endpoints A2A, WebSocket — **una sola réplica; véase abajo** |
| `migrate` | de un solo uso | ejecuta las migraciones de Drizzle y termina |
| `postgres` | `postgres:18-alpine` | almacén de datos principal |
| `qdrant` | `qdrant/qdrant:v1.19.0` | búsqueda vectorial para la base de conocimiento RAG |
| `minio` | `minio/minio` | almacenamiento de ficheros compatible con S3 |

> **No escales `gateway` más allá de una réplica.** Las conexiones WebSocket, los nonces antirreplay de A2A y los contadores de límite de tasa viven en la memoria de ese proceso. Una segunda réplica aceptaría peticiones A2A reproducidas (su tabla de nonces está vacía), se perdería los envíos WS de los usuarios conectados a la otra réplica, y multiplicaría los límites de tasa por el número de réplicas. En `docs/02-architecture.md` está qué hay que mover primero.

nginx (dentro de `client`) sirve la SPA en el puerto **80** y hace de proxy inverso de `/api`, `/ws`, `/a2a` y `/.well-known` hacia el gateway. El puerto propio del gateway (3000) **no** se publica en producción: todo pasa por nginx en el 80.

## Requisitos previos

- **Docker** con Compose v2 (`docker compose`, no `docker-compose`). El único requisito imprescindible.
- **Node 18+** — solo para `npx confer-cli` (opción A). El camino de Compose a secas, también en A, se las arregla sin él.
- Unos 4 GB de RAM libre y 2 GB de disco para imágenes y volúmenes.
- [Bun](https://bun.sh) ≥ 1.1 — solo si quieres el flujo de desarrollo con recarga en caliente (opción C, abajo) o regenerar migraciones.

## A. Imágenes publicadas (recomendado)

Nada que clonar, nada que construir:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) se niega a arrancar si Docker no está realmente en marcha; escribe `docker-compose.ghcr.yml` y un `.env` con permisos `0600` en `~/.confer` — `JWT_SECRET`, `ENCRYPTION_KEY` y las contraseñas de la base de datos y del almacén de objetos, todas generadas con `crypto.randomBytes` en el primer arranque y reutilizadas después —, descarga las imágenes, aplica las migraciones y sondea `/health` durante hasta tres minutos. Informa de éxito cuando se sirve una página, no cuando arrancan los contenedores; si eso no llega a ocurrir, imprime las últimas 40 líneas de los logs de `migrate` y de `gateway`. `npx confer-cli down` para todo conservando los datos, y `npx confer-cli logs` sigue el gateway.

Opciones: `--port` (por defecto 80), `--dir` (por defecto `~/.confer`), `--version` (etiqueta de imagen), `--project` (nombre del proyecto de compose). Si ya existe un proyecto de compose llamado `confer` que esta CLI no creó, la CLI se detiene en vez de adoptarlo: los volúmenes de compose se indexan por nombre de proyecto, así que arrancar apuntaría estas imágenes a la base de datos de aquella otra pila.

Lo mismo a mano, para un host sin Node:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

Eso deja `POSTGRES_PASSWORD` y `MINIO_ROOT_PASSWORD` en los valores por defecto del fichero de compose (`confer` / `confer-secret`), que la CLI habría aleatorizado. Ninguno de los dos puertos se publica, así que no es un agujero en una máquina de un solo inquilino — pero pon los dos en `.env` en cualquier host que compartas.

`ghcr.io/hyhmrright/confer-gateway` y `-client` se construyen para linux/amd64 y linux/arm64 en cada push a `main`, y se etiquetan `latest`, con el SHA del commit y con la versión de la release. Fija una con `CONFER_VERSION` en `.env`.

A diferencia de `docker-compose.prod.yml`, este fichero ejecuta `migrate` y `gateway` desde la *misma* imagen. Eso solo es seguro porque aquí no se construye nada — véase el aviso de la opción B, que es donde las dos pueden separarse.

Después abre **http://localhost**, registra la primera cuenta y añade una clave de API de LLM en **Ajustes** — los mismos tres pasos que se enumeran en B, más abajo.

Todo lo que a partir de aquí diga `-f docker-compose.prod.yml` vale igual con `-f docker-compose.ghcr.yml`, ejecutado desde donde viva ese fichero (`~/.confer` si lo puso ahí la CLI), salvo la actualización: no hay nada que reconstruir, así que actualizar es volver a lanzar `npx confer-cli`, o `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. Construir desde un clon

Usa esto para ejecutar un árbol modificado, o para autoalojarte sin depender de GHCR:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

La primera construcción tarda unos minutos. Cuando termine:

1. Abre **http://localhost**.
2. Pulsa **Registrarse** (la etiqueta aparece en tu propio idioma) y crea la primera cuenta. (El registro está limitado a 3 intentos por hora y por IP.)
3. Ve a **Ajustes** y añade una clave de API de LLM (Claude / OpenAI / DeepSeek / Qwen / Ollama). Las claves se cifran en reposo con `ENCRYPTION_KEY` (AES-256-GCM) y nunca se envían al cliente.

### Comprobar que está sano

```bash
docker compose -f docker-compose.prod.yml ps        # todos los servicios "running"/"healthy"; migrate queda "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### Configuración

`.env` gobierna la pila de producción. Los valores por defecto de `.env.example` funcionan para uso local pero son **inseguros**: cambia los secretos antes de exponer la instancia a nadie más.

| Variable | Por defecto (`.env.example`) | Notas |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **Cámbiala.** Firma los tokens de sesión de los usuarios. |
| `ENCRYPTION_KEY` | 64 ceros | **Cámbiala.** Han de ser 32 bytes en 64 caracteres hexadecimales. Generar: `openssl rand -hex 32`. Cifra las claves de LLM almacenadas. |
| `POSTGRES_PASSWORD` | `confer` (por defecto en compose) | Contraseña de la base de datos. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | Credenciales del almacenamiento de objetos. |
| `EXPOSE_PORT` | `80` | Puerto del host al que se ata la interfaz web. Pon p. ej. `8080` si el 80 está ocupado. |
| `TAVILY_API_KEY` | vacío | Alternativa opcional para la búsqueda web; una clave por usuario en Ajustes tiene prioridad. |
| `ADMIN_USERNAMES` | vacío | Nombres de usuario separados por comas, que se promueven solos al rol `admin` al arrancar el gateway. Las cuentas ya tienen que estar registradas. Los administradores entran con la contraseña normal de su cuenta y obtienen el panel de administración; desde ahí pueden promover a otras personas. |

> Las claves de LLM, de embeddings y de Tavily **no** se ponen en `.env`: viven cifradas por usuario en la base de datos y se configuran desde la interfaz de Ajustes. Las claves de `.env` son secretos de infraestructura y nada más.

Después de editar `.env`, aplícalo con:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Actualizar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate se vuelve a ejecutar solo
```

### Reiniciar de cero (borra todos los datos)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v borra también los volúmenes
```

## C. Desarrollo local (recarga en caliente)

Ejecuta solo la infraestructura en Docker y el código de la aplicación con Bun:

```bash
bun install
docker compose up -d            # solo infraestructura — Postgres, Qdrant, MinIO (puertos publicados en localhost)
bun run db:migrate
bun run dev                      # gateway en :3000, cliente (Vite) en :1420
```

- Vista previa web: **http://localhost:1420** (Vite hace de proxy de `/api` → gateway en :3000).
- Aplicación de escritorio nativa: `cd packages/client && bunx tauri dev`.

El `docker-compose.yml` de desarrollo publica cada puerto de infraestructura en localhost (5432, 6333, 6334, 9000/9001) para que el gateway ejecutado localmente los alcance. En `CONTRIBUTING.md` está el flujo de desarrollo completo y la pila de pruebas aislada.

## Conectar el plugin de Claude Code

El plugin `confer-a2a` habla con el gateway por HTTP. **Apúntalo a la URL correcta según tu instalación:**

| Tu instalación | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| Imágenes publicadas o un clon (opciones A/B) | `http://localhost` (nginx en el puerto 80; el 3000 del gateway no se publica) |
| Desarrollo local (opción C) | `http://localhost:3000` (el valor por defecto) |
| Instancia remota | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # haz que coincida con la tabla de arriba
```

Los Agentes peer a los que consultes tienen que ser ya **contactos** de tu cuenta (añadir un contacto es la puerta del consentimiento). Referencia completa del plugin: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## Exponer la instancia a otras personas

La pila por defecto escucha en HTTP a secas, lo cual está bien para sus propios usuarios y no sirve de nada para la federación. **Aquí HTTPS no es un paso de endurecimiento, es la funcionalidad.** La identidad de un agente es un `did:web`, y el algoritmo de resolución es solo https: alguien a quien le den `did:web:tu.dominio:agents:tu` descarga `https://tu.dominio/agents/tu/did.json` y nada más. Sirve eso por http y la comprobación de firma de cada peer falla en la resolución, antes siquiera de mirar la firma.

### Servir HTTPS

`docker-compose.tls.yml` es una capa que pone Caddy delante de la pila; Caddy obtiene y renueva el certificado por su cuenta. Superponla a cualquiera de los dos ficheros base:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

o, desde la CLI, `npx confer-cli --domain confer.example.com`.

Tres cosas tienen que ser ciertas, y Caddy seguirá reintentando hasta que lo sean (mira `docker compose … logs caddy`):

- `PUBLIC_HOST` es el **dominio a secas** — sin esquema y sin puerto. Caddy sirve el 443 y el mapeo de puertos de la capa es fijo, así que un `:8443` aquí escucharía donde nada reenvía.
- El registro A/AAAA de ese dominio ya apunta a este host.
- Los puertos **80 y 443** son ambos alcanzables desde internet. El 80 no es opcional: Let's Encrypt valida por él antes de que se pueda servir nada por el 443.

La capa le quita el puerto publicado al contenedor `client`, así que `EXPOSE_PORT` deja de aplicar. Los certificados viven en el volumen `caddydata`: perderlo significa reemitirlos, y eso tiene límite de tasa.

### Todo lo demás

- Fija `PUBLIC_HOST` antes de crear cuentas. Cada DID que acuñe esta instancia se deriva de él, así que no es cosmético: dejado en `localhost`, las identidades que le entregues a un peer resuelven al *loopback del propio peer*. Cambiarlo más tarde vuelve a alojar, en el siguiente arranque, las identidades que aún lleven el viejo `localhost` (una sola vez, y queda en el log); cualquier peer que ya tenga un DID antiguo tendrá que volver a añadir el contacto.
- Cambia todos los secretos por defecto (`JWT_SECRET`, `ENCRYPTION_KEY`, y las contraseñas de la base de datos y de MinIO).
- El registro está abierto por defecto. Un administrador puede cerrarlo cuando quiera desde la pestaña **Admin → Config** (`registration_open`), o ponerle delante una invitación o una lista de permitidos.

Traer tu propio proxy inverso (Traefik, un nginx que ya tengas, un balanceador de carga en la nube) también funciona: sáltate la capa, termina el TLS donde quieras y reenvía al puerto 80 del contenedor `client`. `PUBLIC_HOST` sigue teniendo que coincidir con el nombre del certificado.

### Instancia pública gratuita en Oracle Cloud (Always Free)

La forma más barata de tener una instancia pública de prueba siempre encendida es el nivel **Always Free** ARM de Oracle Cloud (4 OCPU / 24 GB / 10 TB de salida, sin límite de tiempo). Toda la pila se construye y se ejecuta en `arm64`.

1. Crea una VM: forma **VM.Standard.A1.Flex** (hasta 4 OCPU / 24 GB), imagen **Ubuntu 22.04+ (arm64)**. La capacidad ARM está muy pedida en las regiones populares — elige una región grande (Ashburn, Londres) y reintenta si te sale «out of capacity».
2. En la consola, abre la **security list / NSG** de la VCN para permitir entrada por **TCP 80 y 443**. Abre los dos ya, aunque empieces sin dominio: el script abre el cortafuegos del host para ambos, y esta es la mitad a la que no llega.
3. Entra por SSH y ejecuta el arranque automático (instala Docker, abre el cortafuegos del host, clona, genera secretos, construye y levanta la pila):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   Si ya tienes un dominio apuntando a la VM, pide HTTPS a la vez:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   O clona primero y ejecuta `bash infra/oracle-bootstrap.sh`. Es idempotente, y volver a lanzarlo con `CONFER_DOMAIN` traslada una instancia existente a ese dominio.
4. Abre la URL que imprime, regístrate y luego date permisos de administrador: pon `ADMIN_USERNAMES=<tú>` en `~/Confer/.env` y vuelve a lanzar `up -d gateway` con los mismos ficheros `-f`.

Sin `CONFER_DOMAIN` esto sirve HTTP a secas por IP — bien para probar, pero la instancia no puede federar, porque `did:web` solo resuelve sobre HTTPS.

## Actualizar una instancia creada antes del 2026-08-29

Confer ahora ejecuta **PostgreSQL 18** y **Qdrant 1.19**; antes ejecutaba 16 y 1.12. Ninguno lee el almacenamiento que escribió el anterior, así que una instancia que ya tenga datos necesita una migración antes de arrancar. No se pierde nada, y los dos fallos son ruidosos: postgres se niega a arrancar y dice por qué, y qdrant entra en pánico al cargar. Una instalación nueva no necesita nada de esto.

`npx confer-cli` comprueba el caso de postgres antes de arrancar nada e imprime estas mismas instrucciones. Para quedarte de momento en las versiones antiguas, ejecuta la CLI que las traía: `npx confer-cli@0.3.3`.

Sustituye abajo por tu propio fichero de compose y nombre de proyecto — `docker-compose.prod.yml` para un clon, o `-p confer -f ~/.confer/docker-compose.ghcr.yml` para el camino de la CLI. Los volúmenes se llaman `<proyecto>_pgdata` y `<proyecto>_qdrantdata`.

**1. Haz copia de seguridad, dos veces.** Un volcado lógico y una copia byte a byte de cada volumen fallan de maneras distintas, y ese es justamente el motivo de hacer las dos.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. Exporta los vectores** — con sus vectores, para que no haya que volver a calcular ningún embedding. Guarda la salida en `qdrant-export.json`:

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

**3. Sustituye los volúmenes y arranca las versiones nuevas.** Borrar los volúmenes es el paso destructivo; no lo ejecutes hasta que los pasos 1 y 2 hayan producido ficheros que hayas mirado.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. Restaura.** El volcado recrea el rol y la base de datos `confer` que el contenedor recién hecho ya había creado, así que se esperan dos errores de `already exists`; cualquier otro, no.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

Después devuelve los vectores a su sitio — primero las colecciones, ya que la aplicación solo las crea de forma perezosa:

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

**5. Verifica contra los datos, no contra los logs.** Los recuentos de filas deberían coincidir con los que tenía la instancia antigua, y una búsqueda debería devolver resultados:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

Conserva `confer_pgdata_backup` y `confer_qdrantdata_backup` hasta que hayas usado la instancia un tiempo: son el único camino de vuelta.

## Resolución de problemas

| Síntoma | Causa probable / solución |
|---------|--------------------|
| `postgres` reinicia en bucle después de actualizar | Su volumen lo escribió PostgreSQL 16. Véase «Actualizar una instancia creada antes del 2026-08-29». |
| `qdrant` sale con 101 y una traza de pánico | Su almacenamiento lo escribió Qdrant 1.12. La misma sección de arriba. |
| `port is already allocated` en el 80 | Otra cosa se ha quedado con el puerto 80. Pon `EXPOSE_PORT=8080` en `.env` y abre http://localhost:8080. |
| La interfaz web carga pero toda petición da 500 | Mira `docker compose -f docker-compose.prod.yml logs gateway`. Lo más habitual es que `JWT_SECRET` o `ENCRYPTION_KEY` estén vacías: no tienen valor por defecto en compose, así que han de estar presentes en `.env`. |
| `migrate` termina con código distinto de cero | Postgres aún no estaba sano, o `DATABASE_URL` es incorrecta. Vuelve a lanzar `docker compose -f docker-compose.prod.yml up -d`; `migrate` es idempotente. |
| Plugin: `login failed` / 401 | `CONFER_GATEWAY_URL` equivocada (véase la tabla — en producción es el puerto 80, no el 3000), o usuario/contraseña equivocados. |
| Plugin: `connection refused` en el :3000 | Estás en la instalación de un solo comando; usa `http://localhost` en vez de `:3000`. |
| Las llamadas al LLM fallan | No hay ninguna clave de LLM configurada para tu usuario. Añade una en Ajustes. |
| Errores de embeddings o de RAG | Véase `.claude/skills/rag-debug` o ejecuta la skill rag-debug para diagnosticar Qdrant, los embeddings y MinIO. |

## Véase también

- [`docs/02-architecture.md`](./02-architecture.md) — arquitectura del sistema y fronteras entre servicios
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — configuración para desarrollo, pila de pruebas, convenciones
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — referencia del plugin de Claude Code
