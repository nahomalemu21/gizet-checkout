export const dynamic = 'force-dynamic'

const GIZET_DB_ID = '32b16f746a51809eb396fc634b0e528b'

async function uploadToCloudinary(file) {
  const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
  const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET
  if (!CLOUD_NAME || !UPLOAD_PRESET) return null

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const dataUri = `data:${file.type};base64,${base64}`

  const fd = new FormData()
  fd.append('file', dataUri)
  fd.append('upload_preset', UPLOAD_PRESET)
  fd.append('folder', 'gizet-receipts')

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: fd,
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.secure_url
}

async function findNotionRowByOrder(orderNumber, token) {
  const res = await fetch(`https://api.notion.com/v1/databases/${GIZET_DB_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        property: 'Name',
        title: { equals: orderNumber },
      },
      page_size: 1,
    }),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.results?.[0] || null
}

async function updateNotionRow(pageId, { receiptUrl, phone, token }) {
  const properties = {
    Status: { status: { name: 'Follow up' } },
    'Call By': { date: null },
  }
  if (receiptUrl) properties['Receipt URL'] = { url: receiptUrl }
  if (phone) properties['Phone Number '] = { phone_number: phone }

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })

  return res.ok
}

async function createNotionRow({ orderNumber, phone, totalPrice, receiptUrl, token }) {
  const properties = {
    Name: { title: [{ text: { content: orderNumber } }] },
    'Phone Number ': { phone_number: phone || null },
    Status: { status: { name: 'Follow up' } },
    'Shopify Order': { rich_text: [{ text: { content: orderNumber } }] },
    'Call By': { date: null },
  }
  if (totalPrice) properties['Total Price '] = { number: Number(totalPrice) }
  if (receiptUrl) properties['Receipt URL'] = { url: receiptUrl }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: GIZET_DB_ID }, properties }),
  })

  if (!res.ok) return null
  return res.json()
}

export async function POST(request) {
  const NOTION_TOKEN = process.env.NOTION_TOKEN
  if (!NOTION_TOKEN) {
    return Response.json({ error: 'NOTION_TOKEN not set' }, { status: 500 })
  }

  try {
    const formData = await request.formData()
    const orderNumber  = formData.get('orderNumber')?.toString().trim()
    const phone        = formData.get('phone')?.toString().trim()
    const totalPrice   = formData.get('totalPrice')?.toString().trim()
    const file         = formData.get('receipt')
    const utmSource   = formData.get('utm_source')   || ''
    const utmMedium   = formData.get('utm_medium')   || ''
    const utmCampaign = formData.get('utm_campaign') || ''
    const utmContent  = formData.get('utm_content')  || ''
    const utmTerm     = formData.get('utm_term')     || ''
    const utmNote = [
      utmSource   && `utm_source: ${utmSource}`,
      utmMedium   && `utm_medium: ${utmMedium}`,
      utmCampaign && `utm_campaign: ${utmCampaign}`,
      utmContent  && `utm_content: ${utmContent}`,
      utmTerm     && `utm_term: ${utmTerm}`,
    ].filter(Boolean).join(' | ')

    if (!orderNumber) {
      return Response.json({ error: 'orderNumber is required' }, { status: 400 })
    }
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'receipt file is required' }, { status: 400 })
    }

    // Upload receipt (returns null if Cloudinary not configured yet)
    const receiptUrl = await uploadToCloudinary(file)

    // Try to find the existing Notion row Make created
    const existingRow = await findNotionRowByOrder(orderNumber, NOTION_TOKEN)

    let notionPageId
    if (existingRow) {
      await updateNotionRow(existingRow.id, { receiptUrl, phone, note: utmNote || undefined, token: NOTION_TOKEN })
      notionPageId = existingRow.id
    } else {
      const page = await createNotionRow({ orderNumber, phone, totalPrice, receiptUrl, note: utmNote || undefined, token: NOTION_TOKEN })
      notionPageId = page?.id
    }

    return Response.json({ success: true, notionPageId, receiptUrl })
  } catch (err) {
    console.error('payment-confirm error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
