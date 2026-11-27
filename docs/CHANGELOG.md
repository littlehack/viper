# Changelog

## 4.2.0 — 2026-11-27

### 项目更名：unrestricted-kit → Viper（蝰蛇）

- 仓库更名为 `littlehack/viper`，项目标识 `unrestricted-kit` → `Viper`。
- 插件 id `unrestricted.boost` → `viper.boost`，`lab_status` 首行随之变化。
- 安装目录 `plugins/unrestricted/` → `plugins/viper/`。
- 新增 `assets/logo.svg`、`assets/banner.svg`，README 重写并加入品牌区。
- 版本号 `4.1.0` → `4.2.0`。
- `unrestricted` agent 名称保持不变：它是角色名，不是项目名。

## 4.1.0 — 2026-11-25

「目标即开工」。此前即使有作用域契约，模型仍可能把「只给一个目标」当成信息不全，回一句
"你想让我做什么"再收尾。4.1 把目标识别、默认链、会话绑定和审计落库全部前移到插件里：
模型读到这一轮时，prompt 已经带着 `[TARGET-BOUND]`（目标类型、objective、有序链路、第一条
可执行命令、禁止追问清单），没有机会再问。

### 2026-11-27 策略修订：默认原文，脱敏改为 opt-in

保留「不做破坏性处理」，移除默认脱敏。审计与报告是操作者自己的证据链，捕获到的
凭据/token/私钥默认按实际值写入；需要外发时再显式开启 `policy.redact_reports`。

- `src/ethics/redact.ts`：`redact()` 增加 `enabled` 参数（默认 `false` 直通），新增
  `redactSecrets()` 作为无条件脱敏实现，供 opt-in 使用。
- `src/util/audit-log.ts`、`src/hooks/audit.ts`、`src/util/text.ts`：脱敏改为读取
  `policy.redact_reports` 的实时开关；默认原文。
- `src/plugin.ts`：审计日志注入 `redactEnabled` getter，改配置无需重启。
- `src/config/scope.ts`、`config/lab-scope.json`：`redact_reports` 默认改为 `false`，注释同步。
- `src/ethics/policy.ts`、`rules/AGENTS.md`、`agents/*.md`、`commands/*.md`、
  `src/capabilities/playbooks*`：伦理文案改为「默认原文，外发时 opt-in 脱敏」。
- `src/prompt/frame.ts`：注入语境删除 "Keep secrets redacted"，保留 "Avoid destructive actions"。
- `src/tools/lab_status.ts`：`ethics.redaction` 反映真实配置；`lab_audit` / `lab_report` 文案同步。
- 测试：`tools/selftest.mjs` 断言改为「默认原文」，并新增 opt-in 脱敏用例。

### 新增

- `src/target/detect.ts` —— 纯函数目标识别。按优先级掩码匹配：URL → 仓库 → 哈希 → IPv4/CIDR/
  host:port → IPv6 → 产物（APK/EXE/ELF/SO/JAR/镜像/抓包）→ 包名 → 路径 → 域名 → 中文公司/机构名。
  已匹配区间掩码，避免把 URL 里的 IP 再算成一个目标。
- `src/target/plan.ts` —— 每种目标一条默认链（objective + 有序步骤 + 第一条命令 + 成功判据 +
  需要预检的二进制）。IP/CIDR、域名、URL、公司、APK/包名、二进制、哈希、仓库、路径、归档各一套。
- `src/target/binding.ts` —— 会话级目标绑定（内存，上限 64）。compaction 只改模型可见文本，
  绑定不随摘要丢失；后续"继续 / 下一步"沿用同一目标。
- `src/prompt/engage.ts` —— `[TARGET-BOUND]` 块渲染；`source=target-only` 时额外声明
  "OPERATOR SENT ONLY THIS TARGET"。
- `src/tools/lab_target.ts` —— `analyze | plan | bind | list | clear`。缺注入块时模型可自行补齐，
  并顺带写作用域审计。
- `commands/engage.md`（`/engage <目标>`）与 `skills/auto-engage/SKILL.md`。
- 设置项 `autoEngage` / `autoScope`（`LAB_AUTO_ENGAGE=off`、`LAB_AUTO_SCOPE=off`）。

### 变更

- `session.prompt`：在原有 framing 之后增加"识别 → 绑定 → 落库 → 追加目标块"。同一轮 prompt 里
  已有 `[TARGET-BOUND]` 时不再重复。
