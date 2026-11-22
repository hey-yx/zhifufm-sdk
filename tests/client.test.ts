import crypto from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildSignString,
  createZhifuClient,
  normalizePem,
  rsa2Sign,
  rsa2Verify,
} from '../src/index.js'

function genKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('sign utilities', () => {
  test('normalizePem wraps bare base64 and unescapes \\n', () => {
    const { publicKey } = genKeyPair()
    const body = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s+/g, '')

    expect(normalizePem(body, 'PUBLIC KEY')).toBe(publicKey.trim())
    expect(normalizePem(publicKey.replace(/\n/g, '\\n'), 'PUBLIC KEY')).toBe(publicKey.trim())
    expect(normalizePem('', 'PUBLIC KEY')).toBe('')
  })

  test('buildSignString sorts keys and excludes sign fields and empty values', () => {
    const str = buildSignString({
      b: '2',
      a: '1',
      empty: '',
      nil: null,
      undef: undefined,
      sign: 'ignored',
      sign_v2: 'ignored',
      signType: 'RSA2',
    })
    expect(str).toBe('a=1&b=2')
  })

  test('rsa2Sign and rsa2Verify round-trip and reject tampering', () => {
    const { publicKey, privateKey } = genKeyPair()
    const params = { orderNo: 'ORD123', amount: '3.99', merchant_id: 'M001' }
    const sig = rsa2Sign(params, privateKey)

    expect(rsa2Verify(params, sig, publicKey)).toBe(true)
    expect(rsa2Verify({ ...params, amount: '0.01' }, sig, publicKey)).toBe(false)
  })
})

describe('createZhifuClient', () => {
  test('configured() checks required fields and rejects encrypted placeholders', () => {
    const { privateKey } = genKeyPair()
    const ok = createZhifuClient({
      baseUrl: 'https://api-demo.zhifu.fm.it88168.com/api',
      mchNum: 'MCH001',
      privateKey,
      notifyUrl: 'https://example.com/notify',
    })
    expect(ok.configured()).toBe(true)

    const encrypted = createZhifuClient({
      baseUrl: 'https://api-demo.zhifu.fm.it88168.com/api',
      mchNum: 'encrypted:abc',
      privateKey,
      notifyUrl: 'https://example.com/notify',
    })
    expect(encrypted.configured()).toBe(false)
  })

  test('createOrder signs request and returns payUrl & platformOrderId', async () => {
    const { privateKey } = genKeyPair()
    let capturedUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(
        JSON.stringify({
          success: true,
          data: { id: 'PF999', payUrl: 'https://page-demo.zhifu.fm.it88168.com/pay/PF999' },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = createZhifuClient({
      baseUrl: 'https://api-demo.zhifu.fm.it88168.com',
      mchNum: 'MCH001',
      privateKey,
      notifyUrl: 'https://example.com/notify',
    })

    const res = await client.createOrder({
      channel: 'wxpay',
      outTradeNo: 'ORD001',
      cents: 399,
      body: '测试商品',
    })

    expect(res).toEqual({
      payUrl: 'https://page-demo.zhifu.fm.it88168.com/pay/PF999',
      platformOrderId: 'PF999',
    })
    expect(capturedUrl).toContain('/api/v2/startOrder?')
    expect(capturedUrl).toContain('amount=3.99')
    expect(capturedUrl).toContain('payType=tloop')
  })

  test('verifyNotify & parseNotify verify sign_v2 and restore spaces to +', async () => {
    const merchant = genKeyPair()
    const platform = genKeyPair()

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: true,
          data: { publicKeyPem: platform.publicKey },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = createZhifuClient({
      baseUrl: 'https://api-demo.zhifu.fm.it88168.com/api',
      mchNum: 'MCH001',
      privateKey: merchant.privateKey,
      notifyUrl: 'https://example.com/notify',
    })

    const payload: Record<string, unknown> = {
      merchantNum: 'MCH001',
      orderNo: 'ORD002',
      platformOrderNo: 'PF002',
      amount: '9.90',
      state: '1',
      timestamp: '1700000000',
    }
    const signV2 = rsa2Sign(payload, platform.privateKey)
    // Simulate URLSearchParams decoding '+' as ' '
    payload.sign_v2 = signV2.replace(/\+/g, ' ')

    const parsed = await client.parseNotify(payload)
    expect(parsed.verified).toBe(true)
    expect(parsed.paid).toBe(true)
    expect(parsed.outTradeNo).toBe('ORD002')
    expect(parsed.platformOrderNo).toBe('PF002')
    expect(parsed.amountCents).toBe(990)
  })

  test('queryOrder falls back to page getOrderGatheringCode on code 6003', async () => {
    const { privateKey } = genKeyPair()
    const calls: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/v2/queryOutOrder')) {
        return new Response(JSON.stringify({ success: false, code: 6003 }), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'PF777',
            orderNo: 'PAY777',
            mchOrderNo: 'ORD777',
            orderState: '4',
            gatheringAmount: '3.99',
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const client = createZhifuClient({
      baseUrl: 'https://api-demo.zhifu.fm.it88168.com/api',
      mchNum: 'MCH001',
      privateKey,
      notifyUrl: 'https://example.com/notify',
    })

    const res = await client.queryOrder('ORD777', 'PF777')
    expect(res).toEqual({ paid: true, payNo: 'PAY777', totalFee: '3.99' })
    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('https://page-demo.zhifu.fm.it88168.com/api/getOrderGatheringCode')
  })
})
