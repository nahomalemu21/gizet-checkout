export const dynamic = 'force-dynamic'

const GIZET_DB_ID = '32b16f746a51809eb396fc634b0e528b'

export async function GET() {
  const NOTION_TOKEN = process.env.NOTION_TOKEN
  if (!NOTION_TOKEN) {
    return Response.json({ error: 'NOTION_TOKEN not set' }, { status: 500 })
  }

  let allResults = []
  let hasMore = true
  let cursor = undefined

  while (hasMore) {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor

    const res = await fetch(`https://api.notion.com/v1/databases/${GIZET_DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      return Response.json({ error: err }, { status: res.status })
    }

    const data = await res.json()
    allResults = allResults.concat(data.results)
    hasMore = data.has_more
    cursor = data.next_cursor
  }

  const orders = allResults.map((page) => {
    const p = page.properties
    const salesPersons = p['Sales Person ']?.people || []

    return {
      id: page.id,
      name: p['Name']?.title?.[0]?.plain_text || '',
      fullName: p['Full Name ']?.rich_text?.[0]?.plain_text || '',
      phone: p['Phone Number ']?.phone_number || '',
      status: p['Status']?.status?.name || 'Not Contacted',
      totalPrice: p['Total Price ']?.number || 0,
      note: p['Note ']?.rich_text?.[0]?.plain_text || '',
      receiptUrl: p['Receipt URL']?.url || '',
      shopifyOrder: p['Shopify Order']?.rich_text?.[0]?.plain_text || '',
      callBy: p['Call By']?.date?.start || null,
      vendor: p['Vendors']?.select?.name || '',
      salesPersons: salesPersons.map((s) => s.name),
      created_at: page.created_time,
      last_edited: page.last_edited_time,
    }
  })

  return Response.json({ orders })
}

// Create a new order row in Gizet Drafts
export async function POST(request) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN
  if (!NOTION_TOKEN) {
    return Response.json({ error: 'NOTION_TOKEN not set' }, { status: 500 })
  }

  const body = await request.json()
  const { orderNumber, fullName, phone, totalPrice, receiptUrl, note, callBy } = body

  const properties = {
    Name: { title: [{ text: { content: orderNumber || '' } }] },
    'Full Name ': { rich_text: [{ text: { content: fullName || '' } }] },
    'Phone Number ': { phone_number: phone || null },
    'Total Price ': { number: totalPrice ? Number(totalPrice) : null },
    Status: { status: { name: receiptUrl ? 'Follow up' : 'Not Contacted' } },
    'Shopify Order': { rich_text: [{ text: { content: orderNumber || '' } }] },
  }

  if (receiptUrl) properties['Receipt URL'] = { url: receiptUrl }
  if (note) properties['Note '] = { rich_text: [{ text: { content: note } }] }
  if (callBy) properties['Call By'] = { date: { start: callBy } }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: GIZET_DB_ID },
      properties,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: err }, { status: res.status })
  }

  const page = await res.json()
  return Response.json({ id: page.id, success: true })
}

// Update an existing row (e.g. set receipt URL, update status)
export async function PATCH(request) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN
  if (!NOTION_TOKEN) {
    return Response.json({ error: 'NOTION_TOKEN not set' }, { status: 500 })
  }

  const { pageId, receiptUrl, status, callBy, note } = await request.json()
  if (!pageId) return Response.json({ error: 'pageId required' }, { status: 400 })

  const properties = {}
  if (status) properties['Status'] = { status: { name: status } }
  if (receiptUrl) properties['Receipt URL'] = { url: receiptUrl }
  if (note) properties['Note '] = { rich_text: [{ text: { content: note } }] }
  // Pass null to clear the Call By reminder (receipt received, no need to call)
  if (callBy !== undefined) properties['Call By'] = callBy ? { date: { start: callBy } } : { date: null }

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: err }, { status: res.status })
  }

  return Response.json({ success: true })
}
