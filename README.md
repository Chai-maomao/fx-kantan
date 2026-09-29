# FX kantan!

娱乐型外汇模拟交易网页，使用 [BiQuote](https://biquote.io/docs/) 提供的实时外汇买卖报价和 5 分钟 K 线。所有资金、订单及盈亏都是虚拟的，不会连接真实交易账户。

## 使用

打开已发布的网站即可游玩。若要在本地预览，使用任意静态网页服务器提供 `dist` 文件夹；无需安装依赖或配置 API 密钥。

选择 EUR/USD、GBP/USD、AUD/USD 或 NZD/USD，输入交易数量（1,000 到 1,000,000，整千），点击买入或卖出。持仓可按当前买卖价平仓。账户默认 10,000 美元，使用 20 倍模拟杠杆。行情关闭、过期或连接失败时交易按钮会停用。

账户记录只保存在当前浏览器。更换设备、清除浏览器数据或使用无痕模式会失去记录。网页没有用户账户、排行榜或真实交易功能。

## 素材与来源

- 行情：[BiQuote API](https://biquote.io/docs/)。网站依赖其公开接口和跨域访问；若服务或接口政策变动，行情可能不可用。
- 角色插画：[oksmith / Open Clip Art Library](https://commons.wikimedia.org/wiki/File:Anime_girl_publicdomainq.png)，[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。
- 创作灵感：《FX战士久留美》；本项目与作品版权方无关联。[作品官网](https://fxkurumi-info.com/)。网站未使用该作品的图片或角色。
- 官方影像：页面展示 YouTube 提供的 [KADOKAWAanime 主预告](https://www.youtube.com/watch?v=YcDX0ndqzqw)与[视觉预告](https://www.youtube.com/watch?v=rZwpVLm00bs)预览图，点击进入官方频道。网站不保存影像文件、剧照或海报。

## 技术说明

静态 HTML、CSS、JavaScript。报价每 5 秒更新；图表每分钟更新。开仓以 `ask` 买入或 `bid` 卖出，平仓采用相反报价。网页只供娱乐，不代表可成交的真实市场价格。
