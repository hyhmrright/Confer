# 自动备份与恢复验证

备份入口是 `infra/backup.sh`。适用于当前克隆仓库的 Docker Compose 部署，不需要给服务挂 Docker socket，不修改在线 `.env`，不新增数据库迁移。`npx confer-cli` 安装目录不含这些仓库脚本；需要在对应代码版本的 checkout 中配置本流程。

## 首次启用

仓库依赖安装完、网关按当前代码部署后，在仓库根目录运行：

```bash
./infra/backup.sh backup
./infra/backup.sh install
./infra/backup.sh status
```

`backup` 只有在实际隔离恢复验证成功后才报告成功。`install` 注册当前用户的 macOS LaunchAgent 或 Linux systemd user timer。程序每 15 分钟检查一次，以 **Asia/Shanghai 每天 03:00** 为备份日界线；机器休眠、重启或上次失败后会补跑当前备份日，不依赖宿主机时区。主机、Docker 和用户调度器必须可用。Linux 无登录运行需要管理员为该用户配置 linger。

默认保留最近 **7 份已验证备份**，失败的加密导出最多保留 2 份；新备份失败不会挤掉已有恢复点。可通过 `--keep 14` 调整，范围 1–365。手动执行也占一份，因此它是“份数”保留策略。

默认位置由 Compose 文件与 project 名称区分：

- 备份：`~/.local/share/confer/backups/<部署标识>/`
- 独立恢复密钥：`~/.config/confer/backup/<部署标识>.key`
- 完整路径和最近状态：`./infra/backup.sh status`

密钥随机生成，只在首次创建，不会自动覆盖；权限必须 0600。密钥不允许放进备份目录或代码 checkout，也不会打印到日志。**请将密钥单独离线保管，并把加密备份复制到另一块磁盘或异地。** 默认本机目录不能抵御整机/磁盘丢失。没有恢复密钥就无法解密。

可用自定义目标（例如外置磁盘或已挂载的远端存储）：

```bash
./infra/backup.sh backup --directory /Volumes/BackupDisk/confer --key /安全目录/confer.backup.key
./infra/backup.sh install --directory /Volumes/BackupDisk/confer --key /安全目录/confer.backup.key
```

自定义目录要求 0700；目录名不能含冒号或逗号。需要使用相同的 `--directory`、`--key` 参数查看状态或重新安装调度。Compose 文件与项目名可用 `--compose /路径/compose.yml --project 项目名` 指定。安装调度后移动 checkout、改变 Bun/Docker 可执行文件路径，需要重装调度。

## 备份内容与一致性

每份备份目录包含 AES-256-GCM 加密的以下内容，所有数据从流直接加密落盘，没有明文导出目录：

1. PostgreSQL `pg_dump --format=custom`：应用数据库，包含全部表、数据、序列和 Drizzle journal；不备份集群级其他数据库或角色。
2. Qdrant 每个 collection 的原生 snapshot、collection 配置与 payload 索引、aliases，并记录全部 point 的 ID、payload、**向量本身**的内容哈希。
3. 应用 S3 bucket 当前对象：文件原文、对象 key、元数据、大小与 SHA-256。当前应用未使用 S3 历史版本/自定义 bucket policy，本流程不复制这些外部设置。
4. 从**正在运行的网关容器**读取配置，不依赖当前终端或已经变更的 `.env`；通过临时进程的标准输入传递，不写明文配置文件。包括 `ENCRYPTION_KEY`、`JWT_SECRET`、签发者、实例身份地址、bucket 名、管理员配置和全局 Tavily/rerank 设置。用户的模型密钥、签名私钥、TOTP 等本来就在加密的数据库内，恢复时使用同一 `ENCRYPTION_KEY` 验证。
5. 网关、Postgres、Qdrant、SILO 的实际运行镜像：按不可变镜像 ID `docker save`、gzip 后加密。恢复不依赖旧镜像仍在本机或注册表仍可下载。前端无持久数据，可以从对应仓库版本重新构建。
6. 加密 manifest：格式版本、捕获时的 checkout commit、镜像 ID、文件校验和及逐表内容证明。镜像归档才是确切运行内容；checkout HEAD 不一定就是正在运行的镜像版本。

导出前，宿主通过容器内进程信号申请维护租约。公开 HTTP API 不能启动维护。网关拒绝新 HTTP 请求/WS 工作，已有 HTTP **响应体（含 SSE）**、客户端断开后仍未结束的 SSE writer、引导流程与 detached 后台任务全部结束后才允许备份。排空期间允许已有工作通过 loopback 完成同实例 A2A 后续调用（仍经过签名与权限验证），进入冻结阶段后全部拦住。120 秒内不能排空则失败并恢复服务，不强杀回答。

