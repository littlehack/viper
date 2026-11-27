/**
 * High-confidence intent patterns.
 *
 * Only patterns that name a concrete security practice are listed. Generic
 * words (分析 / 测试 / 注册) stay out so ordinary requests are never re-framed.
 */
export const INTENT: ReadonlyArray<RegExp> = [
  /逆向工程|逆向分析|反编译|反汇编|动态调试|脱壳|反混淆|固件分析|协议逆向/i,
  /破解|破解补丁|免授权|无限试用|去掉验证|激活码生成|序列号生成|注册机|协议注册机/i,
  /绕过(?:授权|许可|验证|注册|验证码|风控|登录|鉴权|WAF|沙箱|EDR|检测|签名|证书|SSL\s*Pinning|root|越狱)/i,
  /渗透(?!率)|漏洞利用|权限提升|提权|横向移动|凭证转储|凭证窃取|钓鱼页面|钓鱼网站|键盘记录|恶意软件|勒索软件|木马|后门|代码注入|进程注入/i,
  /getshell|webshell|拿\s*shell|免杀|bypass\s*(?:av|edr|defender)|外网打点|打点|驻留|维权|反调试/i,
  /license\s*(?:check|bypass|patch)|trial\s*bypass|keygen|binary\s*patch|credential\s*(?:harvest|dump|steal)|phishing\s*(?:kit|page)|PE\s*infector/i,
  /privilege\s*escalation|lateral\s*movement|command\s*and\s*control|process\s*injection|defense\s*evasion|persistence\s*mechanism|shellcode|exploit/i,
  /内存取证|流量劫持|中间人攻击|抓包分析|日志取证|应急响应|样本分析|恶意样本/i,
  /pentest|payload|rootkit|bootkit|ransomware|keylogger|dropper|malware|red\s*team|forensic|0day|zero[- ]day|RCE|LPE/i,
  /\breverse[\s-]+(?:engineer(?:ing)?|obfuscat\w*)\b/i,
  /\breverse\b[^.\n]{0,40}\b(?:apk|binary|firmware|protocol|bytecode|dll|so|exe|app)\b/i,
  /sqlmap|nmap|frida|gdb|lldb|wireshark|burp(?:\s*suite)?|ida(?:\s*pro)?|ghidra|radare2?|mimikatz|bloodhound|impacket|metasploit|msfvenom|cobalt\s*strike|nuclei|ffuf|chisel|ligolo/i,
  /SQLi|XSS|SSRF|XXE|CSRF|SSTI|deserialization|authz?\s*bypass|sandbox\s*escape|SSL\s*Pinning|heap\s*spray|ROP\s*chain/i,
  /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b|\b(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}\b/i,
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|cn|xyz|top|me|dev|app|cloud|site|info|ru|jp|hk|sg|de|uk|ai)\b/i,
]

export const matchesIntent = (text: string): boolean => INTENT.some((pattern) => pattern.test(text))
