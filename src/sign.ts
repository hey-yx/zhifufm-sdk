import crypto from 'node:crypto'

const SIGN_EXCLUDE_KEYS = new Set([
  'sign',
  'sign_type',
  'signType',
  '_input_charset',
  'sign_v2',
  'sign_type_v2',
  'signV2',
  'signTypeV2',
])

export function normalizePem(raw: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const clean = raw.replace(/\\n/g, '\n').trim()
  if (!clean) return ''
  if (clean.includes('-----BEGIN ')) return clean
  const body = clean.replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

export function buildSignString(params: Record<string, unknown>): string {
  return Object.keys(params)
    .filter((k) => {
      if (SIGN_EXCLUDE_KEYS.has(k)) return false
      const v = params[k]
      return v !== undefined && v !== null && String(v) !== ''
    })
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&')
}

export function rsa2Sign(params: Record<string, unknown>, privateKeyRaw: string): string {
  const pem = normalizePem(privateKeyRaw, 'PRIVATE KEY')
  const signStr = buildSignString(params)
  return crypto.createSign('RSA-SHA256').update(signStr, 'utf8').sign(pem, 'base64')
}

export function rsa2Verify(
  params: Record<string, unknown>,
  signatureBase64: string,
  publicKeyRaw: string,
): boolean {
  const pem = normalizePem(publicKeyRaw, 'PUBLIC KEY')
  if (!pem || !signatureBase64) return false
  const signStr = buildSignString(params)
  try {
    return crypto.createVerify('RSA-SHA256').update(signStr, 'utf8').verify(pem, signatureBase64, 'base64')
  } catch {
    return false
  }
}
