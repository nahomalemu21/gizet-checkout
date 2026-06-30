// Fetches and caches a Shopify access token using client credentials
let token = null
let tokenExpiresAt = 0

export async function getShopifyToken() {
  // Return cached token if still valid
  if (token && Date.now() < tokenExpiresAt - 60_000) return token

  const SHOP          = process.env.GIZET_SHOPIFY_STORE
  const CLIENT_ID     = process.env.GIZET_SHOPIFY_CLIENT_ID
  const CLIENT_SECRET = process.env.GIZET_SHOPIFY_CLIENT_SECRET

  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Set GIZET_SHOPIFY_STORE, GIZET_SHOPIFY_CLIENT_ID, and GIZET_SHOPIFY_CLIENT_SECRET')
  }

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })

  if (!res.ok) throw new Error(`Token request failed: ${await res.text()}`)

  const { access_token, expires_in } = await res.json()
  token          = access_token
  tokenExpiresAt = Date.now() + expires_in * 1000
  return token
}
