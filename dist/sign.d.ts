export declare function normalizePem(raw: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string;
export declare function buildSignString(params: Record<string, unknown>): string;
export declare function rsa2Sign(params: Record<string, unknown>, privateKeyRaw: string): string;
export declare function rsa2Verify(params: Record<string, unknown>, signatureBase64: string, publicKeyRaw: string): boolean;
//# sourceMappingURL=sign.d.ts.map