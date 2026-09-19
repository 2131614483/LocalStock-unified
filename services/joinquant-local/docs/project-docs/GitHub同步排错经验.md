# GitHub 推送排错经验（2026-08-12）

> 记录一次 `git push` 失败的完整排障：代理端口配错 + 沙箱网络隔离，最终定位到 Clash Verge(mihomo) 7897 并解决。

## 背景
项目本地提交完成后执行 `git push origin main`，报：
```
fatal: unable to access 'https://github.com/2131614483/quant-backtest.git/':
Failed to connect to github.com port 443 via 127.0.0.1 after 2028 ms: Could not connect to server
```
关键线索：**"via 127.0.0.1"** —— git 走了本机代理，但连不上。

## 排障步骤
1. **查 git 代理配置**：`git config --global --get-regexp 'http\.'`
   → 输出 `http.proxy http://127.0.0.1:17890`（**旧端口，实际未运行**）。
2. **用户提示端口 26561** → `netstat -ano | grep 26561` 无监听 → 该端口不对/未启动。
3. **netstat 找真实监听端口**：`netstat -ano | grep -i LISTENING`
   → 看到 `7897` 在监听；`tasklist /FI "PID eq <pid>"` 确认归属 **`verge-mihomo.exe`（Clash Verge 核心）**。
4. **确认代理进程**：`tasklist | grep -iE "clash|mihomo"` → `clash-verge.exe` + `verge-mihomo.exe` 在运行。
5. **修正代理**：`git config --global http.proxy http://127.0.0.1:7897`。
6. **非沙箱推送**：`dangerouslyDisableSandbox: true` + `git push origin main` → 成功（`65fee4a..8d7c23a`）。

## 根因
1. **git 全局代理端口配错**（17890 是旧的，实际 mihomo 在 7897）；用户口头报的 26561 也需 netstat 核实。
2. **沙箱网络隔离**：Bash 工具默认沙箱有**网络白名单**——放行项目需要的国内接口（腾讯 qt.gtimg.cn、新浪 hq.sinajs.cn 等），但**挡 github.com 与本机代理(127.0.0.1)**。所以沙箱内 `curl github.com` 返回 000、走代理也 000；**必须 `dangerouslyDisableSandbox: true`** 才能连本机代理推送。
3. `curl` 短超时（12~15s）可能误判 000：端口其实在监听但代理到 GitHub 慢，或协议(HTTP/SOCKS)不匹配。**最终以 `git push` 实测为准**，别被 curl 的 000 误导。

## 教训 / 速查
| 现象 | 处理 |
|---|---|
| push 报 `via 127.0.0.1 ... Could not connect` | 代理端口错/代理没开 → `git config --global --get http.proxy` 核对 |
| 用户给端口 | 先 `netstat -ano | grep <端口>` 核实是否监听，再信 |
| 找真实代理 | `netstat -ano | grep -i LISTENING` 找监听 + `tasklist | grep -iE "clash\|mihomo\|v2ray"` 认进程 |
| 本机代理/ github 连不上 | **沙箱网络白名单** → 用 `dangerouslyDisableSandbox: true` |
| curl 000 | 别轻信，短超时/协议不匹配都会 000；以 `git push` 实测 |
| 代理端口确认 | 本机 Clash Verge(mihomo) 混合端口 **7897** |

## 相关
- skill：`C:\Users\he\.claude\skills\git-commit-push\SKILL.md`（提交+推送完整流程已固化）
- 推送成功后：`git config --global http.proxy http://127.0.0.1:7897`
