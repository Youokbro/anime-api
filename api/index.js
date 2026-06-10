import express from 'express'
import { ANIME } from '@consumet/extensions'

const app = express()
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  next()
})

app.get('/search', async (req, res) => {
  try {
    const { q, provider = 'hianime' } = req.query
    const name = provider.charAt(0).toUpperCase() + provider.slice(1)
    const Provider = new ANIME[name]()
    const data = await Provider.search(q)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/info', async (req, res) => {
  try {
    const { id, provider = 'hianime' } = req.query
    const name = provider.charAt(0).toUpperCase() + provider.slice(1)
    const Provider = new ANIME[name]()
    const data = await Provider.fetchAnimeInfo(id)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

app.get('/watch', async (req, res) => {
  try {
    const { id, provider = 'hianime' } = req.query
    const name = provider.charAt(0).toUpperCase() + provider.slice(1)
    const Provider = new ANIME[name]()
    const data = await Provider.fetchEpisodeSources(id)
    res.json(data)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('Running on ' + PORT))
