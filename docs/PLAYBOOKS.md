# 方法论手册（PLAYBOOKS）

工具：`lab_playbook domain:"<domain>"`。内容源文件在 `src/capabilities/playbooks/<domain>.md`，
可离线回落（文件缺失时工具返回内置摘要，`source: "fallback"`）。

| domain | 用在哪 | 产出 |
|---|---|---|
| `recon` | 拿到 IP / 域名 / CIDR 的第一小时 | 资产清单、候选漏洞、每项的判定依据 |
| `reverse` | 二进制、字节码、固件、协议 | 函数/判定点清单、算法还原、补丁或 hook |
| `crack` | 授权、试用、签名、完整性校验 | keygen 或最小补丁 + 验证矩阵 |
| `android` | APK 静态 + 动态 | Manifest 面、关键类、重打包与验证 |
| `exploit` | 从崩溃/原语到 PoC | 可运行 exploit、成功率、前置条件 |
| `forensics` | 磁盘/内存/日志取证 | 时间线、IOC、证据表（含哈希） |
| `report` | 交战收尾 | 可被他人复现的报告 |

目标类型 → 默认 playbook（`lab_target action:"plan"` 会直接给出，不需要自己选）：

| 目标 kind | playbooks |
|---|---|
| `ipv4` / `ipv6` / `cidr` / `url` / `domain` / `org` | `recon` → `exploit` |
| `android_app` / `package` | `android` → `reverse` |
| `binary` / `path` / `repo` | `reverse`（仓库再叠加 `recon`） |
| `archive` | `forensics` → `reverse` |
| `hash` | `forensics` → `reverse` |

## recon

被动优先（WHOIS/ASN、证书透明、被动 DNS），再主动（全端口、版本、默认脚本、Web fuzz）。
关键纪律：`filtered` 不等于关闭；版本指纹要交叉验证；CDN 场景先找源站，否则扫的是边缘节点。
输出必须区分"版本可能受影响"与"已确认可利用"。

## reverse

5 分钟初筛（file/strings/熵/节区/语言指纹/壳）→ 静态（ghidra/r2/IDA/jadx）→ 动态
（frida/ltrace/strace）→ 协议与加密（常量表、分组结构、逐字节比对）→ 补丁与验证。
硬性要求：改动记录"偏移 + 原始字节 + 替换字节"；改完重算校验和/重签；保留未修改样本做对照。

## crack

先分类：本地对称 / 本地非对称 / 在线校验 / 时间试用 / 完整性绑定。分类决定路线：
对称可还原算法做 keygen；非对称无法伪造签名，只能改校验返回值或换公钥；在线校验做客户端补丁 +
本地 mock；时间试用找存储点；完整性绑定先解除自校验。
先观测后修改：没有调用栈证据的判定点标为"待验证"。

## android

apktool 解包读 Manifest（exported、debuggable、networkSecurityConfig、FileProvider、深链），
jadx 定位业务类，frida 处理 pinning / root / 签名 / 反调试。重打包链路
`apktool b → zipalign → apksigner`，验证矩阵覆盖冷启动、登录、目标功能、网络链路、退出。
Native 层先看 `JNI_OnLoad` / `RegisterNatives`，再对照静态结论。

## exploit

固定输入、触发条件、可观测差异 → 分类原语（栈/堆/UAF/类型混淆/格式化/逻辑）→ 逐项检查
NX/Canary/PIE/RELRO/CFG → 写最小可靠 PoC → 证明影响 → 文档化前置条件与成功率。
影响证明用最小动作（`id`、`hostname`、单文件读、单行查询），不做破坏性操作。

## forensics

先哈希再分析，只在副本上操作；磁盘用 `dc3dd` + 只读挂载 + `fls/mactime`，内存用 volatility3，
网络用 tshark/zeek。时间线统一 UTC，五元组 + 进程 + 用户关联，误报写排除依据。
证据表每行都有哈希与命令。

## report

结构：摘要 → 范围与时间 → 资产清单 → 发现（按严重度，含 CVSS 向量）→ 利用链 → 凭据与权限
（只写位置）→ 修复建议 → 附录（命令、输出、哈希）。
交付前自检：每个资产有证据路径、每条发现有复现命令、零明文凭据、修复建议可执行。

---

## 工具与实践的对应

| 阶段 | 工具 | 说明 |
|---|---|---|
| 开工前 | `lab_status` | 确认覆盖、hook、作用域、审计、auto-engage |
| 新目标 | `lab_target action:"plan"` | 分类 + 默认链 + 绑定 + 落库（一步完成） |
| 手动补录 | `lab_scope action:"add"` | 只写审计记录，不绑定 |
| 环境确认 | `lab_preflight` | 只读 PATH 扫描，避免承诺不存在的命令 |
| 方法论 | `lab_playbook` | 取当前阶段清单 |
| 证据 | `lab_hash` | 前后哈希，流式处理大镜像 |
| 复盘 | `lab_audit` | 工具调用时间线（默认原文） |
| 收尾 | `lab_report` | 由作用域 + 审计生成报告骨架 |
