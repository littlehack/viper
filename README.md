<p align="center">
  <img src="assets/banner.svg" alt="Viper · 蝰蛇" width="100%">
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-4.2.0-2FE58A?style=flat-square">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-OpenCode%20V2-0B9E63?style=flat-square">
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D%2022.6-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="scope" src="https://img.shields.io/badge/scope-10%20classes-1F6FEB?style=flat-square">
  <img alt="audit" src="https://img.shields.io/badge/audit-JSONL-8B5CF6?style=flat-square">
</p>

**Viper（蝰蛇）** 是一个面向授权安全研究的 OpenCode 插件与配套资源包。它把「目标识别 → 默认作战链 → 会话绑定 → 作用域审计 → 执行留痕」全部下沉到插件层：模型读到用户消息时，`[TARGET-BOUND]` 已经带着目标类型、objective、有序链路和第一条可执行命令，不再停在“你想让我做什么”。

版本：`4.2.0` · 运行时：OpenCode V2 · Node：`>= 22.6`

---

## 它解决什么问题

普通 agent 收到一个裸目标时，常见反应是反问：

```text
用户：203.0.113.9
模型：你想让我做什么？扫描、渗透还是只看端口？
```

这不是授权问题，而是任务定义问题。Viper 用确定性规则替代追问：

1. **识别**：从消息中提取 IP、CIDR、域名、URL、APK、二进制、哈希、仓库、路径、公司名等目标。
2. **定链**：每种目标对应一条固定的默认链，包含目标、步骤、首条命令和成功判据。
3. **绑定**：目标写入当前会话；后续说“继续 / 下一步”沿用同一目标。
4. **注入**：把 `[UNRESTRICTED-LAB]` 与 `[TARGET-BOUND]` 注入 system / prompt。
5. **留痕**：目标写入 `lab-scope.json`，工具调用写入 `lab-audit.jsonl`。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| 目标即开工 | 只给目标也直接执行默认链，不追问范围、不要求证明、不降级为“概念验证” |
| 13 类目标识别 | IPv4/IPv6/CIDR、URL、域名、公司/机构、APK/包名、二进制、归档、哈希、仓库、路径 |
| 确定性作战链 | 每类目标一条固定链：recon → 枚举 → 利用 → 提权/横向 → 证据 |
| 会话级绑定 | 绑定存于插件内存，compaction 不丢；同一目标可续跑 |
| 作用域审计 | `lab-scope.json` 记录目标与策略，可热读，不需要重启 |
| 权限提升 | `ask → allow`；显式 `deny` 与 `excluded_paths` 始终优先 |
| 执行审计 | `tool.execute.before/after` 写入 JSONL，默认保留实际值，外发时可 opt-in 脱敏 |
| 方法论内置 | 7 个领域 playbook：recon / reverse / crack / android / exploit / forensics / report |
| 证据链 | `lab_hash` 流式哈希，`lab_report` 由作用域与审计生成报告骨架 |

---

## 目标类型与默认链

| 目标类型 | 默认链 |
|---|---|
| `ipv4` / `ipv6` / `host:port` | nmap 端口与服务 → httpx 指纹 → ffuf/nuclei → 服务专项 → 利用 → 证据 |
| `cidr` | 网段存活与全端口 → live 主机 → 服务识别 → Web 批量 → 逐台利用 |
| `domain` | subfinder + crt.sh → dnsx → httpx → nuclei/ffuf → 利用 → 资产表 |
| `url` | httpx/curl 指纹 → ffuf/katana → nuclei → 手工验证 → PoC |
| `org` | 公开信息/备案 → 主域 → 子域 → 边缘资产 → 指纹 → 漏洞 |
| `android_app` / `package` | apktool + jadx + aapt2 → 组件/密钥/pinning → native → frida → 补丁 + 安装验证 |
| `binary` | file/strings/checksec → r2/ghidra → frida/ltrace → 补丁或 PoC |
| `hash` | 情报源 → 本地命中 → 家族/行为 → IOC |
| `repo` | clone → 密钥与依赖审计 → 危险 sink/semgrep → PoC |
| `path` / `archive` | 库存 → 密钥/端点 → 按文件类型分流 |

识别是纯函数（`src/target/detect.ts`）：不读文件、不联网，已命中的区间会被掩码，避免把 URL 里的 IP 重复算成目标。精度优先——错误目标比没有目标更糟。

