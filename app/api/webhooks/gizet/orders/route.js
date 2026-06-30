export const dynamic = 'force-dynamic'

import crypto from 'crypto'

const GIZET_DB_ID = '32b16f746a51809eb396fc634b0e528b'

function verifyWebhook(rawBody, hmacHeader, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64')
  return hash === hmacHeader
}

async function createNotionRow({ orderNumber, fullName, phone, totalPrice, note, callBy, token }) {
  const properties = {
    Name:             { title: [{ text: { content: orderNumber } }] },
    'Full Name ':     { rich_text: [{ text: { content: fullName || '' } }] },
    'Phone Number ':  { phone_number: phone || null },
    'Total Price ':   { number: totalPrice ? Number(totalPrice) : null },
    'Shopify Order':  { rich_text: [{ text: { content: orderNumber } }] },
    Status:           { status: { name: 'Not Contacted' } },
    'Call By':        { date: { start: callBy } },
  }
  if (note) properties['Note '] = { rich_text: [{ text: { content: note } }] }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: GIZET_DB_ID }, properties }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion create failed: ${err}`)
  }

  return res.json()
}

export async function POST(request) {
  const NOTION_TOKEN  = process.env.NOTION_TOKEN
  const CLIENT_SECRET = process.env.GIZET_SHOPIFY_CLIENT_SECRET

  if (!NOTION_TOKEN)  return new Response('NOTION_TOKEN not set', { status: 500 })
  if (!CLIENT_SECRET) return new Response('GIZET_SHOPIFY_CLIENT_SECRET not set', { status: 500 })

  // Verify the webhook came from Shopify
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256')
  const rawBody = await request.text()

  if (!verifyWebhook(rawBody, hmacHeader, CLIENT_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const order = JSON.parse(rawBody)

  // Only process pending (manual payment) orders
  if (order.financial_status !== 'pending') {
    return new Response('Skipped — not a pending order', { status: 200 })
  }

  const orderNumber = order.name                                    // e.g. #1042
  const fullName    = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim()
  const phone       = order.customer?.phone || order.billing_address?.phone || ''
  const totalPrice  = parseFloat(order.total_price || 0)

  // Pull UTMs from note_attributes (set by checkout script)
  const attrs = order.note_attributes || []
  const getAttr = (key) => attrs.find(a => a.name === key)?.value || ''
  const utmNote = [
    getAttr('utm_source')   && `utm_source: ${getAttr('utm_source')}`,
    getAttr('utm_medium')   && `utm_medium: ${getAttr('utm_medium')}`,
    getAttr('utm_campaign') && `utm_campaign: ${getAttr('utm_campaign')}`,
    getAttr('utm_content')  && `utm_content: ${getAttr('utm_content')}`,
  ].filter(Boolean).join(' | ')

  // Call By = 40 minutes from now
  const callBy = new Date(Date.now() + 40 * 60 * 1000).toISOString()

  try {
    await createNotionRow({
      orderNumber,
      fullName,
      phone,
      totalPrice,
      note: utmNote || undefined,
      callBy,
      token: NOTION_TOKEN,
    })

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Gizet webhook error:', err)
    return new Response(err.message, { status: 500 })
  }
}
