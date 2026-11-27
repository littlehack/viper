# Reverse engineering

目标：从二进制/字节码恢复到"能解释行为、能定位判定点、能改、能验证"的模型。

## 1. 初筛（5 分钟）

```bash
file <sample>; sha256sum <sample>
strings -n 6 <sample> | head -200
# 熵与节区（PE/ELF）
python3 - <<'PY'
import sys, math, collections
data = open(sys.argv[1],'rb').read()
c = collections.Counter(data); n = len(data)
print(-sum(v/n*math.log2(v/n) for v in c.values()))
PY
```

看什么：
- 语言/框架痕迹（Go build ID、Rust panic 字符串、Flutter、Unity、Electron）；
- 保护壳特征（UPX、VMProtect、Themida、ollvm 字符串加密）；
- 导入表：网络、加密、进程/注入、反调试 API；
- 资源节里的配置、证书、二次载荷。

## 2. 静态

| 目标 | 工具 | 关注点 |
|---|---|---|
| PE/ELF | ghidra / r2 / IDA | 入口、初始化、字符串交叉引用、间接调用 |
| .NET / Java | dnSpy / jadx / CFR | 类结构、反射调用、序列化 |
| APK | jadx + apktool | Manifest、native 库、DEX 多包、资源混淆 |
| 固件 | binwalk / unblob | 文件系统、压缩段、签名头 |
| 脚本 | 直接读 | 混淆层、eval/exec、动态拼接 |

静态阶段必须产出：函数清单（按调用密度排序）+ 可疑判定点候选 + 常量表（加密 S-box、魔数、URL）。

## 3. 动态

```bash
# 系统调用与库调用
strace -f -s 200 -o trace.txt ./sample
ltrace -f -s 200 ./sample

# Frida：定位判定函数
frida -U -f <pkg> -l hook.js --no-pause
```

```js
// hook.js —— 打印入参/返回值/栈
const target = Module.findExportByName(null, "strcmp");
Interceptor.attach(target, {
  onEnter(args) { this.a = args[0].readUtf8String(); this.b = args[1].readUtf8String(); },
  onLeave(ret) { console.log(JSON.stringify({ a: this.a, b: this.b, ret: ret.toInt32() })); },
});
```

要点：
- 先证明"这段代码真的在判定"（改一个字节看行为是否翻转），再谈绕过；
- 网络协议用 mitmproxy/tcpdump 对照，别只靠静态推断；
- 反调试/反 VM 命中时记录触发条件，用于后续对抗设计。

## 4. 协议与加密

1. 抓一次完整正常流程，标注每个字段的来源；
2. 二分法定位签名/加密输入（改一个字段，看哪些输出变化）；
3. 识别算法：常量表（AES S-box、SHA IV、CRC 表）、结构（分组长度、填充）、密钥派生；
4. 用脚本复现（Python/Node），与真实样本逐字节比对；
5. 只在比对通过后声称"算法已还原"。

## 5. 补丁与验证

- 记录**原始字节 → 替换字节 → 文件偏移**，不要只写"改了跳转"；
- 改完重新计算校验和/签名（若存在），否则运行时会自毁；
- 验证矩阵：启动 → 关键功能 → 判定点 → 网络行为 → 退出码；
- 保留未修改样本，diff 出完整补丁集，便于复现和回滚。
