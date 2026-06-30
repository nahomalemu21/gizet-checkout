export const dynamic = 'force-dynamic'

import { getShopifyToken } from '../../../lib/shopifyToken'

const GIZET_DB_ID = '32b16f746a51809eb396fc634b0e528b'

async function createNotionRow({ orderNumber, fullName, phone, totalPrice, utmNote, callBy, token }) {
  const properties = {
    Name:            { title: [{ text: { content: orderNumber } }] },
    'Full Name ':    { rich_text: [{ text: { content: fullName || '' } }] },
    'Phone Number ': { phone_number: phone || null },
    'Total Price ':  { number: totalPrice ? Number(totalPrice) : null },
    'Shopify Order': { rich_text: [{ text: { content: orderNumber } }] },
    Status:          { status: { name: 'Not Contacted' } },
    'Call By':       { date: { start: callBy } },
  }
  if (utmNote) properties['Note '] = { rich_text: [{ text: { content: utmNote } }] }

  const notionRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: GIZET_DB_ID }, properties }),
  })

  if (!notionRes.ok) {
    const err = await notionRes.text()
    console.error('Notion row creation failed:', err)
  }
}

export async function POST(request) {
  const SHOPIFY_STORE = process.env.GIZET_SHOPIFY_STORE
  const NOTION_TOKEN  = process.env.NOTION_TOKEN

  let SHOPIFY_TOKEN
  try {
    SHOPIFY_TOKEN = await getShopifyToken()
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }

  const body = await request.json()
  const {
    lineItems,
    customer,
    shippingAddress,
    noteExtra,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
  } = body

  // Build note_attributes with UTMs
  const noteAttributes = []
  if (utm_source)   noteAttributes.push({ name: 'utm_source',   value: utm_source })
  if (utm_medium)   noteAttributes.push({ name: 'utm_medium',   value: utm_medium })
  if (utm_campaign) noteAttributes.push({ name: 'utm_campaign', value: utm_campaign })
  if (utm_content)  noteAttributes.push({ name: 'utm_content',  value: utm_content })
  if (utm_term)     noteAttributes.push({ name: 'utm_term',     value: utm_term })

  // Build UTM tag string for easy filtering in Shopify
  const utmTag = utm_source ? `utm:${utm_source}` : ''
  const campaignTag = utm_campaign ? `campaign:${utm_campaign}` : ''
  const tags = [utmTag, campaignTag].filter(Boolean).join(', ')

  const draftOrder = {
    line_items: lineItems || [],
    note_attributes: noteAttributes,
    tags,
    note: noteAttributes.map(a => `${a.name}: ${a.value}`).join(' | '),
  }

  if (customer) {
    draftOrder.customer = {
      first_name: customer.first_name || '',
      last_name:  customer.last_name  || '',
      phone:      customer.phone      || '',
      email:      customer.email      || '',
    }
    // Billing address ensures name shows in Shopify draft order list
    draftOrder.billing_address = {
      first_name: customer.first_name || '',
      last_name:  customer.last_name  || '',
      phone:      customer.phone      || '',
      city:       shippingAddress?.city || 'Addis Ababa',
      country:    'Ethiopia',
      country_code: 'ET',
    }
    draftOrder.shipping_address = {
      first_name: customer.first_name || '',
      last_name:  customer.last_name  || '',
      phone:      customer.phone      || '',
      city:       shippingAddress?.city || 'Addis Ababa',
      country:    'Ethiopia',
      country_code: 'ET',
    }
  }

  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/draft_orders.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ draft_order: draftOrder }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: err }, { status: res.status })
  }

  const data = await res.json()
  const order = data.draft_order

  // Create Notion row immediately (Call By = now + 40 min)
  if (NOTION_TOKEN) {
    const utmNote = [
      utm_source   && `utm_source: ${utm_source}`,
      utm_medium   && `utm_medium: ${utm_medium}`,
      utm_campaign && `utm_campaign: ${utm_campaign}`,
      noteExtra,
    ].filter(Boolean).join(' | ')

    const fullName = customer
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : ''

    await createNotionRow({
      orderNumber:  order.name,
      fullName,
      phone:        customer?.phone || '',
      totalPrice:   order.total_price,
      utmNote:      utmNote || undefined,
      callBy:       new Date(Date.now() + 40 * 60 * 1000).toISOString(),
      token:        NOTION_TOKEN,
    })
  }

  // Return what pay-confirm.html needs as URL params
  return Response.json({
    success: true,
    orderId: order.id,
    orderNumber: order.name,          // e.g. #D1
    totalPrice: order.total_price,
    phone: customer?.phone || '',
    // Ready-built redirect URL for pay-confirm.html
    confirmUrl: `/pay-confirm.html`
      + `?order=${encodeURIComponent(order.name)}`
      + `&amount=${encodeURIComponent(order.total_price)}`
      + `&phone=${encodeURIComponent(customer?.phone || '')}`
      + (utm_source   ? `&utm_source=${encodeURIComponent(utm_source)}`     : '')
      + (utm_medium   ? `&utm_medium=${encodeURIComponent(utm_medium)}`     : '')
      + (utm_campaign ? `&utm_campaign=${encodeURIComponent(utm_campaign)}` : ''),
  })
}
