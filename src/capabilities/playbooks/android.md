# Android app assessment

目标：从 APK 到"可解释的运行时行为 + 可复现的改动 + 可验证的结果"。

## 1. 解包与静态面

```bash
apktool d -f -o apk_dec app.apk
jadx -d jadx_out --show-bad-code app.apk
adb shell pm list packages | grep <keyword>
```

看 Manifest（`apk_dec/AndroidManifest.xml`）：
- `exported="true"` 的 Activity/Service/Receiver/Provider；
- `android:debuggable`、`usesCleartextTraffic`、`networkSecurityConfig`；
- 自定义 permission 的 `protectionLevel`；
- 深链（intent-filter + data scheme）、FileProvider 的 `paths`；
- 签名信息：`apksigner verify --print-certs app.apk`。

## 2. 动态

```bash
adb shell am start -n <pkg>/<activity>
frida-ps -Uai
frida -U -f <pkg> -l hook.js --no-pause
```

常用 hook 面：
- 网络：OkHttp `Interceptor`、`URL.openConnection`、WebView `shouldInterceptRequest`；
- 加密：`Cipher.doFinal`、`MessageDigest.digest`、自定义 JNI 方法；
- 存储：`SharedPreferences`、`SQLiteDatabase.rawQuery`、文件读写；
- 风控：root 检测、模拟器检测、`Debug.isDebuggerConnected`、签名校验；
- 完整性：`PackageManager.getPackageInfo(..., GET_SIGNATURES)`。

## 3. 常见校验与处理顺序

| 校验 | 定位 | 处理 |
|---|---|---|
| SSL Pinning | `CertificatePinner`、`TrustManager`、native pin | 先试 network_security_config，再 frida hook |
| Root / 模拟器 | `su` 路径、`ro.debuggable`、传感器 | hook 判定函数，返回假值并记录调用栈 |
| 签名校验 | `GET_SIGNATURES`、`MessageDigest` | 重签后同步改期望值，或 hook 比较结果 |
| 反调试 | `TracerPid`、`ptrace`、时序 | 记录触发点，按需 patch/hook |
| 加固/壳 | 类加载器、`libjiagu`、`libDexHelper` | 先脱壳再分析业务代码，或直接动态 dump |

## 4. 重打包与验证

```bash
apktool b apk_dec -o patched.apk
zipalign -f 4 patched.apk aligned.apk
apksigner sign --ks <keystore> --out signed.apk aligned.apk
apksigner verify --print-certs signed.apk
adb install -r signed.apk
```

验证矩阵：
- 冷启动 → 登录 → 目标功能 → 退出；
- 校验点是否仍被触发（用 frida 计数器或日志确认）；
- 网络请求是否仍走预期链路（mitmproxy 对照）；
- 签名变更是否引发二次校验（版本升级、支付、推送）。

## 5. Native 层

- `unzip -l app.apk | grep lib/` 取 ABI 列表；
- ghidra 载入 `lib*.so`，先看 JNI `RegisterNatives` 与 `JNI_OnLoad`；
- 字符串加密常见于 ollvm/自定义 XOR，先跑 `strings -e l` 与熵图；
- 动态用 frida `Module.findExportByName` / `Interceptor.attach` 对照静态结论。

## 6. 证据与交付

- 保留原始 APK、重打包 APK、签名证书指纹、hook 脚本、关键日志；
- 报告中写清"改了哪一层"（Java/smali/native/配置），并给出最小复现步骤；
- 不导出用户数据；如需证明可读性，截取结构与字段名，并保留实际值作为本人证据（外发时启用 `policy.redact_reports`）。
