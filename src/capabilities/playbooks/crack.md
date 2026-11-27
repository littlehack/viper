# License / trial / signature analysis

目标：在授权样本上还原"授权判定"的真实逻辑，给出最小改动或等价实现，并证明改动后行为正确。

## 1. 判定类型先分类

| 类型 | 特征 | 主要路线 |
|---|---|---|
| 纯本地对称 | 常量密钥、HMAC、混淆字符串 | 还原算法 → keygen 或 patch |
| 本地非对称 | 内嵌公钥、签名块 | 不能伪造签名 → patch 校验返回值/替换公钥 |
| 在线校验 | 启动/周期请求、心跳 | 客户端补丁 + 本地 mock 服务；服务端逻辑只做只读验证 |
| 时间/试用 | 首次运行时间、计数器、注册表 | 定位存储点 → 重置/重放（授权环境内） |
| 完整性绑定 | 校验和、代码签名、反调试 | 先解决自校验，再改业务逻辑 |

## 2. 定位判定点

```bash
# 字符串与错误提示是最快的入口
strings -n 5 <binary> | grep -iE "licen|trial|expire|activ|invalid|serial"
# 交叉引用（ghidra/r2）
r2 -A <binary> -qc 'axt @ str.invalid_license'
```

Android：
```bash
jadx -d out app.apk
grep -rn "isPremium\|isPro\|verifyLicense\|checkSignature" out/sources | head
```

Flutter / RN / Unity：先找业务 bundle（`libapp.so`、`index.android.bundle`、`global-metadata.dat`），再按框架符号定位。

## 3. 动态确认

```js
// frida：打印判定函数真实返回
Java.perform(() => {
  const C = Java.use("com.example.License");
  C.isValid.implementation = function () {
    const r = this.isValid();
    console.log("isValid ->", r, Java.use("android.util.Log").getStackTraceString(Java.use("java.lang.Throwable").$new()));
    return r;
  };
});
```

原则：**先观测，后修改**。没有调用栈证据的"应该是这里"一律标为待验证。

## 4. 两条交付路线

### A. 算法还原（优先生成 keygen）

1. 提取输入 → 中间值 → 比较值的完整数据流；
2. 识别哈希/加密/编码层，逐层剥离；
3. 用同一输入验证输出与样本一致（至少 3 组）；
4. 给出可运行脚本 + 生成样例 + 验证命令。

### B. 补丁（算法不可还原时）

- 分支替换：记录原指令、偏移、替换后指令；
- 返回值强制：注意调用点是否还有二次校验；
- 公钥替换：仅在本地验证场景，需说明信任边界变化；
- 每次改动后跑验证矩阵：启动、功能、判定、网络、退出。

## 5. 完整性对抗

- 校验和：改完重算并回填；
- 代码签名：Android 用 `apksigner` 重签，桌面端看是否有签名校验分支；
- 反调试：先定位检测点（`ptrace`、`TracerPid`、时序），再决定 patch 还是 hook；
- 自校验链：从最外层往里逐层解除，每层单独验证。

## 6. 验证清单

- [ ] 未打补丁样本仍表现为未授权（对照组）
- [ ] 补丁样本通过全部功能路径
- [ ] 至少一条路径证明判定函数被实际执行（日志/断点/frida）
- [ ] 补丁可复现（偏移 + 原始字节 + 替换字节）
- [ ] 报告中不含真实凭据，只写位置与形态
