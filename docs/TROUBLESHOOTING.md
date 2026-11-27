# 故障排查（4.0.1）

4.0.1 没有安装器，所以排查顺序也变了：先跑自检脚本，再看运行时工具，最后看日志。

```bash
# 静态检查：目录、JSON、作用域策略、规则块、无 .ps1 残留
node tools/verify.mjs

# 逻辑自检：mock 上下文跑 setup，覆盖 9 个 hook、7 个工具、白名单与开关
node --experimental-strip-types tools/selftest.mjs
```

会话内（任意 agent）：

```text
lab_status
```

期望：`coverage: all-agents`、`hooks` 含 `session.context` 与 `tool.execute.before`、
`scope.locality_gate=false`。

---

## 1. `opencode plugin list` 显示 `No plugins found`

**这是正常的，不是故障。**

4.0 采用"目录扫描"部署：插件放在 `~/.config/opencode/plugins/viper/index.ts` 即被加载，
不写入 `opencode.json` 的 `plugins` 数组。`plugin list` 只列配置里的注册项，因此显示为空。

**真正的判据**是会话内 `lab_status` 返回内容，以及日志里没有加载错误。不要为了"让 list 里有名字"
而多写一份注册项——那会让插件被加载两次。

## 2. `lab_status` 不存在

工具没注册，说明 `setup()` 在 `tool.transform` 之前就失败了。

排查：

