# FX kantan! 交接

## 当前状态
- 主站 https://fx-kantan.top/；原生 Sites https://fx-kantan-sim.ycn3258823137.chatgpt.site；GitHub https://chai-maomao.github.io/fx-kantan/。
- Cloudflare Worker https://fx-kantan-gateway.cardex-online.workers.dev，配置 cloudflare/wrangler.jsonc，MAIN_ORIGIN 固定原生 Sites 防止代理循环。
- fx-kantan.top 已通过用户登录的 Cloudflare UI 加入 Free，当前仍是 pending nameserver。扫描记录有两个根 A（172.66.3.26 / 162.159.143.30）及 _cf-custom-hostname TXT。没有修改 Spaceship NS，也未关闭 DNSSEC。
- Cloudflare 分配 NS：etta.ns.cloudflare.com、finley.ns.cloudflare.com。当前旧 NS：launch1.spaceship.net、launch2.spaceship.net。激活前核对/迁移 DNSSEC，不能直接带旧 DS 换 NS。
- 已打开 Wrangler OAuth 授权页，等待用户点击 Authorize（新增 workers_routes:write、zone:read；保留现有 account/user/workers_scripts/d1 范围）。授权会话有时效，超时需重新运行 login；不要自行创建/索取 API token。

## 本次更改
- GitHub 账户与榜单请求经 Cloudflare gateway，Origin 严格限定 GitHub，预检支持 Content-Type / X-FXK-Visitor-ID；镜像继续使用既有匿名 UUID，首次导入本地旧存档到原站 D1。
- 主站 Cookie 账户和 GitHub UUID 账户各自保留，不自动跨域合并；Cloudflare 原域名下切换网页线路始终代理同一个主站 Cookie 账户。
- 可用保证金 = 账户余额 − 已用保证金；浮动盈亏仅反映净值。追加保证金、仓位强平及存档机制保留。
- 图表启动同步浏览器恢复选项，按 from/to 日历时间取数，拒绝错币种/错周期或过期异步结果。

## 验证
- tests/chart.test.mjs、gateway.test.mjs、account-network.test.mjs、recovery.test.mjs、margin.test.mjs 全通过；增加 GitHub 账户 CORS/身份隔离、可用保证金不随浮盈浮亏变化用例。
- 发布顺序：先 Sites（提供镜像账户 API），再 Cloudflare（代理/CORS与静态资源），最后推 GitHub main 触发 Pages。

## 部署
- Sites plugin 1.1.2 的 site-workflow.mjs 已能在 Windows 正常打包。
- Cloudflare：node scripts/build-cloudflare.mjs；node .cloudflare/tools/node_modules/wrangler/bin/wrangler.js deploy --config cloudflare/wrangler.jsonc。
- .cloudflare/tools 为忽略的本地 Wrangler 4.152.0；安装需关闭失效的 127.0.0.1:7890 代理，显式 Windows workerd 依赖已修好。
- 不暴露源站凭据或 Cloudflare token。没有后台持续轮询所有离线账户，恢复时补算历史；数据不足且越线按单仓保证金结算。已结算旧账不追溯改写。
