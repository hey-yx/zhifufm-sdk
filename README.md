# zhifufm-sdk

支付FM V2 轻量 TypeScript / Bun / Node.js SDK，零第三方运行时依赖（仅使用 `node:crypto` 与标准 `fetch`）。

## 特性

- **下单 (`createOrder`)**：自动映射支付渠道（`wxpay` / `alipay` / `unionpay`）、格式化金额（分 -> 元）、RSA2 签名。
- **异步回调验签 (`verifyNotify` / `parseNotify`)**：
  - 自动拉取并缓存平台 RSA2 公钥（支持密钥轮换时自动刷新重验）。
  - 自动还原 GET 回调查询串中 `+` 被解码为空格的签名。
  - 当补发/重试回调丢失 `sign_v2` 时，自动通过官方收银台查单接口二次核实并校验金额一致性。
- **主动查单 (`queryOrder`)**：优先调用 `/v2/queryOutOrder`，遇到 `6003` 无权限或异常时自动熔断并降级到收银台查单接口兜底。
- **多实例隔离**：每个 `createZhifuClient` 实例独立维护公钥缓存与熔断状态，支持同进程多商户。

## 安装

直接从 GitHub 安装（推荐指定 tag，Docker 构建无需 `git`）：

```bash
bun add https://github.com/hey-yx/zhifufm-sdk/archive/refs/tags/v0.1.0.tar.gz
# 或
npm install https://github.com/hey-yx/zhifufm-sdk/archive/refs/tags/v0.1.0.tar.gz
```

## 快速开始

```ts
import { createZhifuClient } from 'zhifufm-sdk'

const pay = createZhifuClient({
  baseUrl: process.env.ZHIFU_BASE_URL || 'https://api-xxxx.zhifu.fm.it88168.com/api',
  mchNum: process.env.ZHIFU_MCH_NUM!,
  privateKey: process.env.ZHIFU_PRIVATE_KEY!,
  platformPublicKey: process.env.ZHIFU_PLATFORM_PUBLIC_KEY, // 可选兜底
  notifyUrl: process.env.ZHIFU_NOTIFY_URL!,
  returnUrl: process.env.ZHIFU_RETURN_URL, // 可选
  payDurationMin: 5, // 可选，1-15 分钟，默认 5
})

// 1. 检查配置是否完整
if (!pay.configured()) {
  throw new Error('支付通道未配置')
}

// 2. 创建订单（金额单位：分）
const { payUrl, platformOrderId } = await pay.createOrder({
  channel: 'wxpay', // 'wxpay' | 'alipay' | 'unionpay'
  outTradeNo: 'ORD20261122001',
  cents: 399,
  subject: '会员充值',
  body: '会员充值 3.99 元',
})

// 3. 处理异步回调（GET query + POST body 合并后传入）
const notify = await pay.parseNotify({ ...query, ...body })
if (!notify.verified) {
  return 'fail'
}
if (notify.paid) {
  // 核对 notify.amountCents 与本地订单金额后入账
}
return 'success'

// 4. 主动查单（用于前端轮询兜底）
const status = await pay.queryOrder('ORD20261122001', platformOrderId)
if (status?.paid) {
  // 已支付
}
```

## 导出列表

- `createZhifuClient(config)`：创建客户端实例
- `normalizePem(raw, label)`：将裸 Base64 或含 `\n` 的密钥标准化为 PEM 格式
- `buildSignString(params)`：按 ASCII 字典序拼接待签名参数（自动剔除 `sign`、`sign_v2` 等字段）
- `rsa2Sign(params, privateKey)`：RSA-SHA256 签名
- `rsa2Verify(params, signatureBase64, publicKey)`：RSA-SHA256 验签

## 开发与测试

```bash
bun install
bun test
bun run typecheck
bun run build
```
