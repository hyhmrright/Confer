---
name: reset-user-password
description: Reset a user's password in the production database (break-glass — no self-service reset endpoint exists). User-invoked only.
disable-model-invocation: true
---

破窗操作：直接重置生产库中某个用户的密码。Confer **没有自助/管理员密码重置端点**，密码以 Argon2id 哈希存于 `users.password_hash`。此 skill 把已验证的手动流程固化下来，避免每次临场摸索。

**前置说明（已踩过的坑）**
- 生产库角色是 `confer`（不是默认 `postgres`），库名也是 `confer`，见 `docker-compose.prod.yml`。
- gateway 容器跑 **Bun**，而 `bun -e`/eval 上下文无法解析 node_modules import；可行办法是**写一个真实的 `.cjs` 文件、用绝对路径 `require()` argon2**，再用 bun 执行。
- `argon2.verify(hash, password)` 从哈希串自带的参数解码校验，所以只要用容器里的 argon2 生成一个合法 Argon2id 哈希即可，无需手工对齐 m/t/p 参数。

**步骤**

1. 确认目标用户名与新密码（与用户口头确认，**切勿**把密码写进会被记录的命令日志/提交里）。先核对账号存在：
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     psql -U confer -d confer -c \
     "select id, username, role from users where username = '<USERNAME>';"
   ```

2. 在 gateway 容器内生成 Argon2id 哈希（真实 `.cjs` 文件 + 绝对路径 require，避开 Bun eval 限制）。先用 `read -rs` 把新密码读入环境变量——**不回显、不进 shell 历史、不出现在命令行 argv**，后续步骤复用同一 `$NEWPW`：
   ```bash
   read -rs NEWPW   # 输入新密码后回车（终端不回显）
   docker compose -f docker-compose.prod.yml exec -e NEWPW="$NEWPW" gateway sh -c '
     cat > /tmp/hash.cjs <<EOF
   const argon2 = require(process.cwd() + "/node_modules/argon2/argon2.cjs");
   argon2.hash(process.env.NEWPW).then((h) => process.stdout.write(h));
   EOF
     bun /tmp/hash.cjs; echo; rm -f /tmp/hash.cjs'
   ```
   若 `node_modules/argon2/argon2.cjs` 不在 WORKDIR 下，先 `docker compose -f docker-compose.prod.yml exec gateway sh -c 'pwd; ls node_modules/argon2/argon2.cjs'` 找到实际绝对路径再代入 `require(...)`。复制输出的完整哈希串（`$argon2id$v=19$m=...`）。

3. 写回数据库（用步骤 2 的哈希串）：
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     psql -U confer -d confer -c \
     "update users set password_hash = '<HASH>' where username = '<USERNAME>';"
   ```
   确认返回 `UPDATE 1`。

4. 验证：复用步骤 2 的 `$NEWPW`（同一 shell 会话）登录，应返回 HTTP 200。用 `jq` 构造 body 以正确转义、且不把明文写进命令：
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d "$(jq -nc --arg u '<USERNAME>' --arg p "$NEWPW" '{username:$u, password:$p, device_id:"reset-check"}')"
   ```
   （登录需要 `device_id`；具体字段以 `packages/gateway/src/routes/auth.ts` 的登录 schema 为准。）

5. 清理：步骤 2 已 `rm` 容器内临时文件；`unset NEWPW` 清掉会话变量。密码全程经 `read -rs` + 环境变量传递、未出现在任何命令行 argv，shell 历史里不会留明文。

**注意**：这是手动破窗流程，仅供运维临时使用；长期应做成管理员 API 端点（见项目记忆中的待办）。