冻结应用写入后先导出数据库、向量和文件，再立即恢复访问；镜像打包与隔离恢复演练在恢复服务后进行。期间 API 返回 `503` 与 `Retry-After: 30`。这是应用级一致性边界，运维期间不要从网关外直接修改数据库、Qdrant 或 bucket。

网关重启、租约中断/换代或到期会使此次导出失效，不能发布为恢复点。宿主进程意外退出后，租约最多 15 分钟自动到期，不会永久锁住服务。备份有进程锁避免重叠，失效锁在后续运行时回收。

## 验证一份现有备份

```bash
./infra/backup.sh verify /完整路径/snapshot-时间-标识
# 使用非默认密钥时额外传 --key /安全目录/confer.backup.key
```

验证按顺序执行：

1. 先认证所有加密文件的 GCM tag、SHA-256 和大小，核对两份 manifest 一致，错误密钥、篡改、截断立即失败。
2. 检查 Docker archive 确实包含全部所需镜像，兼容经典 image store 与 containerd/OCI image store，然后加载镜像。按镜像 ID 保存，不覆盖现有镜像 tag。
3. 创建全新的 **internal Docker network** 和全新的 Postgres/Qdrant/SILO 容器，不映射端口，不挂载源数据库或数据卷。
4. 真正执行 `pg_restore --exit-on-error`、Qdrant snapshot upload 与 S3 回写；逐表行数/内容哈希、全部向量与 payload、collection 配置/索引、每个文件大小/内容/元数据逐项比对。
5. 尝试解密全部存储的模型/签名/TOTP/webhook/peer 凭据，并用恢复后的 JWT 配置调用真实应用的 health 与账号认证路由。
6. 记录 `verification.json`：验证时间、表/行/collection/point/对象和成功解密的凭据数量。无内容或密钥进入报告。成功和失败都清理演练容器及匿名卷；意外终止遗留的演练资源在超过两小时后由下次任务回收。

验证过程会实际导入整份数据，需要预留恢复副本和镜像归档的磁盘空间。原生 Qdrant snapshot 与运行镜像配套恢复，默认要求能够运行备份所含 CPU 架构的镜像。跨架构迁移需另行执行逻辑导出迁移流程。

`verify` 是可重复的隔离恢复演练，结束后销毁恢复副本。真实故障恢复应先在独立主机完成此验证，再按验证脚本的同一恢复路径恢复到新的服务/数据卷并切换入口；不要把现有在线卷当作演练目标。脚本没有“覆盖当前生产数据”的快捷参数。

## 调度与故障处理

`status.json` 记录最近成功恢复点和失败状态。任何导出、认证、恢复、比对或清理失败都会以非零状态退出；失败备份不会以 `snapshot-*` 的正式名称发布，已验证文件保留。`.partial-*` 是未发布的加密副本。

macOS：

```bash
# install 的输出给出实际 label 与 plist 路径
launchctl print gui/$(id -u)/io.confer.backup.<标识>
# 停止：bootout 相同 label，并删除 install 输出的 plist 文件
```

日志在备份目录 `scheduler.log`、`scheduler-error.log`。Linux 对应 `systemctl --user status io.confer.backup.<标识>.timer`、`journalctl --user -u io.confer.backup.<标识>.service`。停止可用 `systemctl --user disable --now <名称>.timer`。这些是主机本地调度，不是 GitHub Actions 或 Codex 提醒。

原始数据、密钥与离线副本的保管依然由实例所有者负责。备份报告可用于外部监控；本批没有配置邮件/消息通知或未指定目的地的云上传。

## 仓库验证

```bash
bun run test:setup
bun run test
# 单独构建候选镜像，不改动 :latest/:previous 回滚点
Docker_BUILDKIT=1 docker build -f infra/gateway.Dockerfile -t confer-backup-candidate:latest .
bun run backup:test:integration
```

CI 在原有 `test` job 内执行同一真实备份/恢复演练，没有新增 required check。集成演练使用独立 Compose project、正常注册账号、测试文档/记忆/密钥，覆盖完整恢复、错误密钥/篡改拒绝及导出失败后服务恢复，不接触开发/测试/生产库。

Qdrant 原生恢复行为依照 [snapshot upload API](https://api.qdrant.tech/api-reference/snapshots/recover-from-uploaded-snapshot)，同时以实际 point/向量逐项恢复验证为验收依据。
