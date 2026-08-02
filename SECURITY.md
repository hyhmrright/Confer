# Security policy

## Supported versions

Confer is pre-1.0. Only the latest released version receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅ |
| < 0.3   | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/hyhmrright/Confer/security/advisories/new).
If that is unavailable to you, email **hyhmrright@gmail.com** with `[Confer security]` in
the subject.

Please include:

- What the issue is and which component it affects (gateway, client, identity, MCP plugin)
- Steps to reproduce, or a proof of concept
- The version or commit you tested against
- Any deployment specifics that matter (self-hosted, Docker, reverse proxy)

You can expect an acknowledgement within 72 hours and a status update within 7 days.
Once a fix ships, you will be credited in the release notes unless you ask otherwise.

## Scope

Confer is a self-hosted, federated system. The following are in scope:

- **A2A endpoints** (`/a2a/v1/*`) — HTTP signature verification bypass, DID spoofing,
  replay attacks
- **Cross-tenant isolation** — any path where one user or peer can read or write another
  owner's conversations, messages, memories, or knowledge base
- **Authentication** — JWT handling, refresh token rotation, session revocation
- **Secret handling** — LLM/embedding API keys are AES-256-GCM encrypted at rest and must
  never reach the client
- **Permission model** — L1/L2/L3 gates, especially anything that lets an L3 action run
  without explicit approval
- **SSRF** — DID resolution and outbound fetches must not reach private/reserved addresses

Out of scope: findings that require an already-compromised host, social engineering of
instance operators, and issues in an operator's own misconfiguration (for example, running
with the `.env.example` default secrets in production — see
[`docs/09-deployment.md`](./docs/09-deployment.md)).

## Hardening notes for operators

If you self-host a public instance:

- Change `JWT_SECRET` and `ENCRYPTION_KEY` from their example values before exposing the
  instance. Rotating `ENCRYPTION_KEY` invalidates stored API keys.
- Terminate TLS in front of the gateway. HTTP signatures authenticate peers, not transport.
- Set `ADMIN_USERNAMES` to accounts you control, and close registration
  (`registration_open`) once your users have signed up.
- Keep the instance updated — cross-tenant authorization fixes shipped as recently as
  v0.3.1.