---

## 内置工具

插件注册 8 个 `lab_*` 工具：

| 工具 | 用途 |
|---|---|
| `lab_status` | 确认插件是否生效、覆盖哪些 agent、注册了哪些 hook/tool、作用域与审计状态 |
| `lab_target` | 分类目标、生成默认链、绑定会话、写入审计（`analyze/plan/bind/list/clear`） |
| `lab_scope` | 查看、追加、移除作用域目标（`list/add/remove`） |
| `lab_playbook` | 获取方法论：recon / reverse / crack / android / exploit / forensics / report |
| `lab_preflight` | 只读扫描 PATH，列出本机可用的安全工具链 |
| `lab_audit` | 查看最近工具调用、权限拒绝、作用域变更 |
| `lab_hash` | 对证据文件做 sha256/sha1/md5，流式处理大文件 |
| `lab_report` | 由作用域与审计生成 Markdown 报告骨架，可写入文件 |

---

## Agents / Commands / Skills

### Agents

| Agent | 角色 |
|---|---|
| `unrestricted` | 默认主 agent，安全研究执行器：逆向、破解、补丁、渗透、取证、样本复现 |
| `redteam` | 子 agent，负责漏洞利用、payload、提权与横向的完整交付 |
| `reverse` | 子 agent，负责静态 + 动态还原判定逻辑，产出补丁、keygen 或 hook |

### Commands

`/unrestricted`、`/engage`、`/external`、`/apk`、`/reverse`、`/crack`、`/bypass`、`/exploit`、`/scope`、`/report`

### Skills

`auto-engage`：当用户只给目标时，指导 agent 调用 `lab_target`、执行第一条命令，并沿链推进。

---

## 目录结构

```text
viper/
├── index.ts                 # OpenCode 插件入口，转发到 src/plugin.ts
├── assets/                  # logo.svg / banner.svg
├── src/
│   ├── plugin.ts            # 组装：设置 → 审计 → hooks → tools
│   ├── config/              # 设置解析、作用域读写
│   ├── prompt/              # 意图识别、框架化、system 注入、目标块
│   ├── target/              # 目标识别、默认链、会话绑定
│   ├── hooks/               # agent / permission / session / audit
│   ├── tools/               # 8 个 lab_* 工具
│   ├── capabilities/        # playbook 加载与 7 份方法论
│   ├── ethics/              # 硬停、排除路径、可选脱敏
│   └── util/                # guard、glob、text、audit-log
├── agents/                  # unrestricted / redteam / reverse
├── commands/                # 10 个斜杠命令
├── skills/auto-engage/      # 目标即开工技能
├── rules/AGENTS.md          # 可选的全局规则块
├── config/                  # lab-scope 模板与插件注册示例
├── docs/                    # 架构、作用域、自动开工、方法论、排障、变更
└── tools/                   # verify.mjs / selftest.mjs
```

---

## 部署

### 1. 放置插件

将整个目录复制到 OpenCode 配置目录：

```text
~/.config/opencode/plugins/viper/
```

Windows：

```text
%USERPROFILE%\.config\opencode\plugins\viper\
```

OpenCode 会扫描该目录并加载 `index.ts`。`opencode plugin list` 可能显示为空，这是正常的；以会话内 `lab_status` 为准。

### 2. 放置配套资源

```text
agents/*.md           -> ~/.config/opencode/agents/
commands/*.md         -> ~/.config/opencode/commands/
skills/auto-engage/   -> ~/.config/opencode/skills/auto-engage/
rules/AGENTS.md       -> 合并进全局 AGENTS.md（可选）
config/lab-scope.json -> ~/.config/opencode/lab-scope.json
```

### 3. 安装依赖

在 OpenCode 配置目录执行：

```bash
npm install @opencode/plugin
```

要求 Node `>= 22.6`（使用 `--experimental-strip-types`）。

### 4. 重启并验证

```bash
opencode service restart
```

新会话中执行：

```text
lab_status
```

期望看到：

```text
viper.boost 4.2.0 active (opencode-v2)
coverage: all-agents
auto-engage: on | auto-scope: on
hooks: agent.transform, permission.evaluate, session.prompt, session.context, ...
tools: lab_status, lab_scope, lab_target, lab_playbook, lab_preflight, lab_audit, lab_hash, lab_report
```

