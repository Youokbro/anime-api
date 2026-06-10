import express from 'express'

const BASE = 'https://hianime.to'
const app = express()

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

async function fetchJSON(url, ref = BASE) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': ref }
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return r.json()
}

app.get('/search', async (req, res) => {
  try {
    const q = req.query.q
    if (!q) return res.status(400).json({ error: 'missing q' })

    const html = await fetch(`${BASE}/search?keyword=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => r.text())

    const results = []
    const regex = /<a\s+class="[^"]*dynamic-name[^"]*"\s+href="\/category\/([^"]+)">[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?class="film-name"[^>]*>([\s\S]*?)<\/a>/g
    let m
    while ((m = regex.exec(html)) !== null) {
      results.push({ id: m[1], title: m[3].trim(), image: m[2] })
    }
    res.json({ results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/info', async (req, res) => {
  try {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'missing id' })

    const animeId = id.split('-').pop()
    const ajax = await fetchJSON(`${BASE}/ajax/v2/episode/list/${animeId}`)
    const html = ajax.html || ''

    const episodes = []
    const epRegex = /<a\s+href="[^"]*\/watch\/([^"]+)"[^>]*>[\s\S]*?eps-num[^"]*">\s*(\d+(?:\.\d+)?)\s*<\/div>/g
    let m
    while ((m = epRegex.exec(html)) !== null) {
      episodes.push({ id: m[1], number: parseFloat(m[2]) })
    }

    res.json({
      id,
      title: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      episodes: episodes.sort((a, b) => a.number - b.number)
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/watch', async (req, res) => {
  try {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'missing id' })

    const data = await fetchJSON(`${BASE}/ajax/v1/episode/sources?id=${id}`)
    res.json({
      sources: (data.sources || []).map(s => ({
        url: s.url,
        quality: s.quality || 'default',
        isM3U8: s.url?.includes('.m3u8')
      })),
      tracks: data.tracks || [],
      referer: data.referer || BASE
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default app