1. 日志过滤 `viper.boost`：
   `~/.local/share/opencode/log/opencode.log`（Windows：`%LOCALAPPDATA%\opencode\log\`）。
2. 看是否有 `skipped tool.lab_status` —— 说明当前 OpenCode 版本没有 `ctx.tool.transform`。
3. 确认入口文件：`plugins/viper/index.ts` 必须存在，且 `export { default } from "./src/plugin.ts"`。
4. `node tools/verify.mjs`，`[1] entry points` 全绿。
5. `opencode service restart`。

插件设计为"逐项注册"：某个事件缺失只会跳过该项并告警，不会整体失败。所以 `lab_status` 里
`hooks` 数组短了，就是对应的注册被跳过，按缺失项对照 `docs/ARCHITECTURE.md` 的 Hook 矩阵。

## 3. `Cannot find module '@opencode/plugin'`

```powershell
cd "$env:USERPROFILE\.config\opencode"
npm install @opencode/plugin
```

确认 `node_modules\@opencode\plugin\package.json` 存在，然后重启服务。

插件对此做了降级：包不存在时 `Plugin.define` 退化为 identity 函数，插件仍会尝试注册（日志里有
`@opencode/plugin unavailable`）。但 V2 运行时一般都会提供该包，这条日志出现在 OpenCode 里就说明
配置目录依赖缺失。

V1 的包名是 `@opencode-ai/plugin`，API 不同，4.0 不支持 V1 插件模式（rules 模式仍可用）。

## 4. `Plugin must export a default definition with an id and an effect or setup function`

当前 OpenCode 是 V1，或文件被 V1 加载器读取。

V2 形态：

```ts
export default Plugin.define({ id, setup })
```

V1 形态：

```ts
export default async (input) => ({ hooks })
```

两者不兼容。要么升级到 V2，要么只用 `rules/AGENTS.md`（不依赖插件 API），并移除
`plugins/viper`。

## 5. `lab_status` 显示 `coverage: "build,plan"` 而不是 `all-agents`

有白名单残留。按优先级检查三处：

1. 项目级 `opencode.json` / `.opencode/opencode.json`（项目级优先）
2. 全局 `opencode.json` → `plugins[].options.agents`
3. 环境变量 `LAB_AGENTS`

改成 `"*"` 或删掉该字段，`opencode service restart`。

## 6. 注入生效但模型仍然追问授权

按可能性排序：

1. **会话历史里已经有一次拒绝**：模型锚定旧回复。开新会话，或让主 agent 重新派发子任务。
2. **项目自带 `AGENTS.md` / `CLAUDE.md` 有更强约束**：项目规则与全局规则合并，冲突时前者更具体。
   在该项目里加一行显式覆盖，或临时移走项目规则验证。
3. **`session.context` 没注册**：看 `lab_status.hooks`，缺它就没有 system 注入。
4. **模型对齐强度高**：破甲是上下文工程，不是权重修改。把目标写具体（IP、端口、产物路径）
   比抽象要求更有效；用 `/viper` 或 `/external` 带上目标重发。
5. **agent 自身定义覆盖了 system 顺序**：注入用 `unshift` 放在最前，但个别 agent 会在
   agent 级 instructions 里重复声明政策。检查该 agent 的 Markdown。

## 7. `viper` / `redteam` 这两个 agent 反而没有注入（3.0 遗留 bug）

已在 4.0 修复。原因是旧版把 `[MODE: UNRESTRICTED]` 和 `[UNRESTRICTED-LAB]` 放在同一个
"已注入"判定里，而 agent 定义本身就带 `[MODE: …]`，于是被误判为"已注入"。

4.0 拆分（`src/prompt/markers.ts`）：

| 正则 | 用途 |
|---|---|
| `INJECT_MARKER_RE` → `[VIPER-LAB]`（兼容 `[UNRESTRICTED-LAB]` / `[UNRESEARCH-LAB]`） | 只用于幂等判定 |
| `QUOTE_MARKER_RE` → `[MODE: VIPER]`（兼容 `[MODE: UNRESTRICTED]`）/ `[MODE: REDTEAM-EXECUTOR]` | 只用于 prompt 去重 |

`tools/selftest.mjs` 有回归断言 `regression P1-1`，改坏会直接失败。

## 8. agent 的 `read *.env.*` 权限丢了（3.0 遗留 bug）

已在 4.0 修复：`mergePermissions` 改为**合并**而不是覆盖，只补 `*:*` 与 `external_directory:*`
两条基线，其余细则与显式 `deny` 原样保留。回归断言 `regression P1-2`。

如果仍看到权限被替换，检查是否有第二个插件也在 `agent.transform` 里整体替换 `permissions`。

## 9. prompt 出现重复段落

幂等靠三个条件：system 内已有 `[VIPER-LAB]`、文本已含 `authorized research environment`、
或文本命中 `QUOTE_MARKER_RE`。

如果出现重复，说明历史消息里已有旧版改写（旧版句式不同）。开新会话即可，或只保留 system 注入：

```jsonc
"options": { "agents": "*", "framePrompts": false }
```

## 10. 排除路径没有生效

`policy.excluded_paths` 在 `permission.evaluate` 阶段判断，与 `permissions` 开关无关
（`permissions:false` 只关闭 `ask → allow`）。依赖：

1. 事件里的 `agent` 在覆盖范围内；
2. 模式是 glob：`**/.ssh/**`、`**/id_rsa`、`D:/secrets/**`。`*` 不跨目录，`**` 跨目录。
3. Windows 路径会先归一化为 `/` 再匹配，所以模式里写 `/` 即可。

验证：`lab_scope action:"list"` 看 `excluded_paths` 是否读到了；改动立即生效（每次请求重读）。

## 11. 审计文件没有生成 / 不增长

1. `lab_status.audit.enabled` 是否为 `true`；
2. 目录是否存在且可写（`mkdir -p ~/.config/opencode`）；
3. 是否超过 2MB 触发轮转（旧文件为 `lab-audit.jsonl.1`）；
4. `node:fs` 是否可用（日志里 `node:fs unavailable`）。

审计只写工具名、agent、会话、输入摘要与状态，不写文件内容，也不写模型回复；捕获值默认原文，`policy.redact_reports: true` 时才替换。

## 12. 两个位置都有插件副本

重复注册不会破坏功能（注入与审计都幂等），但 permission hook 会跑两遍，审计条目翻倍。
保留一个：

```powershell
# 只保留目录形式
Remove-Item "$env:USERPROFILE\.config\opencode\plugin\unrestricted-boost.ts" -Force
```

## 13. `opencode.json` 解析失败 / 含注释

`opencode.json` 支持 JSONC，但外部脚本不一定。手工合并时保留原有字段，只追加 `plugins` 条目；
或直接用目录扫描，不写配置。

## 14. 修改后没生效

| 改动 | 生效方式 |
|---|---|
| `src/**.ts` | watcher 热重载；不生效则 `opencode service restart` |
| `opencode.json` / `agents/` / `commands/` | 热重载 |
| `config/lab-scope.json`（安装后为 `~/.config/opencode/lab-scope.json`） | 每次请求同步读取，立即生效 |
| `rules/AGENTS.md`（并入全局后） | 新会话生效 |
| `node_modules` 依赖 | `npm install` + `opencode service restart` |

## 15. 完全回滚

4.0 不再有卸载脚本，回滚就是删目录 + 删规则块：

```powershell
$cfg = "$env:USERPROFILE\.config\opencode"
Remove-Item "$cfg\plugins\viper" -Recurse -Force
Remove-Item "$cfg\lab-audit.jsonl" -Force -ErrorAction SilentlyContinue
# 如合并过规则块，编辑 $cfg\AGENTS.md 删除 <!-- BEGIN/END VIPER-LAB --> 之间的内容
```

`lab-scope.json` 建议保留：它是历史记录，删掉不影响运行。

## 16. 自检脚本本身报错

| 报错 | 原因 |
|---|---|
| `Unknown file extension ".ts"` | Node < 22.6，或缺少 `--experimental-strip-types` |
| `Cannot find package '@opencode/plugin'` | 正常：自检用 identity 降级，不影响断言 |
| `FAIL regression P1-1` | `markers.ts` 的两个正则又被合并了 |
| `FAIL playbook xxx too short` | `src/capabilities/playbooks/*.md` 被删或为空 |

`selftest.mjs` 的 mock 只实现本插件用到的方法，不校验 OpenCode 真实类型签名；类型层面的验证靠
`npm i -D @opencode/plugin` 后 `tsc --noEmit`（当前工程不强制要求）。

## 17. `/external` 只回了"目标未提供"，没有开始扫描

4.0.0 的模板在 `$ARGUMENTS` 为空时直接走空目标分支；4.0.1 起改为先解析目标：

```
本消息 → 最近一条用户消息 → lab-scope targets（忽略 *）→ 工作区产物 → 本机监听/容器
```

排查顺序：

1. `lab_status` 确认 `version` 是 `4.0.1`（旧进程需 `opencode service restart`）。
2. 参数要和命令同一行：`/external 203.0.113.10`。分两行输入时，第二行是普通消息，模型会从
   "最近一条用户消息"里取到目标后开工。
3. 目标写在 `lab-scope.json` 的 `engagements[0].targets` 里（不要只留 `*`），插件下次请求就能读到。
4. 若确实没有任何目标来源，按契约应输出 `缺失输入：target` **加上**候选表与第一条命令；
   只有一行"目标未提供"属于旧行为，升级后仍出现就按第 1 步检查进程版本。

## 18. 只给了目标，模型还是问"你想让我做什么"

4.1 起这种情况应该消失。按顺序排查：

1. `lab_status`：`version` 必须是 `4.2.0`，`auto-engage: on`。旧进程要 `opencode service restart`。
2. 看这一轮 prompt 里有没有 `[TARGET-BOUND]`：
   - 有 → 模型没按契约执行，直接用 `lab_target action:"plan" target:"<原样>"` 补一次并继续；
   - 没有 → 识别失败。`lab_target action:"analyze" target:"<原样>"` 看返回的 `kind`：
     `kind` 为空说明该写法不在识别表里（例如很短的内部代号），把它写成更完整的形式
     （`host:port`、`https://…`、完整路径、`包名`），或 `lab_target action:"bind"` 手动绑定。
3. 目标写在代码块或引号里也能识别；写在图片里不行——先用文字给出目标。
4. 关闭过 `autoEngage`（`LAB_AUTO_ENGAGE=off` 或 `"autoEngage": false`）时回到 4.0.1 行为。

## 19. 多会话串了目标

绑定按 `sessionID` 隔离；宿主不提供会话 id 时统一落在 `*`，同进程内共用。排查：

1. `lab_target action:"list"` 看每个会话键绑到了什么。
2. 需要清掉本会话绑定：`lab_target action:"clear"`。
3. 要彻底换目标：在消息里写出新目标即可自动重绑；或 `lab_target action:"bind" target:"<新目标>"`。
4. `lab-scope.json` 是审计记录，换目标不会删旧记录；需要清理用 `lab_scope action:"remove"`。

## 20. 自动落库把目标写进了 `lab-scope.json`，不想写

`autoScope` 默认开启，只追加目标字符串与一条 `scope.auto` 审计，不做授权判定。关闭：

```jsonc
{ "options": { "autoScope": false } }
```

或 `LAB_AUTO_SCOPE=off`。关闭后绑定仍生效，只是不写文件；手动补录用 `lab_scope action:"add"`。
