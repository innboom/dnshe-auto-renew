# DNSHE 自动续期 Worker

用 Cloudflare Workers 定期为一个 DNSHE 域名办理免费续期。每周一北京时间 09:17 检查一次，域名仍有效且距离到期超过 24 小时、最多 90 天时，调用 DNSHE 的续期接口。Cloudflare KV 记录最近一次检查结果。

## 从 GitHub 导入到 Cloudflare

1. 在 Cloudflare 打开 **Workers 和 Pages → 创建应用程序 → GitHub**，选择此仓库的 `main` 分支。
2. Worker 名称填 `dnshe-auto-renew`，根目录保持仓库根目录，构建命令留空，部署命令保留默认的 `npx wrangler deploy`。
3. 点击部署。仓库根目录的 `wrangler.jsonc` 声明了 Cron 和 `RENEWAL_STATE` 绑定。Wrangler 部署时会自动创建并绑定 KV，后续部署会沿用该绑定。
4. 到 Worker 的 **Settings → Variables and Secrets** 添加 `DNSHE_DOMAIN`（Text，填完整域名）、`DNSHE_API_KEY`（Secret）和 `DNSHE_API_SECRET`（Secret），然后部署配置。密钥在 DNSHE 的 **域名管理 → API 管理** 中创建。

请把这三项填在 Worker 的运行时设置里。后续从 GitHub 部署时，`keep_vars` 会保留控制台填写的域名变量，Wrangler 也会保留已配置的 Secrets。部署完成后可在 **Bindings** 核对 KV，并在定时触发器中核对 `17 1 * * MON`。

## 可选的本地初始化

需要 Node.js 22 或更新版本，以及拥有 Workers 和 Workers KV 权限的 Cloudflare 账户。在项目目录运行以下命令。Windows 如果禁止运行 npm 的 PowerShell 脚本，可将命令里的 `npm`、`npx` 改为 `npm.cmd`、`npx.cmd`。

```sh
npm install
npx wrangler login
npm run setup
```

输入在 DNSHE 注册的完整域名，例如 `myapp.de5.net`，并选择 Worker 名称。初始化会生成本地 `wrangler.local.jsonc`、创建并绑定 KV，然后部署 Worker 和 Cron Trigger。后续可重新运行 `npm run setup` 沿用该配置，或运行 `npx wrangler deploy --config wrangler.local.jsonc`。

## 填写密钥

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
