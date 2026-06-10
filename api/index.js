import express from 'express'
import { ANIME } from '@consumet/extensions'

const app = express()

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

app.get('/search', async (req, res) => {
  try {
    const q = req.query.q
    if (!q) return res.status(400).json({ error: 'missing q' })
    const gogo = new ANIME.Gogoanime('https://gogoanime3.net')
    const data = await gogo.search(q)
    res.json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/info', async (req, res) => {
  try {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'missing id' })
    const gogo = new ANIME.Gogoanime('https://gogoanime3.net')
    const data = await gogo.fetchAnimeInfo(id)
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
    if (!id) return res.status(400).json({ error: 'missing id' })
    const gogo = new ANIME.Gogoanime('https://gogoanime3.net')
    const data = await gogo.fetchEpisodeSources(id)
    const sources = (data.sources || []).map(s => ({
      url: s.url,
      quality: s.quality || 'default',
      isM3U8: s.url?.includes('.m3u8')
    }))
    res.json({ sources, tracks: data.subtitles || [], referer: 'https://gogoanime3.net' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default app