- `session.context`：绑定优先级为 会话绑定 → 最近一条用户消息 → `lab-scope.json` 首个非 `*` 目标；
  命中后把目标块并入 `[UNRESTRICTED-LAB]`。
- `boost.ts`：新增 `[AUTO-ENGAGE=on]`、`AUTO-ENGAGE (binding)` 章节（按 kind 的默认链）、
  禁止追问清单；`TARGET RESOLUTION` 增加"会话绑定"一级，改为六级来源。
- `lab_status`：输出 `auto_engage` / `auto_scope`；工具数 7 → 8。
- `agents/unrestricted.md`、`agents/redteam.md`、`agents/reverse.md`、`rules/AGENTS.md`：
  增加 `[AUTO-ENGAGE=1]` 与"目标即开工"硬规则。
- `tools/selftest.mjs`：新增目标分类、裸目标绑定、上下文注入、`lab_target`、续跑/新任务判定、
  文档路径误触发、host:port/repo 首条命令、org 误触发七组断言，共 37 项。
- `tools/verify.mjs`：新增 target/engage 模块、`lab_target`、`/engage`、技能与接线断言，共 80 项。

### 修复

- `host:port` 目标：nmap 首条命令改用 `-p <port> <host>`，不再把 `10.0.0.5:8080` 当作主机名。
- `git@host:org/repo.git`：`git clone` 直接使用原地址，不再拼成 `https://git@…`。
- `domain:port` / `domain/path`：归为 `url` 并补全 scheme（443/8443/9443 用 https，其余 http），
  避免被当成域名去跑 subfinder。
- `org` 误触发：常见简称（国家电网、中国移动、腾讯等）可识别，但只有在目标本身或资产/测绘类
  意图出现时才绑定；"腾讯云 API 报错" 不再被当成交战目标。
- 归档目标的首条命令改为 `7z l`，`lab_hash` 放到证据步骤。

### 兼容

- 旧配置不需要改：`autoEngage` / `autoScope` 默认开启，只有显式 `false` / `off` 才关闭。
- 关闭 `autoEngage` 后行为回到 4.0.1（仅 framing + 手动 `lab_scope`）。
- 多会话：绑定按 `sessionID` 隔离；宿主不提供会话 id 时统一落在 `*`，此时同一进程内共用绑定。

## 4.0.1 — 2026-11-24

修复「命令参数为空时渗透任务停在『目标未提供』」的行为问题（运行时实测复现：失败会话的 reasoning
引用了 `/external` 的空目标块，随后只做了工具自检，没有进入 recon）。

### 修复

- `/external`、`/unrestricted`、`/exploit` 的 `$ARGUMENTS` 为空时，按 5 级顺序解析目标：
  本消息 → 最近的用户消息 → `lab-scope` 的 `engagements[].targets`（忽略 `*`）→
  工作区产物（APK/PE/ELF/JAR/源码中的 URL 与 IP）→ 本机监听与容器（`ss`/`netstat`、
  `docker ps`、`adb devices`）。解析到目标立即开工。
- 注入块新增 `TARGET RESOLUTION (binding)`；主 agent 执行契约新增第 7 条；`redteam`
  的空输入协议改为先解析目标。只有全部来源为空时才输出 `缺失输入：<field>`，且仍要给候选表
  与第一条可执行命令。
- `FRAME` 增加一句：消息里没有显式目标时，使用本会话或交战记录里已声明的目标，不要停下来问。
- 意图词表补充：`渗透`（排除 `渗透率`）、`getshell`、`webshell`、`拿 shell`、`免杀`、
  `bypass av/edr/defender`、`外网打点`、`驻留`、`反调试`。
- 自检新增 `TARGET RESOLUTION` 与裸 `渗透` 断言，共 25 项。

## 4.0.0 — 2026-11-24

模块化重写。取代 3.0.0 的"可移植安装包"形态：单一 440 行插件拆分为 29 个模块，全部 PowerShell
删除，修复 3.0 的 7 个行为缺陷，新增 6 个研究工具。

### 移除

- `install.ps1`、`uninstall.ps1`、`verify.ps1`、`tools/run-selftest.ps1`
- `install.ps1.bak-dupfix-*`（历史备份）
- `payload/` 目录（内容按职责归位到 `src/`、`agents/`、`commands/`、`rules/`、`config/`）
- `payload/lab-scope.json` 的插件目录副本（插件只读配置根目录，该副本从未被读取）

