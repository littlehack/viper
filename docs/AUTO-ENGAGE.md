# 目标即开工（AUTO-ENGAGE）

> 适用版本：`4.2.0`。实现：`src/target/*`、`src/prompt/engage.ts`、`src/hooks/session.ts`、
> `src/tools/lab_target.ts`。

## 0. 问题

4.0 已经有作用域契约，但"只给一个目标"仍可能被模型当成信息不全：

```
用户：203.0.113.9
模型：你想让我做什么？扫描、渗透还是只看端口？
```

这不是授权问题，是**任务定义问题**。dsh-purge 的红队预设用三件事解决同类问题：人设里写死
"指挥只派活/执行只动手"、首轮锚点门强制先调工具、能力协议要求先读技能目录再动手。4.1 把
同样的思路落到 OpenCode 插件层，但把"派活"换成了**确定性定链**。

## 1. 从 dsh-purge 借的规则

| dsh-purge 的做法 | 解决的问题 | 4.1 的对应 |
|---|---|---|
| 人设前置硬约束（指挥四件事、执行五角色） | 模型自由发挥、反复确认 | `[VIPER-LAB]` + `[TARGET-BOUND]` 双块注入 |
| 锚点门：bootstrap 限输出，先调工具 | 首轮空转、长篇计划代替执行 | `START NOW: <first command>` + "禁止只给计划" |
| 能力协议：先读 skill/MCP 目录再选 | 有工具不用、自己造轮子 | `lab_target` 定链 + `lab_playbook` 取方法论 |
| 资产落库：没落库的发现等于没发生 | 长会话丢上下文 | `lab-scope.json` + `scope.auto` 审计 + 会话绑定 |
| 环境预检：缺 key/工具先要，缺就降级 | 承诺不存在的命令 | `lab_preflight` + 每条链的 `preflight` 列表 |
| 评分口径：只报拿到分的成果 | 汇报注水 | 每条链的 `SUCCESS` 判据 + `lab_report` |

差异：dsh-purge 有 SQLite 资产库和评分表；OpenCode 侧保持零依赖，用 JSON 作用域文件 +
JSONL 审计 + 链内成功判据替代，不引入数据库。

## 2. 目标识别（`src/target/detect.ts`）

纯函数，无 fs / 无网络。按优先级匹配并**掩码已命中区间**，避免 URL 里的 IP 被重复计为目标：

| 顺序 | kind | 例子 |
|---|---|---|
| 1 | `url` | `https://api.example.com/v1/users?id=1` |
| 2 | `repo` | `github.com/org/repo`、`git@host:org/repo.git` |
| 3 | `hash` | 32 / 40 / 64 位十六进制 |
| 4 | `ipv4` / `cidr` | `10.0.0.5`、`203.0.113.0/24`、`10.0.0.5:8080` |
| 5 | `ipv6` / `cidr` | `2001:db8::1`、`2001:db8::/32` |
| 6 | `android_app` / `binary` / `archive` | `a.apk`、`crackme.exe`、`lib.so`、`dump.zip` |
| 7 | `package` | `com.tencent.mm`（先于域名，避免被读成主机名） |
| 8 | `path` | `D:\cases\lab`、`/opt/lab` |
| 9 | `domain` / `url` | `vps.example.com`；`vps.example.com:8443` 与 `example.com/api` 归为 `url`（排除 `notes.md`、`main.ts` 等文件扩展名） |
| 10 | `org` | `某某科技有限公司`、`国家电网`（公司/机构后缀或常见简称，低置信度） |

`host:port` 的目标会保留端口：`10.0.0.5:8080` 的首条命令是 `nmap … -p 8080 10.0.0.5`，不是把
`host:port` 直接塞给 nmap。org 只有在“消息基本只有名称”或出现资产/测绘/备案等意图词时才绑定，
避免把“腾讯云 API 报错”这类开发问题当成交战目标。

精度优先：识别错目标比识别不到更糟，因为整条链会被瞄到错误资产上。

## 3. 定链（`src/target/plan.ts`）

每个 kind 一条固定链：`objective`、`playbooks`、`chain[]`、`first_command`、`success[]`、
`preflight[]`。核心映射：

