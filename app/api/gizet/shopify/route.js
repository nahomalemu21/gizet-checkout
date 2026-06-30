export const dynamic = 'force-dynamic'

export async function GET() {
  const SHOPIFY_TOKEN = process.env.GIZET_SHOPIFY_TOKEN
  const SHOPIFY_STORE = process.env.GIZET_SHOPIFY_STORE

  if (!SHOPIFY_TOKEN || !SHOPIFY_STORE) {
    return Response.json({ error: 'GIZET_SHOPIFY_TOKEN or GIZET_SHOPIFY_STORE not set' }, { status: 500 })
  }

  const since = new Date()
  since.setDate(since.getDate() - 60)
  const sinceStr = since.toISOString()

  let allOrders = []
  let nextUrl = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${sinceStr}&fields=id,name,created_at,customer,total_price,financial_status,fulfillment_status,note,tags`

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const err = await res.text()
      return Response.json({ error: err }, { status: res.status })
    }

    const data = await res.json()
    allOrders = allOrders.concat(data.orders || [])

    const linkHeader = res.headers.get('Link') || ''
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
    nextUrl = nextMatch ? nextMatch[1] : null
  }

  const orders = allOrders.map((o) => ({
    id: o.id,
    name: o.name,
    customerName: o.customer
      ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim()
      : '',
    phone: o.customer?.phone || '',
    total_price: parseFloat(o.total_price || 0),
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status,
    note: o.note || '',
    tags: o.tags || '',
    created_at: o.created_at,
    // pending = awaiting receipt, paid = verified
    awaitingReceipt: o.financial_status === 'pending',
  }))

  return Response.json({ orders })
}
