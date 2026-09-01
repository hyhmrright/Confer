# Confer — Memoria de proyecto (.claude/peers/)

Define el formato de fichero con el que el conocimiento se deposita en el proyecto bajo la integración con Claude Code. Es una de las innovaciones centrales de Confer: **que el conocimiento del proveedor viaje con el proyecto y no se pierda entre sesiones, entre personas ni entre máquinas**.

## Estructura de directorios

En la raíz de cada proyecto:

```
.claude/
├── confer.toml                   # configuración del proyecto (peers, niveles de confianza)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # hechos verificados, estructurados
    │   ├── decisions.md          # registro de decisiones de diseño
    │   ├── conversations/        # historial completo de conversaciones
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # fragmentos de código
    │   │   └── read_temp.py
    │   └── meta.json             # metadatos del peer
    └── internal-sdk/
        ├── facts.md
        └── ...
```

Viaja con git, y todos los colaboradores lo comparten.

## Formato de los ficheros

### `meta.json`

```json
{
  "peer": {
    "slug": "abc-industries",
    "did":  "did:web:acme.com:agents:support",
    "name": "ABC Industries Support",
    "endpoint": "https://acme.com/a2a/v1",
    "authority": ["X100", "X200", "Modbus", "RTU", "TCP"],
    "languages": ["en", "zh", "de"]
  },
  "trust": "high",
  "registered_at": "2024-11-01T10:00:00Z",
  "last_synced_at": "2024-11-15T14:30:00Z",
  "stats": {
    "total_queries": 47,
    "total_facts": 23,
    "total_decisions": 6
  }
}
```

### `facts.md`

Una lista estructurada de hechos. **Cada hecho tiene que llevar su cita**: un «hecho» sin cita es una alucinación.

```markdown
# ABC Industries facts (project: modbus-integration)

> Auto-maintained by Confer. Each entry is verified by ABC Industries Agent
> with primary source citation. Do not edit machine-generated entries directly;
> use `confer memory edit` to propose changes.

## Modbus register map (X100)

- `0x40-0x47`: Temperature, 4 channels, units of 0.1°C, int16 signed
- `0x48-0x4F`: Pressure, 4 channels, units of 0.01 MPa, uint16
- `0x50-0x57`: Reserved (do not write)
- Function code: **0x03** (Read Holding Registers) — recommended
- Byte order: big-endian (high byte first)
- Default slave ID: **0x0A (10)** — not 1 as docs imply
  - Source: Manual de comunicaciones del X100 v3.2 p.87
  - Source: Guía de instalación del X100 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: Manual de instalación del X100 v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: Manual de comunicaciones del X100 v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

Convenciones de formato:

- los temas se separan con encabezados markdown de segundo nivel (`##`)
- cada hecho es un elemento de lista
- los valores clave se destacan en `**negrita**`
- al final de cada grupo de hechos tiene que haber una línea `Source:` y una marca `Verified:`
- varias fuentes se admiten con varias líneas `Source:`

### `decisions.md`

Las decisiones de diseño tomadas en el proyecto que tienen que ver con este peer. A diferencia de los facts (conclusiones con la autoridad del fabricante), las decisions son elecciones nuestras.

```markdown
# Decisions (project: modbus-integration, peer: abc-industries)

## D1: Use async polling at 200ms

**Date**: 2024-11-15
**Made by**: laowang (with consultation from ABC Agent)
**Status**: Active

We poll the X100 temperature/pressure registers every 200ms using async I/O.

**Alternatives considered:**
- 100ms polling — rejected: insufficient CRC retry budget
- Event-driven (X100 push) — not supported by this firmware

**Why this works for us**: 200ms latency is acceptable for our control loop;
async I/O lets us poll multiple devices concurrently.

**References:**
- See facts: "RTU mode timing"
- Conversation: 2024-11-15-modbus-setup.md
- Code: src/modbus/x100_client.py

---

## D2: Treat slave ID 10 as default; require explicit override

**Date**: 2024-11-15
**Made by**: laowang
**Status**: Active

After verification with ABC Agent that the documented "slave ID 1" is wrong
and actual default is 10, we hardcoded `DEFAULT_SLAVE_ID = 10` and require
explicit override via env variable for non-default installations.

**Why**: The vendor's docs and reality diverge. We trust verified vendor
statements over published docs.

**References:**
- See facts: "Modbus register map (X100)" → slave ID note
```

Convenciones de formato:

- cada decisión tiene un identificador único (`D1`, `D2`, …)
- campos obligatorios: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- hay que enumerar las alternativas consideradas
- hay que enlazar de vuelta a los facts y al código correspondientes

