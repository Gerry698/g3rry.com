# 留言板

访客在 [/guestbook/](https://g3rry.com/guestbook/) 留言，**先审后发**：新留言进入待审队列，在后台通过后才公开。

## 组成

| 部分 | 位置 | 作用 |
| --- | --- | --- |
| 留言页 | `src/guestbook.html`、`src/guestbook.js` | 随网站构建，GitHub Pages 发布；只用 `textContent` 显示留言 |
| 公开 Worker `guestbook` | `guestbook/src/public.js`，路由 `g3rry.com/api/guestbook*` | 列出已通过的留言；接收新留言（待审） |
| 后台 Worker `guestbook-admin` | `guestbook/src/admin.js`、`guestbook/src/admin-ui/`，域名 `admin.g3rry.com` | 审核、回复、删除、关闭投稿；每 15 分钟发待审摘要邮件并清理过期数据 |
| 数据库 | D1 `guestbook`，结构见 `guestbook/migrations/` | 留言、封禁、操作记录、设置 |

两个 Worker 分开部署：公开 Worker 里没有任何管理代码。

## 日常审核

- 打开 <https://admin.g3rry.com/>，在 Cloudflare Access 登录页点 "Cloudflare"，用 Cloudflare 账户（QQ 邮箱）登录，登录状态保持 24 小时。
- **待审**：通过 / 隐藏 / 标为垃圾 / 垃圾并封禁 30 天 / 永久删除。每条显示时间、国家、网络地址哈希前 8 位和同一地址的留言数，以及可疑标记（含链接、重复字符、与其他留言重复）。
- **已发布 · 页面预览**：按页面上的顺序显示，置顶在前。
  - 顶部可以以 Gerry 身份直接留言：不经审核，页面上带 "Site owner" 标记。这个标记只来自后台写入的 `owner` 字段，访客取什么名字都得不到（Gerry 这个名字本身也是保留的）。
  - 每条可以置顶或取消置顶、撤下、永久删除。置顶分两层：自己的留言在最上面，访客留言的"二级置顶"排在其后，同一层里最新置顶的在前；两层合计最多 3 条。撤下的留言同时取消置顶。
  - 访客留言可以写回复或改回复（显示为 "Gerry replied"），自己的留言可以编辑。访客的留言不能编辑：改了就等于替别人说话，要处理就撤下。
  - 改动最多 1 分钟后出现在页面上（公开列表缓存 60 秒）。
- **已隐藏**：隐藏和垃圾留言在处理 30 天后自动永久删除，此前可以"恢复并发布"。
- 遇到垃圾潮：用"全部待审标为垃圾"，或右上角"关闭投稿"。关闭后页面表单停用，已发布的留言照常显示。
- 有新的待审留言时，每 15 分钟最多一封摘要邮件发到 QQ 邮箱，发件人 "g3rry.com guestbook" <guestbook@g3rry.com>。邮件里以 `>` 开头的行是访客写的内容，不是系统链接。
- 新域名发信量太少，QQ 邮箱可能把摘要放进广告邮件：标记"这不是广告"，并把 `guestbook@g3rry.com` 加进 QQ 邮箱的发件人白名单。SPF、DKIM、DMARC 已经配好，发件方这边没有更多能保证进收件箱的办法。

## 安全措施

| 威胁 | 措施 |
| --- | --- |
| 机器人和垃圾 | Turnstile 服务端校验（主机名、action、一次性）；隐藏字段；WAF 每 IP 10 秒 20 次；Worker 每地址每分钟 3 次投稿；每地址每天 10 条、同时待审最多 3 条；全站待审上限 200；被封禁地址静默丢弃 |
| XSS | 留言只当纯文本存储和显示；页面脚本禁止 `innerHTML` 等写法（`npm run check` 检查）；CSP；后台启用 Trusted Types |
| 伪装和隐藏文字 | 删除不可见格式字符、双向控制字符、零宽字符和标签字符；限制叠加符号；保留 Gerry/admin 等名字；站主标记只由后台写入，不看名字 |
| 后台越权 | Access 登录 + Worker 自己再校验 Access JWT（签名、签发方、受众、过期、邮箱白名单）；关闭 workers.dev 和预览地址 |
| 跨站请求 | 所有写操作只收同源 JSON，校验 `Origin` 和 `Sec-Fetch-Site` |
| SQL 注入 | 全部参数绑定 |
| 隐私 | 不收邮箱和网址；网络地址只存带密钥的哈希（IPv6 取 /64），连同国家 30 天后清除；日志不记录内容和地址 |

已知风险：Workers 免费版每天 10 万次请求是整个账户共用的，和 `cloud-mail` 共享。WAF 规则能挡单个 IP 的刷量，挡不住大规模分布式攻击；真遇到时升级 Workers Paid（每月 5 美元）。

## 本地开发与测试

```powershell
cd guestbook
npm ci
npm test          # 用 wrangler 打包两个 Worker，在 workerd 里跑全部测试
```

端到端预览（假 Turnstile、假 Access，本地数据库每次启动都是空的）：

```powershell
$env:GUESTBOOK_SITEKEY = "1x00000000000000000000AA"; npm run build   # 仓库根目录
cd guestbook; npm run dev   # 留言页 http://localhost:4173/guestbook/ ，后台 http://localhost:8788/
```

## 部署

Worker 不随 `main` 自动部署，在本机执行（需要先 `npx wrangler login`）：

```powershell
cd guestbook
npm ci
npm test
npx wrangler d1 migrations apply guestbook --remote
npx wrangler deploy -c wrangler.public.jsonc
npx wrangler deploy -c wrangler.admin.jsonc
```

网站页面仍随 `main` 由 Pages 工作流发布。PR 上会额外运行 `.github/workflows/guestbook.yml` 测试 Worker。

## 密钥与配置

密钥用 `npx wrangler secret put <名字> -c <配置文件>` 设置，或者在 Cloudflare 控制台 Workers & Pages → 对应 Worker → Settings → Variables and secrets 里添加（勾选 Secret，已有的点 Edit → Rotate 替换），不进仓库（仓库是公开的）。`TURNSTILE_SECRET_KEY` 要复制 Turnstile 组件的 Secret Key，不是页面上直接显示的 Site Key；填错时提交一律返回 503，日志里是 `invalid-input-secret`。

| Worker | 密钥 | 内容 |
| --- | --- | --- |
| `guestbook` | `TURNSTILE_SECRET_KEY` | Turnstile 组件 "g3rry.com guestbook" 的 Secret key |
| `guestbook` | `IP_PEPPER` | 随机生成的长字符串，用于网络地址哈希。更换后旧哈希全部失效，现有封禁也随之失效 |
| `guestbook-admin` | `ADMIN_EMAILS` | 允许登录后台的邮箱，逗号分隔 |
| `guestbook-admin` | `NOTIFY_TO` | 摘要邮件收件人，必须是 Email Routing 里已验证的地址 |

`wrangler.admin.jsonc` 里的 `ACCESS_TEAM_DOMAIN`（Zero Trust 团队域名）和 `ACCESS_AUD`（Zero Trust → Access controls → Applications → "Guestbook admin" → Additional settings → AUD tag）不是密钥。留空时后台一律拒绝访问；改团队名或重建应用后要同步更新并重新部署后台。

Cloudflare 后台的相关设置：

- Turnstile 组件 "g3rry.com guestbook"，域名只有 `g3rry.com`。
- WAF 限流规则 "Guestbook API flood guard"。
- Zero Trust Free，团队 `young-bonus-b4b8`。Access 应用 "Guestbook admin" 保护 `admin.g3rry.com`：策略 "Guestbook owner only" 只放行 QQ 邮箱；登录方式是 Cloudflare 账户（账户里有身份提供方时不显示一次性验证码）；Cookie 设为 HttpOnly、绑定 Cookie、SameSite=Lax。
- Email Routing 收件地址：QQ 邮箱。

## 应急

- **立刻停止新留言**：后台"关闭投稿"。后台不可用时：
  ```powershell
  npx wrangler d1 execute guestbook --remote --command "UPDATE settings SET value = '0' WHERE key = 'submissions_open'"
  ```
- **整体下线 API**：在 Workers 里删除 `guestbook` 的路由，或者 `npx wrangler delete -c wrangler.public.jsonc`。留言页会显示 "The notes could not load just now."。
- **误删恢复**：D1 Time Travel 可以回到 7 天内的任意时间点（免费版）。这会覆盖整个数据库：
  ```powershell
  npx wrangler d1 time-travel restore guestbook --timestamp=<UNIX 秒>
  ```
- **备份**：`npx wrangler d1 export guestbook --remote --output guestbook-backup.sql`。导出文件含访客数据，不要放进仓库。
