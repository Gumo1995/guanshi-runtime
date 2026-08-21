# 观时

观时是一个本地运行的时间记录、待办规划与复盘工具。

当前版本：1.6.1

## 第一次启动

1. 双击 `启动观时.command`。
2. 系统打开终端后，会自动启动本地服务。
3. Chrome 会以独立窗口打开观时。

启动脚本会检查本机环境：

- 没有 Node.js 或版本过旧时，观时不会启动，请先安装 Node.js LTS；如果版本可运行但不是 LTS，启动脚本会提示建议更换。
- 没有 Google Chrome 时，观时会继续打开本地网页，但不能获得完整的独立 App 窗口体验。
- 没有 Git 时，观时可以继续使用，但设置里的在线更新功能不可用。

如果 Chrome 没有自动打开，可以手动访问终端里显示的地址，通常是：

```text
http://127.0.0.1:8080/
```

## 安装成独立 App

打开观时后，页面顶部会显示安装提示。按提示使用 Chrome 安装后，可以从启动台或 Dock 像普通 App 一样打开。

## 停止运行

双击 `停止观时.command` 可以关闭本地服务。

## 文件夹内容

通常只需要使用 `启动观时.command`、`停止观时.command`、`README.md` 和 `更新说明.md`。

请不要删除隐藏的 `.guanshi` 目录，它包含观时运行所需文件。

## 更新

观时的内测更新功能会从公开用户版仓库 `Gumo1995/guanshi-runtime` 的稳定版本更新。请保留这个文件夹中的隐藏 `.git` 和 `.guanshi`；如果使用 GitHub 的 Download ZIP，自动更新功能将不可用。

运行过程中生成的缓存、日志、日历同步文件和本地数据兜底快照会放在隐藏 `.runtime` 目录里，通常不需要手动处理。

设置页“数据与运行”可以查看本地快照、预览摘要，并恢复指定快照。手动恢复前会自动保存一份“恢复前快照”；恢复只覆盖观时浏览器本地数据，不会修改 macOS 日历或提醒事项。

如果在线更新提示源码目录不干净，设置页会提供“备份并强制更新”。它会先把未跟踪文件和已跟踪改动保存到 `.runtime/update-backups`，再更新到稳定 tag。更新保护备份可以导出副本，或在明确确认后恢复到原位置；同名文件不会被覆盖。

## AI 与外部 Agent

v1.6.1 包含本地 AI 基础能力：Provider / BYOK 服务端配置、Domain Module Runtime 注册表、AI memory proposal、确定性排程草稿、AI action workflows、Guanshi MCP 外部 Agent 接入和隐私脱敏 guard。默认不会自动调用模型或自动改动待办、日历、提醒。

当前默认只启用时间管理模块。后续日记、记账、六爻等模块会通过独立 module manifest、记忆命名空间、工具权限和草稿确认规则接入，避免互相污染数据或越权写入。

AI 对话路由会优先使用模块工具 ID，例如 `time.parse_task`。未注册模块的工具不会被执行。

外部 Agent 可通过本地 stdio JSON-RPC MCP 入口接入：

```text
node .guanshi/mcp-server.js
```

MCP 客户端配置时建议使用绝对路径：

```json
{
  "mcpServers": {
    "guanshi": {
      "command": "node",
      "args": ["/path/to/guanshi-runtime/.guanshi/mcp-server.js"],
      "env": {
        "GUANSHI_DATA_DIR": "/path/to/guanshi-runtime/.runtime",
        "GUANSHI_MCP_CLIENT_ID": "codex-local"
      }
    }
  }
}
```

## 常见问题

- 如果提示找不到 Node.js，请先安装 Node.js LTS 版本。
- 如果提示当前 Node.js 不是 LTS，可以继续体验；长期使用建议换成 Node.js LTS。
- 如果提示找不到 Google Chrome，请先安装 Chrome，再重新双击启动脚本。
- 如果提示找不到 Git，可以继续使用观时；需要在线更新时再安装 Git。
- 观时默认使用 `http://127.0.0.1:8080/`，也可以在设置页修改下次启动端口。如果端口被其他程序占用，启动脚本会提示先处理占用，不会自动切到其他端口。
- 首次同步日历或提醒事项时，macOS 可能会询问权限，请按需要允许。