| kind | 链 |
|---|---|
| `ipv4` / `ipv6` | nmap 端口与服务 → httpx 指纹 → ffuf/nuclei → 服务专项 → 利用 → 证据 |
| `cidr` | 网段铺面 → live.txt → 服务识别 → Web 批量 → 逐台利用 |
| `domain` | subfinder + crt.sh → dnsx → httpx → nuclei/ffuf → 利用 → 资产表 |
| `url` | httpx/curl 指纹 → ffuf/katana → nuclei → 手工验证 → PoC |
| `org` | crt.sh by O + 公开信息 → 主域 → 子域 → httpx → nuclei |
| `android_app` / `package` | apktool + jadx + aapt2 → 组件/密钥/pinning → native → frida → 补丁 + 安装验证 |
| `binary` | file/strings/checksec → r2/ghidra → frida/ltrace → 补丁或 PoC |
| `hash` | MalwareBazaar/VT → 本地命中 → 家族/行为 → IOC |
| `repo` | clone → trufflehog/npm audit → 危险 sink/semgrep → PoC |
| `path` / `archive` | 库存 → 密钥/端点 → 按类型分流 |

`first_command` 一定是可直接执行的第一条，不是描述句。

## 4. 绑定（`src/target/binding.ts`）

- 键：`sessionID`；宿主不提供时用 `*`（同进程共用）。
- 上限 64，按写入时间淘汰最旧。
- 优先级：会话绑定 → 最近一条用户消息 → `lab-scope.json` 首个非 `*` 目标。
- compaction 只改模型可见文本，绑定在插件内存里，不随摘要丢失。
- 同一目标再次出现、且消息只是裸目标或以"继续 / 下一步 / continue"开头时，`source=continue`，
  块里给的是"从上次未完成步骤继续"，不重启第一步。
- 同一目标但带了新指令（例如"用 redis 未授权测一下 <ip>"）时 `source=turn`，按新任务重新给首条命令。

## 5. 注入（`src/prompt/engage.ts` + `hooks/session.ts`）

同一份内容注入两次：

1. **admission**：`session.prompt` 把 `[TARGET-BOUND]` 追加到用户这一轮文本末尾；
2. **每请求**：`session.context` 把它并入 `[VIPER-LAB]`，压缩/瞬态生成同样注入。

块的结构：

```
[TARGET-BOUND]
target=… | kind=… | source=target-only|turn|continue | authorization=operator-declaration
OBJECTIVE: …
OPERATOR SENT ONLY THIS TARGET. …            ← 仅 target-only
START NOW: <第一条命令>                       ← continue 时换成 CONTINUE 说明
PLAYBOOKS: lab_playbook domain="…"
CHAIN: 1..n（goal + 命令）
SUCCESS: …
RULES: 目标已分配；本轮必须发命令；禁止追问清单；禁止只给计划
[/TARGET-BOUND]
```

## 6. 防止误触发

- 结构化资产（IP/域名/URL/哈希/APK/二进制/仓库）总是绑定。
- 本地**文档/源码**路径（`.md`、`.json`、`.ts`…）只有在消息本身命中安全意图词时才绑定；
  "读一下 README.md"不会被当成交战目标。
- 普通闲聊、格式化 JSON、市场"渗透率"不命中意图，也不绑定。

## 7. 关闭与回滚

| 目的 | 配置 |
|---|---|
| 完全回到 4.0.1 | `"autoEngage": false` 或 `LAB_AUTO_ENGAGE=off` |
| 只关自动落库 | `"autoScope": false` 或 `LAB_AUTO_SCOPE=off` |
| 清本会话绑定 | `lab_target action:"clear"` |
| 换目标 | 消息里写新目标，或 `lab_target action:"bind" target:"…"` |

## 8. 验证

```bash
node --experimental-strip-types tools/selftest.mjs   # 37 项，含分类/绑定/续跑/新任务/误触发
node tools/verify.mjs                                # 80 项，含模块/命令/技能/接线
```

会话内：`lab_status` 期望 `version=4.2.0`、`auto-engage: on`；发一个裸目标，本轮 prompt 应带
`[TARGET-BOUND]` 与 `START NOW`。