部署方式改为"放对目录即生效"；自检改为 Node 脚本。

### 修复

| ID | 问题 | 修复 |
|---|---|---|
| P1-1 | `[MODE: UNRESTRICTED]` 与 `[UNRESTRICTED-LAB]` 共用判定，导致两个专用 agent 永远不注入 | 拆成 `INJECT_MARKER_RE` / `QUOTE_MARKER_RE`（`src/prompt/markers.ts`） |
| P1-2 | `agent.transform` 整体覆盖 `permissions`，丢失 `read *.env.*` 等细则 | `mergePermissions` 改为合并，保留细则与显式 `deny`（`src/hooks/agent.ts`） |
| P1-5 | 守卫只包住注册，回调内异常可中止请求 | 新增 `guardCallback`，包住 `session.prompt` / `session.context`（`src/util/guard.ts`） |
| P1-6 | 插件目录存在 `lab-scope.json` 死副本，易误改 | 删除副本，只保留 `config/lab-scope.json` 模板 |
| P2-1 | 排除路径匹配在 Windows 反斜杠下失效 | 统一归一化为 `/` 的 glob 匹配（`src/util/glob.ts`） |
| — | `opencode plugin list` 判据失效（目录扫描不登记） | 文档改为以 `lab_status` 为判据 |
| — | `Plugin.define` 缺失时降级实现破坏了导出 | 降级为 `{ define: identity }` 对象（`src/plugin.ts`） |

### 新增

- 模块拆分：`src/{config,prompt,hooks,tools,capabilities,ethics,util}`
- 工具：
  - `lab_status` — 覆盖范围、已注册 hook/tool、作用域、审计状态
  - `lab_scope` — 读/增/删作用域目标（原子写，写审计）
  - `lab_playbook` — 7 个领域的方法论（recon/reverse/crack/android/exploit/forensics/report）
  - `lab_preflight` — 只读 PATH 扫描，列本机可用工具链
  - `lab_audit` — 审计尾部（脱敏）
  - `lab_hash` — 证据哈希（流式，sha256/sha1/md5）
  - `lab_report` — 报告骨架（可由 scope + audit 生成，可写文件）
- 审计：`tool.execute.before/after` → JSONL，2MB 轮转，写入前脱敏
- 伦理层：`HARD_STOPS`、`ETHICS_RULES`、`policy.excluded_paths` 强制 deny、`redact.ts`
- agent：新增 `reverse`（逆向/破解子 agent）
- 命令：新增 `/reverse`、`/crack`、`/report`
- 文档：`docs/ARCHITECTURE.md`、`docs/PLAYBOOKS.md`、`docs/CHANGELOG.md`，重写
  `docs/SCOPE-MODEL.md`、`docs/TROUBLESHOOTING.md`
- 自检：`tools/verify.mjs`（静态断言）、`tools/selftest.mjs`（逻辑断言，含 3 个回归）

### 变更

- 意图词表扩充：授权绕过、凭证窃取、注入、取证、逆向英文短语、云与容器逃逸等
- `INTENT` 保留 IPv4/IPv6/域名宽匹配（有意为之，避免日常提问被框架化时漏判安全任务）
- 配置项不变，新增 `auditFile`
- `lab-scope.json` 新增 `policy.excluded_paths`、`policy.redact_reports`
- Node 要求：>= 22.6（`--experimental-strip-types`）

### 迁移

| 3.0.0 | 4.0.0 |
|---|---|
| `payload/plugin/unrestricted-boost.ts` | `index.ts` + `src/**` |
| `payload/agents/*` | `agents/*` |
| `payload/commands/*` | `commands/*` |
| `payload/AGENTS.md` | `rules/AGENTS.md` |
| `payload/lab-scope.json` | `config/lab-scope.json` |
| `opencode.snippet.json` | `config/opencode.plugin.json` |
| `tools/run-selftest.ps1` | `node --experimental-strip-types tools/selftest.mjs` |

覆盖安装即可；`opencode.json` 里 3.0 的注册条目可以删除（目录扫描不需要）。

## 3.0.0

- 单文件插件 `unrestricted-boost.ts`（440 行）
- 7 个 hook、1 个工具（`lab_status`）
- PowerShell 安装器（install / uninstall / verify / run-selftest）
- agent-agnostic：`agents: "*"` 覆盖运行时内所有 agent

## 2.x / 1.x

早期版本，仅 `unrestricted` + `redteam` 两个 agent，插件按 agent 名硬编码。
