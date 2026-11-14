# DNSHE 自动续期 Worker

用 Cloudflare Workers 定期为一个 DNSHE 域名办理免费续期。每周一北京时间 09:17 检查一次，域名仍有效且距离到期超过 24 小时、最多 90 天时，调用 DNSHE 的续期接口。Cloudflare KV 记录最近一次检查结果。

## 在 Cloudflare 网页部署

### 1. 导入 GitHub 仓库

打开 **Workers 和 Pages → 创建应用程序 → 连接 GitHub**，选择 `innboom/dnshe-auto-renew` 或你自己的 Fork。授权 GitHub 时，让 Cloudflare 能访问所选仓库。

| 部署设置 | 填写内容 |
| --- | --- |
| Worker 名称 | `dnshe-auto-renew`，与仓库里的 `wrangler.jsonc` 一致 |
| 生产分支 | `main` |
| 根目录 | 仓库根目录，保留默认值 |
| 构建命令 | 留空 |
| 部署命令 | `npx wrangler deploy` |

点击**部署**。Wrangler 会根据仓库配置自动创建 KV 命名空间、绑定为 `RENEWAL_STATE`，并配置 Cron。部署成功后继续填写下面的三个字段。

### 2. 添加三个生产环境字段

先在 **DNSHE 控制台 → 域名管理 → API 管理**创建一组能查询域名和提交续期的 API 凭据。然后打开 **Cloudflare → Workers 和 Pages → dnshe-auto-renew → 设置 → 运行时变量和密钥 → 生产 → 添加变量**。

| 名称（区分大小写） | 类型 | 值填什么 |
| --- | --- | --- |
| `DNSHE_DOMAIN` | 文本（Text） | 在 DNSHE 注册的完整域名，例如 `myapp.us.ci`。只填域名，省略 `https://` 和路径。 |
| `DNSHE_API_KEY` | 密钥（Secret） | DNSHE「API 管理」生成的 API Key。 |
| `DNSHE_API_SECRET` | 密钥（Secret） | 与上面 API Key 配套的 API Secret。 |

添加后点击**部署**使设置生效。回到同一页面，应看到三行记录，其中两个密钥显示「值已加密」。凭据只填在 Worker 的 Secret 字段里。仓库已设置 `keep_vars: true`，后续 Git 部署会保留控制台里的域名变量和已配置的密钥。

### 3. 检查首次运行

1. 在 Worker 的**绑定**中确认有 `RENEWAL_STATE`，在定时触发器中确认有 `17 1 * * MON`，即北京时间每周一 **09:17**。
2. 首次定时运行后，点击 **设置 → 绑定**里的 KV 命名空间，打开 **KV 条目 → `last_check`**。检查 `checkedAt` 是否是最近一次运行的时间（UTC），然后查看 `outcome`。新注册的域名通常会显示 `not_due`，表示查询成功，当前无需续期。
3. 如果定时点过去后仍没有 `last_check`，或状态为 `error`，到 Worker 的 **可观测性（Observability）→ 日志**查看运行记录。其他状态见下方「检查运行结果」。

## 可选的本地初始化

需要 Node.js 22 或更新版本，以及拥有 Workers 和 Workers KV 权限的 Cloudflare 账户。在项目目录运行以下命令。Windows 如果禁止运行 npm 的 PowerShell 脚本，可将命令里的 `npm`、`npx` 改为 `npm.cmd`、`npx.cmd`。

```sh
npm install
npx wrangler login
npm run setup
```

输入在 DNSHE 注册的完整域名，例如 `myapp.de5.net`，并选择 Worker 名称。初始化会生成本地 `wrangler.local.jsonc`、创建并绑定 KV，然后部署 Worker 和 Cron Trigger。后续可重新运行 `npm run setup` 沿用该配置，或运行 `npx wrangler deploy --config wrangler.local.jsonc`。

### 本地部署后填写密钥

在 DNSHE 控制台打开 **域名管理 → API 管理**，创建可读取域名和提交续期的凭据。到 Cloudflare **Workers 和 Pages → 你的 Worker → Settings → Variables and Secrets**，以 **Secret** 类型分别添加 `DNSHE_API_KEY`、`DNSHE_API_SECRET`，并发布配置。也可以在终端交互式输入：

```sh
npx wrangler secret put DNSHE_API_KEY --config wrangler.local.jsonc
npx wrangler secret put DNSHE_API_SECRET --config wrangler.local.jsonc
```

本地初始化时，域名保存在本地 Wrangler 配置的 `DNSHE_DOMAIN` 变量中。KV 里的 `last_check` 保存状态、检查时间和已知到期日。Worker 只通过定时事件运行，密钥通过 Secrets 注入。

## 检查运行结果

想先验证凭据，可用 [DNSHE 的域名列表 API](https://github.com/dnshe/DNSHE-FreeDomains/blob/main/docs/api.md#11-list-domains) 做一次只读查询。定时运行后，在 Worker 的日志里检查结果，或打开 Cloudflare 的 Workers KV 命名空间查看 `last_check`。

- `not_due` 表示已查到域名且还未到脚本的续期时间。
- `never_expires` 表示 DNSHE 标记为免续期。
- `renewed` 表示 API 返回了更晚的到期日且费用为零。可去 DNSHE 控制台对照日期。
- `error` 表示本次失败。检查 Worker 日志和 DNSHE 控制台。如果续期请求超时，先在 DNSHE 查询到期日。下一次定时运行也会重新读取状态后再决定是否续期。

项目使用 [DNSHE 续期 API](https://github.com/dnshe/DNSHE-FreeDomains/blob/main/docs/api.md#15-renew-a-domain) 和 [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
