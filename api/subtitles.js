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

    var allTracks = []

    // 1) Try Miruro-API OpenSubtitles proxy
    try {
      var osUrl = MIRURO_API + '/subtitles/search?languages=' + lang +
        '&season_number=' + (season || 1) + '&episode_number=' + (episode || 1)
      if (tmdbId) osUrl += '&tmdb_id=' + tmdbId
      if (parentImdbId) osUrl += '&parent_imdb_id=' + parentImdbId

      var osResp = await fetch(osUrl, {
        headers: { 'User-Agent': UA, 'Referer': 'https://miruro.tv/', 'Origin': 'https://miruro.tv' },
        signal: AbortSignal.timeout(8000)
      })

      if (osResp.ok) {
        var osData = await osResp.json()
        var list = osData && osData.data ? osData.data : []
        if (list.length) {
          var best = list[0]
          for (var i = 0; i < list.length; i++) {
            var a = list[i].attributes || {}
            if (a.subtitle_format === 'vtt') { best = list[i]; break }
          }
          var attrs = best.attributes || {}
          var files = attrs.files || []
          var fileId = files.length ? (files[0].file_id || 0) : 0
          if (fileId) {
            var dlResp = await fetch(MIRURO_API + '/subtitles/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://miruro.tv/', 'Origin': 'https://miruro.tv' },
              body: JSON.stringify({ file_id: fileId }),
              signal: AbortSignal.timeout(8000)
            })
            if (dlResp.ok) {
              var dlData = await dlResp.json()
              var link = dlData && dlData.link
              if (link) {
                allTracks.push({ file: link, label: 'English (OpenSubtitles)' })
              }
            }
          }
        }
      }
    } catch {}

    // 2) Fallback: extract captions from VidLink provider (TMDB-Embed-API)
    if (!allTracks.length && tmdbId && season && episode) {
      try {
        var encResp = await fetch('https://enc-dec.app/api/enc-vidlink?text=' + tmdbId, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5000)
        })
        if (encResp.ok) {
          var encData = await encResp.json()
          var encrypted = encData && (encData.result || encData.text || '')
          if (encrypted) {
            var vlUrl = 'https://vidlink.pro/api/b/tv/' + encrypted + '/' + season + '/' + episode + '?multiLang=0'
            var vlResp = await fetch(vlUrl, {
              headers: { 'User-Agent': UA, 'Referer': 'https://vidlink.pro/' },
              signal: AbortSignal.timeout(8000)
            })
            if (vlResp.ok) {
              var vlData = await vlResp.json()
              var streamData = vlData && (vlData.stream || (vlData.data && vlData.data.stream))
              if (streamData && streamData.captions && streamData.captions.length) {
                for (var ci = 0; ci < streamData.captions.length; ci++) {
                  var cap = streamData.captions[ci]
                  var capLang = (cap.language || cap.label || '').toLowerCase()
                  var reqLang = (lang || 'en').toLowerCase()
                  if (capLang && capLang.indexOf(reqLang) === -1 && reqLang.indexOf(capLang) === -1) continue
                  if (cap.hasCorsRestrictions) continue
                  allTracks.push({
                    file: cap.url || cap.file,
                    label: cap.language || cap.label || 'English'
                  })
                }
              }
            }
          }
        }
      } catch {}
    }

    // Proxy VTT through our domain to avoid CORS issues
    var baseUrl = req.protocol + '://' + req.get('host')
    for (var ti = 0; ti < allTracks.length; ti++) {
      if (allTracks[ti].file && allTracks[ti].file.indexOf('//') > 0) {
        allTracks[ti].file = baseUrl + '/subtitles/proxy?url=' + encodeURIComponent(allTracks[ti].file)
      }
    }

    res.json({ tracks: allTracks })
  } catch (e) {
    res.json({ tracks: [], error: e.message })
  }
})

// Proxy VTT subtitle files through our backend to avoid CORS
router.get('/proxy', async function(req, res) {
  var url = req.query.url
  if (!url) return res.status(400).end()
  try {
    var resp = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000)
    })
    if (!resp.ok) return res.status(502).end()
    var vtt = await resp.text()
    res.set({
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400'
    })
    res.send(vtt)
  } catch {
    res.status(502).end()
  }
})

export default router