### `conversations/{date}-{slug}.md`

El historial completo de conversaciones. Confer archiva aquí cada hilo automáticamente.

```markdown
---
thread_id: thread_8f3a9c
peer: did:web:acme.com:agents:support
date: 2024-11-15
participants: [laowang, abc-industries-agent]
via: claude-code
status: closed
tags: [modbus, registers, x100]
summary: |
  Confirmed register map for X100 temperature and pressure sensors.
  Clarified function code recommendation and slave ID default.
---

# Modbus setup conversation

## laowang
Tengo que integrar el X100 por Modbus: 4 canales de temperatura y 4 de presión, con sondeo.

## ABC Agent
Mapa de registros de Modbus RTU:
- 0x40–0x47 temperatura (4 canales)
- 0x48–0x4F presión (4 canales)
Recomiendo un ciclo de sondeo de 200 ms y el código de función 0x03 para la lectura continua.

📎 Source: Manual de comunicaciones del X100 v3.2 p.87

## laowang
¿La lectura continua puede dar problemas de rendimiento? ¿Se atasca el dispositivo esclavo?

## ABC Agent
Leer 8 registros seguidos es una sola petición, así que no se atasca. Pero ojo: el slave ID por defecto es 0x0A (10), no 1; el manual antiguo se equivoca.

📎 Source: Guía de instalación del X100 p.12, FAQ #4
```

### Convenciones de nombres de fichero

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: nombrados por su uso, con la extensión propia del lenguaje

## Flujos de escritura y lectura

### Camino de escritura

```
se llama a ask_peer →
  la nube de Confer devuelve la respuesta →
  el servidor MCP extrae los hechos estructurados →
  los añade al facts.md local (si son hechos nuevos)
  añade la conversación completa a conversations/
  actualiza meta.json
  pista de commit local: sugerir al usuario git add .claude/peers/{slug}/
```

### Camino de lectura

```
arranca una sesión de Claude Code →
  se recorre .claude/peers/*/ →
  el facts.md de cada peer se le pasa a Claude Code como parte del prompt de sistema →
  Claude Code cita esos hechos con naturalidad mientras escribe código
```

### Tratamiento de conflictos

Si un mismo hecho se verifica varias veces:

- gana la verificación más reciente
- si el resultado nuevo contradice al viejo, **no se sobrescribe sin más**: se añade una marca `⚠️ Conflict:` y se espera a que el usuario decida

Por ejemplo:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: Manual de comunicaciones del X100 v3.2 p.12 (says 1)
  - Source: Guía de instalación del X100 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## Sincronizar con el servidor

Opcionalmente, la memoria del proyecto puede sincronizarse con el servidor de Confer (con un interruptor del usuario; por defecto manda lo local):

```bash
confer sync push    # sube el .claude/peers/ local
confer sync pull    # baja la última versión del servidor (escenario de trabajo en equipo)
```

El servidor la guarda en la tabla `project_memory` (véase `docs/04-data-model.md`).

Por qué manda lo local por defecto:
- la memoria del proyecto es información sensible (contiene decisiones internas)
- el almacenamiento local basta, y git ya resuelve la sincronización entre varias personas
- el servidor es solo una copia de seguridad y la comodidad de «leerlo desde otro dispositivo»

## Cómo se presentan las citas

Al generar código, Claude Code añade automáticamente comentarios de cita a los hechos que vienen de facts.md:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: Manual de comunicaciones del X100 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

Así el propio código lleva encima la cadena de pruebas de «por qué está escrito así».

## Privacidad y seguridad

- `.claude/` debería quedar fuera del `.gitignore` por defecto (es decir, entrar en git)
- pero los tokens de autenticación, las claves privadas y demás material sensible no se escriben nunca en `.claude/peers/`
- si `.claude/confer.toml` contiene un token, ese fichero se pone aparte en `.gitignore`
- si el historial de conversaciones contiene secretos, se redactan automáticamente y se deja constancia

## Criterios de aceptación

- [ ] al arrancar, Claude Code carga correctamente como contexto todos los `.claude/peers/*/facts.md`
- [ ] tras un `ask_peer`, facts.md queda actualizado en menos de un segundo
- [ ] el formato de fichero es legible para una persona y analizable por una máquina (sirve a las herramientas de ambos lados)
- [ ] el diff de git sobre el markdown se lee con claridad (nada de diffs tipo JSON)
- [ ] admite al menos 1000 hechos sin que el rendimiento se resienta
