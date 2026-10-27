# FX kantan! 交接

## 当前状态（2026-10-27，已取消分流；根域名外部1034仍待解决）
- 最新用户决定：不做分流、无需双库交换数据。考虑免费 Workers 每天100000动态请求及 D1 每天100000写入行、现有持仓10秒存档，采用 CF 固定托管静态网页 + API 转发原生 Sites 原有 D1。没有迁移或改动任何账户数据。静态资产绕过 Worker，只对 /api/* run_worker_first；API 转发仍消耗动态额度。
- 最新 Cloudflare 版本 febca5d1-fcfc-4604-be7b-d7149dd9e1dd 已100%上线，workers.dev 实测根页200真实app，无检测/分流页；旧 ?__served=1 也返回同一app；/api/health 200原生Sites健康JSON。Node gateway.test 和 account-network.test 通过，包含 POST body及Cookie/UUID不变、CORS、后端离线静态页仍可用、API返回JSON错误保留本地备份。
- 主站 https://fx-kantan.top/；原生 Sites https://fx-kantan-sim.ycn3258823137.chatgpt.site；GitHub https://chai-maomao.github.io/fx-kantan/。
- Cloudflare Worker https://fx-kantan-gateway.cardex-online.workers.dev，MAIN_ORIGIN 固定原生 Sites，账户 D1 后端没有迁移。
- 用户明确同意临时关闭 Spaceship DNSSEC 完成迁移并重新开启，且授权自主配置。
- Spaceship 已登录，NS 已保存为 etta.ns.cloudflare.com / finley.ns.cloudflare.com；Cloudflare zone 60c239ba4b1e936480eeb1b8ed748061 已 Active，Universal SSL Active。
- 旧 DS 删除后经 Google / Cloudflare DoH 确认无 DS 才切 NS。随后开启 Cloudflare DNSSEC 并在 Spaceship 发布新 DS：2371 13 2 2A4CADBAAB3ABAA61FBE365058944BB7D6901AB1D1DB20C72E045EF15FEBC29E。公共 DoH 已返回新 DS；Cloudflare UI 明确 Success! fx-kantan.top is protected with DNSSEC。不可再次关闭 DNSSEC 或乱切 NS。
- DNS 当前根记录是 Worker 自动管理的 AAAA（UI Type Worker）→fx-kantan-gateway。Worker Domains 同时存在 Production Custom Domain fx-kantan.top 和旧 Route fx-kantan.top/*，均 dashboard 管理。
- 原根 A（172.66.3.26 / 162.159.143.30）因 SaaS 路由冲突先改为占位值，再重命名 route-placeholder-1 / route-placeholder-2（192.0.2.1 / .2），未永久删除任何 DNS 记录。两条旧 TXT 保留，含补齐的 _openai-site-verification。
- 原 Sites 域名绑定 appgdom_6abb654b09308191b8a81378b0f4792e 已通过 Sites remove_custom_domain 解除，随后 list_custom_domains 返回空。因为旧 SaaS hostname 优先级盖住自有 Worker。原生 Sites 地址仍正常，账户数据未改变。
- 当前重大未完成项：本地 curl、内置浏览器访问根域名仍 Cloudflare 403 / error 1034，SIN 边缘。强制连接公共 DoH 返回的新 IP 104.21.45.196 / 172.67.218.127 仍 1034。同 IP 的 route-placeholder-1.fx-kantan.top/cdn-cgi/trace 外部访问 200，说明根域名特定外部映射仍有问题，不能宣称网站迁移全部完成，也不能仅凭内部200断言用户可访问。
- Cloudflare 服务器侧独立诊断 Worker 对根 / 返回200分流页，/?__served=1 两种 Cookie（fxk_route=main/cloud）均200真实 app，/api/health 200正常 JSON。内部路由与代码正常，外部 EIV/旧 SaaS 绑定清理或传播仍待核验。诊断结果保存在忽略目录 .cloudflare/migration-verification.json。
- 临时诊断 Worker fx-kantan-route-check 已清理：Wrangler delete 先删脚本后在 KV 读取报缺权限；直接 API DELETE 核验返回404 code10007 Worker不存在。不要误删正式 fx-kantan-gateway。
- 本地 CLI OAuth 仍缺 workers_routes/zone 权限；后续部署不能无意识覆盖 dashboard 域名及路由。不要再打开旧 OAuth 页面要求用户找按钮。
- 浏览器 handles：cfDomain=tab2（DNS Settings 成功 DNSSEC）；registrarTab=tab5（Spaceship DNSSEC 已显示一条新 DS）；migrationTestTab=tab6（根域名外部1034临时 QA）。密码未知，不得向聊天索要。
- 截图：workspace 父目录 dnssec-restored.png、cloudflare-domain-bound.png；请查看后用于用户结果凭证。
- 下一步先从外部 HTTPS 检查根分流页和 /__fxk/route；若仍1034，调查 Cloudflare 根 hostname 旧 SaaS/EIV 映射，保留 DNSSEC，新配置不要反复破坏。必要时安全恢复原主站绑定以减少停机，但这不等于完成分流目标。用户要求自主继续，无需重复普通配置授权；不得擅自付费或联系支持发消息。

## 原有交易功能
- GitHub 账户与榜单请求经 Cloudflare gateway，Origin 严格限定 GitHub，预检支持 Content-Type / X-FXK-Visitor-ID；镜像继续使用既有匿名 UUID，首次导入本地旧存档到原站 D1。
- 主站 Cookie 账户和 GitHub UUID 账户各自保留，不自动跨域合并；Cloudflare 原域名下切换网页线路始终代理同一个主站 Cookie 账户。
- 可用保证金 = 账户余额 − 已用保证金；浮动盈亏仅反映净值。追加保证金、仓位强平及存档机制保留。
- 图表启动同步浏览器恢复选项，按 from/to 日历时间取数，拒绝错币种/错周期或过期异步结果。

## 原有验证
- tests/chart.test.mjs、gateway.test.mjs、account-network.test.mjs、recovery.test.mjs、margin.test.mjs 全通过；增加 GitHub 账户 CORS/身份隔离、可用保证金不随浮盈浮亏变化用例。
- 发布顺序：先 Sites（提供镜像账户 API），再 Cloudflare（代理/CORS与静态资源），最后推 GitHub main 触发 Pages。

## 部署
- Sites plugin 1.1.2 的 site-workflow.mjs 已能在 Windows 正常打包。
- Cloudflare：node scripts/build-cloudflare.mjs；先 node .cloudflare/tools/node_modules/wrangler/bin/wrangler.js versions upload --config cloudflare/wrangler.jsonc，保留其返回真实version ID，再 versions deploy <ID>@100 --config cloudflare/wrangler.jsonc --yes。这条流程不修改 dashboard 管理的 triggers/custom domain/routes；不要再直接 wrangler deploy 覆盖域名绑定。
- .cloudflare/tools 为忽略的本地 Wrangler 4.152.0；安装需关闭失效的 127.0.0.1:7890 代理，显式 Windows workerd 依赖已修好。
- 不暴露源站凭据或 Cloudflare token。没有后台持续轮询所有离线账户，恢复时补算历史；数据不足且越线按单仓保证金结算。已结算旧账不追溯改写。

## 自动跟进
- 已更新当前聊天 heartbeat，automationId=fx，每15分钟核验外部1034并继续修复；明确取消分流与双库迁移，不得恢复旧方案；仅在完成或明确阻碍时通知，完成后暂停该跟进。
