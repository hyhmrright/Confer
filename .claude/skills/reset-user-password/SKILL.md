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

2. 在 gateway 容器内生成 Argon2id 哈希（真实 `.cjs` 文件 + 绝对路径 require，避开 Bun eval 限制）。用 `read -rs` 读入新密码（不回显、不进 shell 历史），再经 **stdin 管道**送进容器——`printf` 是 shell 内建，密码不进任何进程的 argv（`ps`/`/proc` 都看不到）。**不要**用 `-e NEWPW="$NEWPW"`：那会把明文塞进 `docker` 的 argv：
   ```bash
   read -rs NEWPW   # 输入新密码后回车（终端不回显）
   printf '%s\n' "$NEWPW" | docker compose -f docker-compose.prod.yml exec -T gateway sh -c '
     IFS= read -r PW; export PW
     cat > /tmp/hash.cjs <<EOF
   const argon2 = require(process.cwd() + "/node_modules/argon2/argon2.cjs");
   argon2.hash(process.env.PW).then((h) => process.stdout.write(h));
   EOF
     bun /tmp/hash.cjs; echo; rm -f /tmp/hash.cjs'
   ```
   （`-T` 关闭 TTY 分配，否则管道 stdin 进不去；容器内 `read` 收下密码、`export PW` 只进环境不进 argv。）若 `node_modules/argon2/argon2.cjs` 不在 WORKDIR 下，先 `docker compose -f docker-compose.prod.yml exec gateway sh -c 'pwd; ls node_modules/argon2/argon2.cjs'` 找到实际绝对路径再代入 `require(...)`。复制输出的完整哈希串（`$argon2id$v=19$m=...`）。

3. 写回数据库（用步骤 2 的哈希串）。Argon2id 哈希含大量 `$`（`$argon2id$v=19$m=...`），**绝不能**粘进双引号 SQL——bash/sh 会把 `$argon2id`/`$v`/`$m` 当变量展开成空，写入残缺串、账号锁死，而 psql 照样返回 `UPDATE 1`（zsh 会掩盖此坑，prod 操作员在 bash/sh 上必中）。用单引号赋值保字面量 + psql 变量安全引用 `:'...'`：
   ```bash
   HASH='<粘贴步骤2的完整哈希>'   # 单引号：$ 全部保持字面量，不被 shell 展开
   docker compose -f docker-compose.prod.yml exec postgres \
     psql -U confer -d confer \
     -v h="$HASH" -v u='<USERNAME>' \
     -c "update users set password_hash = :'h' where username = :'u';"
   ```
   （`"$HASH"` 传的是变量值、不会二次展开；`:'h'` 是 psql 服务端安全引用。）确认返回 `UPDATE 1`。

4. 验证：复用步骤 2 的 `$NEWPW`（同一 shell 会话）登录，应返回 HTTP 200。让 jq 从环境读密码（`env.NEWPW`，不进 argv），再把 body 经管道交给 curl（`--data @-` 从 stdin 读，不进 argv）——明文不出现在 jq / curl 的命令行：
   ```bash
   export NEWPW
   jq -nc --arg u '<USERNAME>' '{username:$u, password:env.NEWPW, device_id:"reset-check"}' \
     | curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost/api/v1/auth/login \
         -H 'Content-Type: application/json' --data @-
   ```
   （登录需要 `device_id`；具体字段以 `packages/gateway/src/routes/auth.ts` 的登录 schema 为准。）

5. 清理：步骤 2 已 `rm` 容器内临时文件；`unset NEWPW` 清掉会话变量。密码全程经 `read -rs` 读入、stdin 管道（步骤 2）/ jq `env.NEWPW`（步骤 4）传递，**从不进入任何进程的 argv**（`ps`/`/proc/<pid>/cmdline` 都看不到），shell 历史里也不留明文。注：写库的哈希串（单向 Argon2、非明文）会进 psql 的 argv，可接受——它本就要落库。

**注意**：这是手动破窗流程，仅供运维临时使用；长期应做成管理员 API 端点（见项目记忆中的待办）。
