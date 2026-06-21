import express from 'express'
var router = express.Router()

const TMDB_PROXY = 'https://miruro-api-navy.vercel.app/tmdb'
const MIRURO_API = 'https://miruro-api-navy.vercel.app'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

async function tmdbFetch(path) {
  var resp = await fetch(TMDB_PROXY + '/' + path, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(5000)
  })
  if (!resp.ok) throw new Error('TMDB error: ' + resp.status)
  return resp.json()
}

// Fetch and return subtitle VTT URLs
router.get('/', async function(req, res) {
  try {
    var { tmdbId, season, episode, imdbId, languages } = req.query
    if (!tmdbId && !imdbId) return res.json({ tracks: [] })

    var lang = languages || 'en'
    var parentImdbId = imdbId || ''

    // Get IMDB ID from TMDB if not provided
    if (!parentImdbId && tmdbId) {
      try {
        var extData = await tmdbFetch('tv/' + tmdbId + '/external_ids')
        parentImdbId = (extData && extData.imdb_id) || ''
        if (parentImdbId) parentImdbId = parentImdbId.replace(/^tt/i, '')
      } catch {}
    }

    // Try Miruro-API OpenSubtitles proxy
    var osUrl = MIRURO_API + '/subtitles/search?languages=' + lang +
      '&season_number=' + (season || 1) + '&episode_number=' + (episode || 1)
    if (tmdbId) osUrl += '&tmdb_id=' + tmdbId
    if (parentImdbId) osUrl += '&parent_imdb_id=' + parentImdbId

    var osResp
    try {
      osResp = await fetch(osUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000)
      })
    } catch {
      return res.json({ tracks: [] })
    }

    if (!osResp.ok) return res.json({ tracks: [] })

    var osData = await osResp.json()
    var list = osData && osData.data ? osData.data : []
    if (!list.length) return res.json({ tracks: [] })

    // Pick best subtitle (prefer VTT format)
    var best = list[0]
    for (var i = 0; i < list.length; i++) {
      var a = list[i].attributes || {}
      if (a.subtitle_format === 'vtt') { best = list[i]; break }
    }

    var attrs = best.attributes || {}
    var files = attrs.files || []
    var fileId = files.length ? (files[0].file_id || 0) : 0
    if (!fileId) return res.json({ tracks: [] })

    // Download the subtitle
    var dlResp
    try {
      dlResp = await fetch(MIRURO_API + '/subtitles/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(8000)
      })
    } catch {
      return res.json({ tracks: [] })
    }

    if (!dlResp.ok) return res.json({ tracks: [] })

    var dlData = await dlResp.json()
    var link = dlData && dlData.link
    if (!link) return res.json({ tracks: [] })

    var label = attrs.language || attrs.language_english || lang
    res.json({ tracks: [{ file: link, label: 'English (OpenSubtitles)' }] })
  } catch (e) {
    res.json({ tracks: [], error: e.message })
  }
})

export default router
