# FX kantan!

娱乐型外汇模拟交易网页，使用 [BiQuote](https://biquote.io/docs/) 提供的实时外汇买卖报价和 OHLC 图表。所有资金、订单及盈亏都是虚拟的，不会连接真实交易账户。

## 使用

打开已发布的网站即可游玩。若要在本地预览，使用任意静态网页服务器提供 `dist` 文件夹；无需安装依赖或配置 API 密钥。

从 14 个主流与日元相关货币对中选择品种，切换 K 线或分时线，并选择周期与跨度。输入交易数量（1,000 到 1,000,000，整千）和 1× 至 100× 的模拟杠杆后，可以买入或卖出。持仓可按当前买卖价平仓。账户默认 10,000 美元；调整杠杆只影响后续新仓的保证金。行情关闭、过期或连接失败时交易按钮会停用。

账户记录只保存在当前浏览器。更换设备、清除浏览器数据或使用无痕模式会失去记录。网页没有用户账户、排行榜或真实交易功能。

## 素材与来源

- 行情：[BiQuote API](https://biquote.io/docs/)。优先使用其 SignalR WebSocket 的逐笔推送；连接失败时每 3 秒批量轮询一次，连接成功时每 30 秒批量校准。图表使用官方 OHLC 接口。网站依赖其公开接口；若服务或接口政策变动，行情可能不可用。
- WebSocket 客户端：Microsoft SignalR 8.0.0，许可证见 [dist/assets/signalr.LICENSE.txt](dist/assets/signalr.LICENSE.txt)。
- 主视觉图片：由用户提供，用于本项目首页。
- 创作灵感：《FX战士久留美》；本项目与作品版权方无关联。[作品官网](https://fxkurumi-info.com/)。
- 官方影像：页面展示 YouTube 提供的 [KADOKAWAanime 主预告](https://www.youtube.com/watch?v=YcDX0ndqzqw)与[视觉预告](https://www.youtube.com/watch?v=rZwpVLm00bs)预览图，点击进入官方频道；这些预览图不在本站保存。

## 技术说明

静态 HTML、CSS、JavaScript。分时线按所选 OHLC 周期的收盘价绘制，当前周期随最新 Tick 更新；图表每 20 秒与服务端同步。开仓以 `ask` 买入或 `bid` 卖出，平仓采用相反报价。非美元报价的持仓盈亏按相应 USD 货币对的最新中间价换算为美元。网页只供娱乐，不代表可成交的真实市场价格。
