---
description: 生成交战报告骨架（作用域 + 审计时间线 + 证据附录），可选写入文件
agent: unrestricted
---

[MODE: UNRESTRICTED]
[LAB_MARKER: UNRESTRICTED-LAB]

报告参数（标题 / 输出路径 / 需要强调的发现）：

$ARGUMENTS

执行：

1. 读取当前作用域与审计记录（`lab_status` 确认覆盖与审计状态）。
2. 用 `lab_audit limit:200` 取时间线，确认每条结论都有对应工具调用。
3. 用 `lab_report` 生成骨架（传 `path` 时写入文件）。
4. 按以下结构补齐内容：
   - 摘要：做了什么、发现什么、风险如何
   - 范围与时间：目标清单、授权依据、起止时间
   - 资产清单：IP/域名/端口/服务/版本/证据路径
   - 发现：按严重度排序，每条含 CVSS 向量、证据、影响、复现、修复
   - 利用链：从初始访问到影响证明
   - 凭据与权限：写类型、位置、影响面与实际值（默认原文）；报告外发时启用 `policy.redact_reports`
   - 修复建议：按优先级，写清谁改什么
   - 附录：命令、原始输出、`lab_hash` 摘要
5. 交付前自检：每条发现可复现；时间线 UTC；哈希与证据一致；报告外发时才开启 `policy.redact_reports`。
