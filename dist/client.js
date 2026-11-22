import { normalizePem, rsa2Sign, rsa2Verify } from './sign.js';
const PAY_TYPE_MAP = {
    wxpay: 'tloop',
    alipay: 'aloop',
    unionpay: 'bloop',
};
const DEFAULT_PLATFORM_KEY_TTL_MS = 60 * 60 * 1000;
const DEFAULT_QUERY_DISABLED_TTL_MS = 10 * 60 * 1000;
export function createZhifuClient(cfg) {
    const platformKeyTtlMs = cfg.platformKeyTtlMs ?? DEFAULT_PLATFORM_KEY_TTL_MS;
    const queryDisabledTtlMs = cfg.queryDisabledTtlMs ?? DEFAULT_QUERY_DISABLED_TTL_MS;
    const createTimeoutMs = cfg.timeoutMs ?? 15000;
    const shortTimeoutMs = Math.min(cfg.timeoutMs ?? 8000, 8000);
    let cachedPlatformKey = null;
    let queryDisabledUntil = 0;
    function getApiBase() {
        const root = cfg.baseUrl.replace(/\/+$/, '');
        return root.endsWith('/api') ? root : `${root}/api`;
    }
    function getPageBase() {
        const root = cfg.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
        if (!root.includes('://api-'))
            return null;
        return root.replace('://api-', '://page-');
    }
    function configured() {
        return Boolean(cfg.baseUrl
            && cfg.mchNum
            && cfg.privateKey
            && cfg.notifyUrl
            && !cfg.mchNum.startsWith('encrypted:'));
    }
    async function getPlatformPublicKey(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cachedPlatformKey && now - cachedPlatformKey.fetchedAt < platformKeyTtlMs) {
            return cachedPlatformKey.pem;
        }
        try {
            const res = await fetch(`${getApiBase()}/platformRsaPublicKey`, {
                signal: AbortSignal.timeout(shortTimeoutMs),
            });
            const json = (await res.json());
            const rawKey = json?.data?.publicKeyPem || json?.data?.publicKey || '';
            const pem = normalizePem(rawKey, 'PUBLIC KEY');
            if (json?.success && pem) {
                cachedPlatformKey = { pem, fetchedAt: now };
                return pem;
            }
        }
        catch (err) {
            console.warn('[zhifufm] 获取平台公钥失败，尝试使用本地配置或缓存:', err);
        }
        if (cachedPlatformKey)
            return cachedPlatformKey.pem;
        return normalizePem(cfg.platformPublicKey || '', 'PUBLIC KEY');
    }
    async function createOrder(opts) {
        const durationMin = Math.min(15, Math.max(1, opts.payDurationMin ?? cfg.payDurationMin ?? 5));
        const params = {
            merchant_id: cfg.mchNum,
            orderNo: opts.outTradeNo,
            amount: (opts.cents / 100).toFixed(2),
            payType: PAY_TYPE_MAP[opts.channel],
            notifyUrl: opts.notifyUrl || cfg.notifyUrl,
            subject: (opts.subject || opts.body).slice(0, 100),
            body: opts.body.slice(0, 200),
            payDuration: String(durationMin),
            returnType: 'json',
            timestamp: Math.floor(Date.now() / 1000).toString(),
        };
        const returnUrl = opts.returnUrl ?? cfg.returnUrl;
        if (returnUrl)
            params.returnUrl = returnUrl;
        params.sign = rsa2Sign(params, cfg.privateKey);
        const qs = new URLSearchParams(params).toString();
        const res = await fetch(`${getApiBase()}/v2/startOrder?${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(createTimeoutMs),
        });
        const json = (await res.json().catch(() => null));
        if (!res.ok || !json?.success || !json.data?.payUrl) {
            throw new Error(json?.msg || `支付下单失败（HTTP ${res.status}）`);
        }
        return {
            payUrl: json.data.payUrl,
            platformOrderId: String(json.data.id || ''),
        };
    }
    async function queryOrderByPlatformId(outTradeNo, platformOrderId) {
        const pageBase = getPageBase();
        const orderId = platformOrderId.trim();
        if (!pageBase || !orderId)
            return null;
        try {
            const res = await fetch(`${pageBase}/api/getOrderGatheringCode?orderNo=${encodeURIComponent(orderId)}`, { signal: AbortSignal.timeout(shortTimeoutMs) });
            const json = (await res.json().catch(() => null));
            if (!res.ok || !json?.success || !json.data)
                return null;
            if (String(json.data.mchOrderNo || '') !== outTradeNo)
                return { paid: false };
            if (String(json.data.orderState || '') === '4') {
                return {
                    paid: true,
                    payNo: String(json.data.orderNo || json.data.id || orderId),
                    totalFee: String(json.data.gatheringAmount ?? ''),
                };
            }
            return { paid: false };
        }
        catch {
            return null;
        }
    }
    async function verifyNotify(data) {
        const mchNum = String(data.merchantNum || data.merchant_id || '');
        if (!mchNum || mchNum !== cfg.mchNum)
            return false;
        // GET 回调查询串里 Base64 的 '+' 会被 URLSearchParams 解码成空格，验签前还原。
        const signV2 = String(data.sign_v2 || '').trim().replace(/ /g, '+');
        if (signV2 && data.timestamp) {
            const pubKey = await getPlatformPublicKey(false);
            if (rsa2Verify(data, signV2, pubKey))
                return true;
            // 平台轮换密钥时刷新一次公钥再验
            const refreshed = await getPlatformPublicKey(true);
            if (refreshed && refreshed !== pubKey && rsa2Verify(data, signV2, refreshed))
                return true;
        }
        // 重试或补发回调可能丢失 sign_v2/timestamp 或增删附加参数，向官方收银台查单接口二次核实。
        const outTradeNo = String(data.orderNo || '').trim();
        const platformOrderNo = String(data.platformOrderNo || '').trim();
        if (!outTradeNo || !platformOrderNo)
            return false;
        const verified = await queryOrderByPlatformId(outTradeNo, platformOrderNo);
        if (!verified?.paid)
            return false;
        const notifyAmount = String(data.amount ?? '').trim();
        if (notifyAmount && verified.totalFee) {
            const notifyCents = Math.round(Number(notifyAmount) * 100);
            const verifiedCents = Math.round(Number(verified.totalFee) * 100);
            if (!Number.isFinite(notifyCents) || !Number.isFinite(verifiedCents) || notifyCents !== verifiedCents) {
                return false;
            }
        }
        return true;
    }
    async function parseNotify(data) {
        const verified = await verifyNotify(data);
        const amount = String(data.amount ?? '').trim();
        const parsedAmount = Number(amount);
        const amountCents = amount && Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) : 0;
        return {
            verified,
            paid: verified && String(data.state) === '1',
            outTradeNo: String(data.orderNo || '').trim(),
            platformOrderNo: String(data.platformOrderNo || '').trim(),
            amount,
            amountCents,
            raw: data,
        };
    }
    async function queryOrder(outTradeNo, platformOrderId) {
        if (!configured())
            return null;
        if (Date.now() < queryDisabledUntil) {
            return platformOrderId ? queryOrderByPlatformId(outTradeNo, platformOrderId) : null;
        }
        const params = {
            merchantNum: cfg.mchNum,
            orderNo: outTradeNo,
            timestamp: Math.floor(Date.now() / 1000).toString(),
        };
        params.sign = rsa2Sign(params, cfg.privateKey);
        try {
            const qs = new URLSearchParams(params).toString();
            const res = await fetch(`${getApiBase()}/v2/queryOutOrder?${qs}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                signal: AbortSignal.timeout(shortTimeoutMs),
            });
            const json = (await res.json().catch(() => null));
            if (!json) {
                return platformOrderId ? queryOrderByPlatformId(outTradeNo, platformOrderId) : null;
            }
            if (json.code === 6003) {
                queryDisabledUntil = Date.now() + queryDisabledTtlMs;
                if (platformOrderId) {
                    const fallback = await queryOrderByPlatformId(outTradeNo, platformOrderId);
                    if (fallback)
                        return fallback;
                }
                return { paid: false, noPermission: true };
            }
            if (!json.success || !json.data)
                return { paid: false };
            if (String(json.data.orderState) === '4') {
                return {
                    paid: true,
                    payNo: String(json.data.orderId || ''),
                    totalFee: String(json.data.amount || json.data.tradeMoney || ''),
                };
            }
            return { paid: false };
        }
        catch {
            return platformOrderId ? queryOrderByPlatformId(outTradeNo, platformOrderId) : null;
        }
    }
    return {
        configured,
        getPlatformPublicKey,
        createOrder,
        queryOrderByPlatformId,
        queryOrder,
        verifyNotify,
        parseNotify,
    };
}
//# sourceMappingURL=client.js.map