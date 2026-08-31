# Confer — Memória de projeto (.claude/peers/)

Define o formato de arquivo com que o conhecimento se deposita no projeto sob a integração com o Claude Code. É uma das inovações centrais do Confer: **fazer o conhecimento do fornecedor viajar junto com o projeto, sem se perder entre sessões, entre pessoas ou entre máquinas**.

## Estrutura de diretórios

Na raiz de cada projeto:

```
.claude/
├── confer.toml                   # configuração do projeto (peers, níveis de confiança)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # fatos verificados, estruturados
    │   ├── decisions.md          # registro das decisões de desenho
    │   ├── conversations/        # histórico completo de conversas
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # trechos de código
    │   │   └── read_temp.py
    │   └── meta.json             # metadados do peer
    └── internal-sdk/
        ├── facts.md
        └── ...
```

Viaja junto com o git, e todos os colaboradores compartilham.

## Formato dos arquivos

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

Uma lista estruturada de fatos. **Cada fato precisa trazer sua citação**: um «fato» sem citação é alucinação.

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
  - Source: Manual de comunicação do X100 v3.2 p.87
  - Source: Guia de instalação do X100 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: Manual de instalação do X100 v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: Manual de comunicação do X100 v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

Convenções de formato:

- os temas se separam por títulos markdown de segundo nível (`##`)
- cada fato é um item de lista
- os valores-chave se destacam em `**negrito**`
- ao fim de cada grupo de fatos tem de haver uma linha `Source:` e um carimbo `Verified:`
- várias fontes se anotam em várias linhas `Source:`

### `decisions.md`

As decisões de desenho tomadas no projeto que dizem respeito a este peer. Diferentemente dos facts (conclusões com a autoridade do fabricante), as decisions são escolhas nossas.

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

Convenções de formato:

- cada decisão tem um identificador único (`D1`, `D2`, …)
- campos obrigatórios: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- é preciso listar as alternativas consideradas
- é preciso remeter de volta aos facts e ao código correspondentes

### `conversations/{date}-{slug}.md`

O histórico completo de conversas. O Confer arquiva aqui cada fio automaticamente.

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
Preciso integrar o X100 por Modbus: 4 canais de temperatura e 4 de pressão, com varredura.

## ABC Agent
Mapa de registradores do Modbus RTU:
- 0x40–0x47 temperatura (4 canais)
- 0x48–0x4F pressão (4 canais)
Recomendo ciclo de varredura de 200 ms e o código de função 0x03 para a leitura contínua.

📎 Source: Manual de comunicação do X100 v3.2 p.87

## laowang
A leitura contínua traz problema de desempenho? O dispositivo escravo trava?

## ABC Agent
Ler 8 registradores seguidos é uma única requisição, então não trava. Mas atenção: o slave ID padrão é 0x0A (10), não 1; o manual antigo está errado.

📎 Source: Guia de instalação do X100 p.12, FAQ #4
```

### Convenções de nome de arquivo

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: nomeados pelo uso, com a extensão da linguagem

## Fluxos de escrita e leitura

### Caminho de escrita

```
chama-se ask_peer →
  a nuvem do Confer devolve a resposta →
  o servidor MCP extrai os fatos estruturados →
  acrescenta-os ao facts.md local (se forem fatos novos)
  acrescenta a conversa completa a conversations/
  atualiza meta.json
  dica de commit local: sugerir ao usuário git add .claude/peers/{slug}/
```

### Caminho de leitura

```
inicia-se uma sessão do Claude Code →
  varre-se .claude/peers/*/ →
  o facts.md de cada peer é entregue ao Claude Code como parte do prompt de sistema →
  o Claude Code cita esses fatos com naturalidade enquanto escreve código
```

### Tratamento de conflitos

Se um mesmo fato for verificado várias vezes:

- vence a verificação mais recente
- se o resultado novo contradiz o antigo, **não se sobrescreve direto**: acrescenta-se uma marca `⚠️ Conflict:` e espera-se a decisão do usuário

Por exemplo:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: Manual de comunicação do X100 v3.2 p.12 (says 1)
  - Source: Guia de instalação do X100 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## Sincronizar com o servidor

Opcionalmente, a memória do projeto pode ser sincronizada com o servidor do Confer (com uma chave do usuário; por padrão o local tem precedência):

```bash
confer sync push    # envia o .claude/peers/ local
confer sync pull    # puxa a versão mais recente do servidor (cenário de trabalho em equipe)
```

No servidor, guarda-se na tabela `project_memory` (veja `docs/04-data-model.md`).

Por que o local tem precedência por padrão:
- a memória do projeto é informação sensível (contém decisões internas)
- o armazenamento local basta, e o git já resolve a sincronização entre várias pessoas
- o servidor é apenas backup e a comodidade de «ler de outro dispositivo»

## Como as citações aparecem

Ao gerar código, o Claude Code acrescenta automaticamente comentários de citação aos fatos vindos de facts.md:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: Manual de comunicação do X100 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

Assim o próprio código carrega a cadeia de provas do «por que está escrito assim».

## Privacidade e segurança

- `.claude/` deve ficar fora do `.gitignore` por padrão (ou seja, entrar no git)
- mas tokens de autenticação, chaves privadas e afins nunca se escrevem em `.claude/peers/`
- se `.claude/confer.toml` tiver um token, esse arquivo vai separado para o `.gitignore`
- se o histórico de conversas contiver segredos, eles são redigidos automaticamente e assinalados

## Critérios de aceitação

- [ ] ao iniciar, o Claude Code carrega corretamente todos os `.claude/peers/*/facts.md` como contexto
- [ ] depois de um `ask_peer`, o facts.md fica atualizado em menos de um segundo
- [ ] o formato de arquivo é legível por gente e analisável por máquina (serve às ferramentas dos dois lados)
- [ ] o diff do git sobre o markdown se lê com clareza (nada de diff no estilo JSON)
- [ ] comporta pelo menos 1000 fatos sem prejudicar o desempenho
