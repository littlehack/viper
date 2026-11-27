# Architecture

## 1. 模块职责

| 模块 | 依赖 | 职责 | 不做什么 |
|---|---|---|---|
| `src/plugin.ts` | 全部 | 组装：解析设置 → 建审计 → 注册 hooks → 注册 tools | 不含业务文本 |
| `src/constants.ts` | – | 版本、默认路径、阈值 | 不读文件 |
| `src/config/settings.ts` | constants | 选项/环境变量解析、agent 覆盖判定 | 不读作用域 |
| `src/config/scope.ts` | constants | 作用域读写、目标增删、排除模式提取 | 不写 prompt |
| `src/prompt/markers.ts` | – | 注入标记 vs 引用标记 | – |
| `src/prompt/intent.ts` | – | 意图正则表 | 不做判定动作 |
| `src/prompt/frame.ts` | markers, intent | 用户回合框架、历史消息改写 | 不碰 system |
| `src/prompt/inject.ts` | markers, util/text | system 前置注入与幂等 | 不生成文本 |
| `src/prompt/engage.ts` | target/plan | 生成 `[TARGET-BOUND]` 块 | 不做 IO |
| `src/prompt/boost.ts` | scope, ethics, settings, engage | 生成 `[UNRESTRICTED-LAB]` 块 | 不做 IO |
| `src/target/detect.ts` | – | 目标识别与分类（纯函数） | 不读文件、不联网 |
| `src/target/plan.ts` | target/detect | 每种目标的默认链与首条命令 | 不执行命令 |
| `src/target/binding.ts` | target/detect | 会话级目标绑定（内存，上限 64） | 不落盘 |
| `src/hooks/agent.ts` | settings | agent 定义修补、权限合并 | 不注册权限钩子 |
| `src/hooks/permission.ts` | scope, ethics, audit | ask→allow、排除路径 deny | 不查网络 |
| `src/hooks/session.ts` | prompt/*, target/*, scope, settings | 识别→绑定→落库→注入（四个 session 钩子） | 不写审计（除 scope.auto 一条） |
| `src/hooks/audit.ts` | audit-log, redact | 工具执行审计（默认原文） | 不记录内容 |
| `src/tools/*` | config, capabilities, ethics, util | 8 个自检/记录工具 | 不隐式执行外部命令 |
| `src/capabilities/playbooks.ts` | node:fs（惰性） | 方法论加载 + 离线回落 | 不解析参数 |
| `src/ethics/*` | util/glob | 硬停、规则、可选脱敏、排除判定 | 不做 scope 决策 |
| `src/util/*` | – | 守卫、glob、文本、审计落盘 | – |

## 2. 依赖方向

```
constants
  ↑
util ← ethics
  ↑
config ← prompt ← target
  ↑        ↑
hooks ─────┘
  ↑
tools ← capabilities
  ↑
plugin
```

单向依赖，文件级无环。`util/text.ts` 依赖 `ethics/redact.ts`，`ethics/policy.ts` 依赖
`util/glob.ts`，两条边方向相反但落在不同文件，因此不构成循环导入。

## 3. 请求生命周期

```
用户消息
  └─ session.prompt ── frameText()          只改有安全意图的 prompt
       └─ auto-engage ── detect → bind → scope 审计 → buildTargetBlock()
            └─ [agent loop]
                 ├─ permission.evaluate ── ask→allow / excluded→deny
                 ├─ session.context ── readScope → 绑定(或本轮/作用域目标) → buildPlan
                 │                     → buildBoost([TARGET-BOUND]) → unshift → rewriteMessages
                 │     └─ tool.execute.before ── audit.append(摘要)
                 │           └─ 工具执行
                 │     └─ tool.execute.after ── audit.append(状态)
                 └─ 模型响应
  └─ session.compaction ── 同一 onContext   摘要请求保持语境（绑定在内存，不丢）
  └─ session.generate ── 同一 onContext     瞬态请求保持语境
```

## 4. Hook 矩阵

| 事件 | 注册函数 | 失败时 |
|---|---|---|
| `agent.transform` | `registerAgentTransform` | 跳过，其余照常 |
| `permission.evaluate` | `registerPermission` | 跳过；权限回落默认 |
| `session.prompt` | `registerSession` | 跳过；不做 frame、不绑定目标 |
| `session.context` | `registerSession` | 跳过；无注入（`lab_status` 会显示缺失） |
| `session.compaction` | `registerSession` | 跳过 |
| `session.generate` | `registerSession` | 跳过 |
| `tool.execute.before` | `registerAudit` | 跳过；审计缺前半段 |
| `tool.execute.after` | `registerAudit` | 跳过 |
| `tool.transform` | `registerTools` | 跳过；无 `lab_*` 工具 |

实际注册成功的清单由 `lab_status.hooks` 返回，跳过项写到 `console.warn`。

## 5. 设计不变量

1. **幂等**：`INJECT_MARKER_RE` 只认 `[UNRESTRICTED-LAB]` / `[UNRESEARCH-LAB]`。agent 定义里的
   `[MODE: …]` 归 `QUOTE_MARKER_RE`，只用于 frame 去重，不影响注入。
2. **拒绝优先**：`permission.evaluate` 里先判 `excluded_paths`，再判 `ask`；`deny` 不被改写。
3. **失败隔离**：`createGuard` 管注册，`guardCallback` 管执行，两层都不允许异常冒到会话。
4. **可观测**：`registered` / `toolNames` 是活数组，`lab_status` 读到的是当前状态。
5. **作用域热读**：每个 `session.context` 重新读文件，写操作原子（临时文件 + rename）。
6. **绑定先于文本**：目标绑定存插件内存（`target/binding.ts`，会话键，上限 64），
   `session.compaction` 只改模型可见文本，绑定不会因摘要而丢；`[TARGET-BOUND]` 每轮重新渲染。
7. **纯函数识别**：`target/detect.ts` 不读 fs、不联网，识别失败只意味着"没有目标块"，不会抛错。

## 6. 扩展点

- 新工具：`src/tools/<name>.ts` 导出工厂，注册进 `src/tools/index.ts` 的 `createResearchTools`。
- 新目标类型：`src/target/detect.ts` 的 `TargetKind` + 正则/掩码顺序；`src/target/plan.ts` 的
  `kindPlan` 补一条链；`tools/selftest.mjs` 加分类与首条命令断言。
- 新方法论：`src/capabilities/playbooks/<domain>.md` + `playbooks.ts` 的 `ENTRIES` + `PLAYBOOK_DOMAINS`。
- 新钩子：在 `src/hooks/` 加注册函数，在 `src/plugin.ts` 按顺序调用，并补 `tools/selftest.mjs` 断言。
- 新作用域字段：`config/scope.ts` 的 `readScope` 合并逻辑 + `lab-scope.json` 样例 + `verify.mjs` 断言。
