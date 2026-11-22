export type Channel = 'wxpay' | 'alipay' | 'unionpay';
export interface ZhifuConfig {
    /** 支付FM API 根地址，例如 https://api-xxxx.zhifu.fm.it88168.com/api */
    baseUrl: string;
    /** 商户号 */
    mchNum: string;
    /** 商户 RSA2 私钥（支持裸 Base64 或 PEM） */
    privateKey: string;
    /** 平台 RSA2 公钥兜底值（支持裸 Base64 或 PEM，优先在线拉取并缓存） */
    platformPublicKey?: string;
    /** 异步回调通知地址 */
    notifyUrl: string;
    /** 支付完成同步回跳地址 */
    returnUrl?: string;
    /** 订单有效分钟数，默认 5（范围 1-15） */
    payDurationMin?: number;
    /** 请求超时毫秒数，默认 15000（查单/拉公钥默认 8000） */
    timeoutMs?: number;
    /** 平台公钥缓存时间（毫秒），默认 1 小时 */
    platformKeyTtlMs?: number;
    /** queryOutOrder 无权限(6003)后的熔断冷却时间（毫秒），默认 10 分钟 */
    queryDisabledTtlMs?: number;
}
export interface CreateOrderInput {
    channel: Channel;
    outTradeNo: string;
    /** 订单金额（单位：分） */
    cents: number;
    subject?: string;
    body: string;
    notifyUrl?: string;
    returnUrl?: string;
    payDurationMin?: number;
}
export interface CreateOrderResult {
    payUrl: string;
    platformOrderId: string;
}
export interface QueryOrderResult {
    paid: boolean;
    noPermission?: boolean;
    payNo?: string;
    totalFee?: string;
}
export interface NotifyParseResult {
    verified: boolean;
    paid: boolean;
    outTradeNo: string;
    platformOrderNo: string;
    amount: string;
    amountCents: number;
    raw: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map