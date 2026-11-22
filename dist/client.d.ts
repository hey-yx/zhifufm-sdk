import type { CreateOrderInput, CreateOrderResult, NotifyParseResult, QueryOrderResult, ZhifuConfig } from './types.js';
export interface ZhifuClient {
    configured(): boolean;
    getPlatformPublicKey(forceRefresh?: boolean): Promise<string>;
    createOrder(opts: CreateOrderInput): Promise<CreateOrderResult>;
    queryOrderByPlatformId(outTradeNo: string, platformOrderId: string): Promise<QueryOrderResult | null>;
    queryOrder(outTradeNo: string, platformOrderId?: string | null): Promise<QueryOrderResult | null>;
    verifyNotify(data: Record<string, unknown>): Promise<boolean>;
    parseNotify(data: Record<string, unknown>): Promise<NotifyParseResult>;
}
export declare function createZhifuClient(cfg: ZhifuConfig): ZhifuClient;
//# sourceMappingURL=client.d.ts.map