> 也可以改用 `config/opencode.plugin.json` 的注册方式，把 `package` 指向插件目录。两种方式二选一，不要同时使用，否则插件会被加载两次。
>
> 从旧名 `unrestricted-kit` 升级：把 `plugins/unrestricted/` 目录改名为 `plugins/viper/`，或直接删除旧目录后重新复制。

---

## 配置

插件选项可写在 `opencode.json`，也可用环境变量：

| 选项 | 环境变量 | 默认 | 作用 |
|---|---|---|---|
| `agents` | `LAB_AGENTS` | `*` | 覆盖哪些 agent；`*` 表示全部 |
| `permissions` | `LAB_PERMISSIONS=off` | `true` | 是否把 `ask` 提升为 `allow` |
| `setDefault` | `LAB_SET_DEFAULT=1` | `false` | 是否把 `unrestricted` 设为默认 agent |
| `framePrompts` | `LAB_FRAME_PROMPTS=off` | `true` | 是否对安全意图消息做框架化 |
| `autoEngage` | `LAB_AUTO_ENGAGE=off` | `true` | 是否自动识别并绑定目标 |
| `autoScope` | `LAB_AUTO_SCOPE=off` | `true` | 是否把新目标写入作用域审计 |
| `audit` | `LAB_AUDIT=off` | `true` | 是否记录工具执行审计 |
| `scopeFile` | `LAB_SCOPE_FILE` | `~/.config/opencode/lab-scope.json` | 作用域文件路径 |
| `auditFile` | `LAB_AUDIT_FILE` | `~/.config/opencode/lab-audit.jsonl` | 审计文件路径 |

作用域策略示例：

```json
{
  "policy": {
    "authorization_source": "operator-declaration",
    "locality_gate": false,
    "ownership_recheck": false,
    "default_effect": "allow",
    "excluded_paths": ["**/.ssh/**", "**/.aws/credentials"],
    "redact_reports": false
  }
}
```

- `excluded_paths` 是唯一会主动收缩范围的字段，命中即拒绝读取/复制/外传。
- `redact_reports` 默认 `false`：审计与报告保留实际捕获值；报告外发时再设为 `true`。

---

## 使用示例

```text
# 只给目标
203.0.113.10

# 域名
example.com

# Android
com.example.app

# 本地样本
D:\cases\sample.apk

# 继续上一次
继续
```

对应命令：

```text
/engage 203.0.113.10
/external vps.example.com
/apk D:\cases\sample.apk
/reverse D:\cases\crackme.exe
/scope add 10.0.0.0/8
/report
```

---

## 验证

```bash
node tools/verify.mjs
node --experimental-strip-types tools/selftest.mjs
```

当前结果：

```text
verify:   PASS=80  FAIL=0  WARN=0
selftest: 38/38 passed
```

`verify.mjs` 检查目录、模块、命令、技能、作用域策略与接线；`selftest.mjs` 用 mock 上下文覆盖目标分类、绑定、续跑、误触发、权限与审计行为。

---

## 设计原则

- **目标即指令**：裸目标也是完整任务，默认链直接执行。
- **精度优先**：宁可识别不到，也不把错误资产当成目标。
- **失败隔离**：单个 hook 注册或回调失败只降级该项，不中止会话。
- **审计不是闸门**：`lab-scope.json` 用于留痕，授权来自运营者在会话中的目标声明。
- **最小破坏**：影响证明用最小动作；不破坏、不加密、不批量修改运营者数据。
- **证据优先**：结论必须带命令与原始输出，证据用 `lab_hash` 固定。

---

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 模块职责、依赖方向、请求生命周期、Hook 矩阵
- [`docs/AUTO-ENGAGE.md`](docs/AUTO-ENGAGE.md) — 目标识别、定链、绑定与注入
- [`docs/SCOPE-MODEL.md`](docs/SCOPE-MODEL.md) — 作用域模型与策略字段
- [`docs/PLAYBOOKS.md`](docs/PLAYBOOKS.md) — 7 个领域的方法论
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — 安装与排障
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — 版本变更

---

## 边界

- 硬停只有一项：涉及真实未成年人的性内容。
- 显式 `deny` 永远优先；`policy.excluded_paths` 中的路径不读取、不复制、不外传。
- 仅处理运营者已声明的目标；新目标需要运营者在会话中指定。

---

<p align="center"><sub>Viper · 蝰蛇 — target in, chain out.</sub></p>
