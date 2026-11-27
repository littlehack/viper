# Forensics & incident response

目标：把"发生了什么"变成有条链、可复核、可呈交的时间线与证据集。

## 1. 证据纪律

- 先哈希再分析：`sha256sum image.dd > image.dd.sha256`，全程只在副本上操作；
- 记录工具版本、命令、时间、操作者；
- 任何提取物单独哈希，写进证据表（`lab_hash` 可直接批量生成）。

## 2. 主机取证

```bash
# 磁盘镜像（只读挂载）
dc3dd if=/dev/sdb of=evidence/host.dd hash=sha256
mount -o ro,loop,offset=$((2048*512)) evidence/host.dd /mnt/ro

# 文件系统时间线
fls -r -m / -o 2048 evidence/host.dd > bodyfile.txt
mactime -b bodyfile.txt -d > timeline.csv
```

看什么：
- 持久化：启动项、计划任务、服务、cron、systemd unit、注册表 Run；
- 执行痕迹：Prefetch/Amcache/ShimCache（Windows）、bash history、auditd；
- 账户与登录：`last`、事件 4624/4625、SSH `auth.log`；
- 外联：DNS 缓存、代理日志、netflow、浏览器历史。

## 3. 内存取证

```bash
vol -f mem.raw windows.pslist
vol -f mem.raw windows.pstree
vol -f mem.raw windows.netscan
vol -f mem.raw windows.malfind
vol -f mem.raw windows.cmdline
# Linux
vol -f mem.raw linux.bash
vol -f mem.raw linux.pslist
```

产出：进程树、注入区域、网络连接、命令行、加载模块、凭据痕迹（只记录位置，不导出明文）。

## 4. 日志与网络

```bash
# 快速筛 IOC
grep -aiE "powershell|base64|wget|curl|certutil|bitsadmin" auth.log
tshark -r capture.pcap -Y 'dns' -T fields -e frame.time -e dns.qry.name | sort -u
zeek -r capture.pcap local
```

要点：
- 时区统一（全部转 UTC），时钟偏移单独记录；
- 关联用五元组 + 进程 + 用户，不要只看单条日志；
- 误报要写排除依据。

## 5. 时间线

| 时间(UTC) | 主机 | 行为 | 证据 | 置信度 |
|---|---|---|---|---|
| 2026-01-01T00:00Z | host01 | 创建计划任务 | 4624 + 文件 mtime | 高 |

## 6. 报告

- 摘要：影响范围、攻击链、当前状态；
- 证据：每条结论附命令与输出片段；
- IOC：可直接用于检测的字段（域名、哈希、命令行特征）；
- 修复：短期遏制 + 长期加固，区分已执行与建议。
