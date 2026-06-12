import express from 'express'
import { ANIME } from '@consumet/extensions'

const app = express()
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

const PROVIDERS = ['Hianime', 'AnimePahe', 'AnimeKai', 'KickAssAnime', 'AnimeSaturn', 'AnimeUnity', 'AnimeSama']
const WORKER_FETCH = 'https://anim-proxy.ahaantadi.workers.dev/fetch'
const REF_MAP = {
  AnimeSaturn: 'https://www.animesaturn.cx',
  AnimePahe: 'https://animepahe.ru',
  AnimeKai: 'https://animekai.to',
  KickAssAnime: 'https://kickassanime.am',
  AnimeUnity: 'https://www.animeunity.to',
  Hianime: 'https://hianime.to',
  AnimeSama: 'https://animesama.la'
}

function createProxyAdapter() {
  return async function adapter(config) {
    var headers = {}
    if (config.headers) {
      for (var k in config.headers) { headers[k] = config.headers[k] }
    }
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    var bodyData = { url: config.url, method: (config.method || 'get').toLowerCase(), headers: headers, responseType: 'text' }
    if (config.data) bodyData.body = config.data
    var resp
    try {
      resp = await fetch(WORKER_FETCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      })
    } catch (e) {
      throw new Error('Proxy error: ' + e.message)
    }
    var text = await resp.text()
    var data
    try { data = JSON.parse(text) } catch { data = text }
    return { data: data, status: resp.status, statusText: resp.statusText, headers: {}, config: config, request: null }
  }
}

function withProxy(providerName) {
  var p = new ANIME[providerName]()
  if (p.client && p.client.defaults) {
    p.client.defaults.adapter = createProxyAdapter()
    p.client.defaults.timeout = 15000
  }
  return p
}

function tryProvider(name, fn) {
  return new Promise(function(resolve) {
    var p
    try {
      p = withProxy(name)
    } catch (e) {
      resolve(null)
      return
    }
    fn(p, function(result) { resolve(result) })
  })
}

async function tryAllProviders(fn) {
  var results = []
  for (var i = 0; i < PROVIDERS.length; i++) {
    var name = PROVIDERS[i]
    if (name === 'AnimeSama') continue // got-scraping incompatible
    var result = await tryProvider(name, fn)
    if (result !== null) results.push(result)
  }
  return results
}

app.get('/search', async (req, res) => {
  try {
    var q = req.query.q
    if (!q) return res.status(400).json({ error: 'missing q' })
    var force = req.query._force
    var list = force ? [force] : PROVIDERS.filter(function(n) { return n !== 'AnimeSama' })
    for (var i = 0; i < list.length; i++) {
      try {
        var p = withProxy(list[i])
        var data = await p.search(q)
        if (data && data.results && data.results.length > 0) {
          return res.json({ ...data, _provider: list[i] })
        }
      } catch (e) {
        if (force) return res.json({ results: [], _error: e.message, _provider: force })
      }
    }
    res.json({ results: [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/info', async (req, res) => {
  try {
    var id = req.query.id
    var prov = req.query.provider || 'AnimeSaturn'
    if (!id) return res.status(400).json({ error: 'missing id' })
    if (!ANIME[prov]) return res.status(400).json({ error: 'invalid provider' })
    var p = withProxy(prov)
    var data = await p.fetchAnimeInfo(id)
    if (!data) return res.json({ id: id, episodes: [] })
    var eps = (data.episodes || []).map(function(ep, i) {
      return { id: ep.id, number: ep.number || i + 1, title: ep.title || '' }
    })
    res.json({ id: id, title: data.title || '', image: data.image || '', episodes: eps })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/watch', async (req, res) => {
  try {
    var id = req.query.id
    var prov = req.query.provider || 'AnimeSaturn'
    var all = req.query._all === '1'
    if (!id) return res.status(400).json({ error: 'missing id' })

    if (!all && ANIME[prov]) {
      var p = withProxy(prov)
      var data = await p.fetchEpisodeSources(id)
      var sources = (data.sources || []).map(function(s) {
        return { url: s.url, quality: s.quality || 'default', isM3U8: s.url && s.url.includes('.m3u8') }
      })
      return res.json({ sources: sources, tracks: data.subtitles || [], referer: data.headers?.Referer || REF_MAP[prov] || '' })
    }

    // _all=1: try all providers and aggregate
    var allSources = []
    var allTracks = []
    var tried = []
    for (var i = 0; i < PROVIDERS.length; i++) {
      var name = PROVIDERS[i]
      if (name === 'AnimeSama') continue
      tried.push(name)
      try {
        var p = withProxy(name)
        var data = await p.fetchEpisodeSources(id)
        if (data && data.sources && data.sources.length > 0) {
          for (var j = 0; j < data.sources.length; j++) {
            var s = data.sources[j]
            allSources.push({
              url: s.url,
              quality: s.quality || 'default',
              isM3U8: s.url && s.url.includes('.m3u8'),
              _provider: name
            })
          }
          if (data.subtitles) allTracks = allTracks.concat(data.subtitles)
        }
      } catch (e) {
        // provider failed, skip
      }
    }
    res.json({ sources: allSources, tracks: allTracks, _tried: tried })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default app
