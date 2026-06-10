import express from 'express'
import { ANIME } from '@consumet/extensions'

const app = express()
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

const PROVIDERS = ['AnimePahe', 'AnimeKai', 'KickAssAnime', 'AnimeSaturn']

app.get('/search', async (req, res) => {
  try {
    const q = req.query.q
    if (!q) return res.status(400).json({ error: 'missing q' })
    for (const name of PROVIDERS) {
      try {
        const p = new ANIME[name]()
        const data = await p.search(q)
        if (data && data.results && data.results.length > 0) {
          return res.json({ ...data, _provider: name })
        }
      } catch (e) {}
    }
    res.json({ results: [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/info', async (req, res) => {
  try {
    const id = req.query.id
    const prov = req.query.provider || 'AnimeSaturn'
    if (!id) return res.status(400).json({ error: 'missing id' })
    if (!ANIME[prov]) return res.status(400).json({ error: 'invalid provider' })
    const p = new ANIME[prov]()
    const data = await p.fetchAnimeInfo(id)
    if (!data) return res.json({ id, episodes: [] })
    const eps = (data.episodes || []).map((ep, i) => ({
      id: ep.id,
      number: ep.number || i + 1,
      title: ep.title || ''
    }))
    res.json({ id, title: data.title || '', image: data.image || '', episodes: eps })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/watch', async (req, res) => {
  try {
    const id = req.query.id
    const prov = req.query.provider || 'AnimeSaturn'
    if (!id) return res.status(400).json({ error: 'missing id' })
    if (!ANIME[prov]) return res.status(400).json({ error: 'invalid provider' })
    const p = new ANIME[prov]()
    const data = await p.fetchEpisodeSources(id)
    const sources = (data.sources || []).map(s => ({
      url: s.url,
      quality: s.quality || 'default',
      isM3U8: s.url?.includes('.m3u8')
    }))
    res.json({ sources, tracks: data.subtitles || [], referer: data.referer || '' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default app
