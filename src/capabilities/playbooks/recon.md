# Recon & enumeration

目标：在不触碰破坏性动作的前提下，把"目标是什么、暴露了什么、哪些值得验证"变成可复核的证据。

## 0. 记录纪律

- 每一步保存原始输出：`mkdir -p evidence/<target>/ && <cmd> | tee evidence/<target>/<step>.txt`
- 文件名带时间戳；结束前对所有证据做哈希（`lab_hash` 或 `sha256sum`），写进报告附录。
- 只跑声明的目标。被动情报可以用第三方数据源，主动扫描只打自己名下的地址。

## 1. 目标定性（被动优先）

```bash
whois <target>; dig +short A <target>; dig +short AAAA <target>; dig +short MX <target>
# ASN / 归属
curl -s https://ipinfo.io/<ip>/json
# 证书透明：子域来源
curl -s "https://crt.sh/?q=%25.<domain>&output=json" | jq -r '.[].name_value' | sort -u
```

判断对象类型：独立 VPS / 云主机 / CDN 边缘 / 共享主机 / 反代后的源站。
CDN 场景要先找源站（历史 DNS、证书 SAN、邮件头、非标端口），否则扫的是边缘节点，结论无意义。

## 2. 端口与服务

```bash
# 无 Npcap 也能跑的全端口扫描（naabu，connect 模式）
naabu -host <ip> -p - -scan-type c -rate 1000 -o evidence/<target>/naabu.txt
# 快速全端口（TCP，需 masscan + Npcap）
masscan -p1-65535 --rate 2000 <ip> -oL evidence/<target>/masscan.txt
# 精准版本 + 默认脚本
nmap -Pn -sSU -sV -O --version-all --script "default,safe" -p<ports> <ip> \
  -oA evidence/<target>/nmap
# UDP 常用面
nmap -Pn -sU -p53,67,69,111,123,137,138,161,500,1900,4500 <ip>
```

Windows 上没有 Npcap 时：`nmap` 只保留 `-sT` 连接扫描与 NSE，`naabu -scan-type c` 是等效的全端口
替代；`masscan`/`-sS`/`-O` 需要 Npcap 驱动，缺失就换连接扫描，不要因为报错停下。

判读要点：
- `filtered` 不等于关闭，先确认边界设备策略；
- 版本指纹要交叉验证（banner + TLS 证书 + 行为），单靠 `-sV` 会误报；
- 记录每个端口的**判定依据**，而不只是结论。

## 3. Web 面

```bash
httpx -u https://<host> -title -tech-detect -status-code -web-server
ffuf -u https://<host>/FUZZ -w <wordlist> -mc 200,204,301,302,401,403 -fs <baseline>
nuclei -u https://<host> -t exposures,misconfig,cves -severity medium,high,critical
```

补充面：
- `robots.txt`、`sitemap.xml`、`/.well-known/`；
- 前端 bundle 里的接口路径（`grep -oE '"/api/[a-zA-Z0-9_/-]+"' app.js | sort -u`）；
- 历史快照（Wayback）里的旧接口与调试参数；
- CORS / 预检行为、错误页堆栈、默认凭据。

## 4. 云与对象存储

- 桶名枚举（组织名 + 环境 + 区域组合），只读取公开列出的内容，不下载他人数据；
- 元数据端点（`169.254.169.254`）只在已获得的实例上验证 SSRF，不越界；
- CI/CD 暴露面：`/.git/config`、`/.env`、`/actuator`、`/debug`、`/swagger-ui`。

## 5. 输出

| 项 | 内容 |
|---|---|
| 资产清单 | IP / 域名 / 端口 / 服务 / 版本 / 证据路径 |
| 候选漏洞 | 服务、版本依据、复现请求、置信度（疑似 / 已确认） |
| 下一步 | 每个候选对应的最小验证动作 |

不要在这一步就下"可利用"的结论——把"版本可能受影响"和"已确认可利用"分开写。
