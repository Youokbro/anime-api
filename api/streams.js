import express from 'express'
var router = express.Router()

const TMDB_PROXY = 'https://miruro-api-navy.vercel.app/tmdb'
const WORKER_FETCH = 'https://anim-proxy-worker.ahaantadi.workers.dev/fetch'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'

async function tmdbFetch(path) {
  var resp = await fetch(TMDB_PROXY + '/' + path, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(5000)
  })
  if (!resp.ok) throw new Error('TMDB error: ' + resp.status)
  return resp.json()
}

function fetchWithTimeout(url, options, ms) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms || 8000) })
}

async function proxyFetch(url, headers, ms) {
  var bodyData = {
    url: url,
    method: 'get',
    headers: headers || {},
    responseType: 'text'
  }
  var resp = await fetch(WORKER_FETCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyData),
    signal: AbortSignal.timeout(ms || 12000)
  })
  return resp.text()
}

// ===== Miruro-API proxy (CORS-free, server-to-server) =====
const MIRURO_BASE = 'https://miruro-api-navy.vercel.app'

router.get('/miruro', async function(req, res) {
  try {
    var path = req.query.path
    if (!path) return res.status(400).json({ error: 'missing path' })
    var resp = await fetch(MIRURO_BASE + '/' + path, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000)
    })
    if (!resp.ok) return res.status(resp.status).json({ error: 'Miruro upstream: ' + resp.status })
    var data = await resp.json()
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ===== VidLink Provider (self-hosted, via enc-dec.app + vidlink.pro) =====
router.get('/vidlink', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    var mediaType = type || 'tv'

    var encResp = await fetchWithTimeout('https://enc-dec.app/api/enc-vidlink?text=' + tmdbId, {
      headers: { 'User-Agent': UA }
    }, 6000)
    var encData = await encResp.json()
    var encrypted = encData.result
    if (!encrypted) return res.json({ sources: [] })

    var url = mediaType === 'movie'
      ? 'https://vidlink.pro/api/b/movie/' + encrypted + '?multiLang=0'
      : 'https://vidlink.pro/api/b/tv/' + encrypted + '/' + season + '/' + episode + '?multiLang=0'

    var streamResp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vidlink.pro' }
    }, 6000)
    var streamData = await streamResp.json()
    var playlist = streamData && streamData.stream && streamData.stream.playlist
    if (!playlist) return res.json({ sources: [] })

    // Extract captions if available
    var tracks = []
    if (streamData.stream && streamData.stream.captions) {
      for (var ci = 0; ci < streamData.stream.captions.length; ci++) {
        var cap = streamData.stream.captions[ci]
        if (cap.url && cap.language) {
          tracks.push({ file: cap.url, label: cap.language })
        }
      }
    }

    res.json({ sources: [{ url: playlist, quality: 'Auto', type: 'hls' }], tracks: tracks })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== VixSrc Provider (self-hosted, scrapes vixsrc.to) =====
router.get('/vixsrc', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    var mediaType = type || 'tv'
    var BASE = 'https://vixsrc.to'

    var apiUrl = mediaType === 'movie'
      ? BASE + '/api/movie/' + tmdbId
      : BASE + '/api/tv/' + tmdbId + '/' + season + '/' + episode

    var apiHeaders = { 'User-Agent': UA, 'Accept': 'application/json, text/javascript, */*; q=0.01' }
    var apiText = await proxyFetch(apiUrl, apiHeaders, 8000)
    var apiData
    try { apiData = JSON.parse(apiText) } catch { return res.json({ sources: [] }) }
    var embedPath = apiData && apiData.src
    if (!embedPath) return res.json({ sources: [] })

    var embedHeaders = { 'User-Agent': UA, 'Referer': BASE + '/', 'Origin': BASE }
    var html = await proxyFetch(BASE + embedPath, embedHeaders, 8000)

    var tokenM = html.match(/var\s+token\s*=\s*['"]([^'"]+)['"]/)
    var expiresM = html.match(/var\s+expires\s*=\s*['"]([^'"]+)['"]/)
    var playlistM = html.match(/var\s+playlist\s*=\s*['"]([^'"]+)['"]/)
    if (!tokenM || !expiresM || !playlistM) return res.json({ sources: [] })

    var masterUrl = playlistM[1] + '?token=' + tokenM[1] + '&expires=' + expiresM[1] + '&h=1'

    var manifestResp = await fetchWithTimeout(masterUrl, {
      headers: { 'User-Agent': UA, 'Referer': BASE + '/', 'Origin': BASE }
    }, 6000)
    var manifest = await manifestResp.text()

    var lines = manifest.split('\n')
    var sources = []
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        var bwM = lines[i].match(/BANDWIDTH=(\d+)/)
        var bw = bwM ? parseInt(bwM[1], 10) : 0
        var resM = lines[i].match(/RESOLUTION=\d+x(\d+)/)
        var quality = resM ? resM[1] + 'p' : (bw > 5000000 ? '1080p' : bw > 2000000 ? '720p' : '480p')
        var nextLine = lines[i + 1]
        if (nextLine && !nextLine.startsWith('#')) {
          var variantUrl = nextLine.startsWith('http') ? nextLine : masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1) + nextLine
          sources.push({ url: variantUrl, quality: quality, type: 'hls' })
        }
      }
    }

    if (!sources.length) {
      sources.push({ url: masterUrl, quality: 'Auto', type: 'hls' })
    }

    res.json({ sources: sources, tracks: [] })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== NoTorrent Provider (Stremio addon) =====
router.get('/notorrent', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    if (!tmdbId) return res.json({ sources: [] })

    var mediaType = type || 'tv'

    var extData
    try {
      extData = await tmdbFetch(mediaType + '/' + tmdbId + '/external_ids')
    } catch (e) {
      return res.json({ sources: [], error: 'TMDB lookup failed' })
    }
    var imdbId = extData && extData.imdb_id
    if (!imdbId) return res.json({ sources: [], error: 'No IMDB ID' })

    var addonUrl = mediaType === 'movie'
      ? 'https://addon-osvh.onrender.com/stream/movie/' + imdbId + '.json'
      : 'https://addon-osvh.onrender.com/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'

    var addonResp
    try {
      addonResp = await fetchWithTimeout(addonUrl, {
        headers: { 'User-Agent': UA }
      }, 10000)
    } catch (e) {
      return res.json({ sources: [], error: 'Addon timeout' })
    }

    if (!addonResp.ok) return res.json({ sources: [], error: 'Addon status ' + addonResp.status })
    var addonData = await addonResp.json()
    var items = addonData && addonData.streams ? addonData.streams : []
    var sources = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var url = item.url || ''
      if (!url) continue
      if (item.externalUrl) continue
      if (url.indexOf('github.com') > -1 || url.indexOf('googleusercontent') > -1) continue

      var quality = 'HD'
      var name = item.name || item.title || ''
      var qm = name.match(/(\d{3,4}p)/i)
      if (qm) quality = qm[1]

      var streamType = url.indexOf('.m3u8') > -1 ? 'hls' : (url.indexOf('.mp4') > -1 ? 'mp4' : 'hls')
      var headers = item.behaviorHints && item.behaviorHints.proxyHeaders && item.behaviorHints.proxyHeaders.request

      sources.push({
        url: url,
        quality: quality,
        type: streamType,
        headers: headers || undefined
      })
    }

    res.json({ sources: sources, tracks: [] })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== DahmerMovies Provider (direct file links) =====
router.get('/dahmermovies', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    if (!tmdbId) return res.json({ sources: [] })

    var mediaType = type || 'tv'

    var showData
    try {
      showData = await tmdbFetch(mediaType + '/' + tmdbId)
    } catch (e) {
      return res.json({ sources: [], error: 'TMDB lookup failed' })
    }

    var title = showData.name || showData.title || ''
    var year = ''
    if (showData.first_air_date) year = showData.first_air_date.substring(0, 4)
    else if (showData.release_date) year = showData.release_date.substring(0, 4)

    if (!title) return res.json({ sources: [], error: 'No title' })

    var cleanTitle = title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s/g, '.')

    var dirUrl = mediaType === 'movie'
      ? 'https://a.111477.xyz/movies/' + cleanTitle + ' (' + year + ')/'
      : 'https://a.111477.xyz/tvs/' + cleanTitle + '/Season%20' + String(season).padStart(2, '0') + '/'

    // Try with padded season first, fall back to unpadded
    var html
    try {
      var dirResp = await fetchWithTimeout(dirUrl, {
        headers: { 'User-Agent': UA, 'Referer': 'https://a.111477.xyz/' }
      }, 6000)
      if (dirResp.ok) {
        html = await dirResp.text()
      } else {
        // Retry with unpadded season
        var dirUrl2 = 'https://a.111477.xyz/tvs/' + cleanTitle + '/Season%20' + season + '/'
        var dirResp2 = await fetchWithTimeout(dirUrl2, {
          headers: { 'User-Agent': UA, 'Referer': 'https://a.111477.xyz/' }
        }, 6000)
        if (!dirResp2.ok) return res.json({ sources: [], error: 'Directory not found' })
        html = await dirResp2.text()
      }
    } catch (e) {
      return res.json({ sources: [], error: 'Directory fetch failed' })
    }

    var epPattern = new RegExp('S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'), 'i')
    var linkRe = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    var match
    var sources = []

    while ((match = linkRe.exec(html)) !== null) {
      var href = match[1]
      var linkText = match[2].replace(/<[^>]*>/g, '').trim()

      if (href.indexOf('..') === 0) continue
      if (!epPattern.test(linkText) && !epPattern.test(href)) continue

      var ext = href.split('.').pop().toLowerCase()
      if (['mkv', 'mp4', 'm3u8', 'avi', 'webm'].indexOf(ext) === -1) continue

      var fullUrl = href.indexOf('http') === 0 ? href : dirUrl.replace(/\/$/, '') + '/' + href.replace(/^\//, '')
      var quality = 'HD'
      var qm2 = linkText.match(/(\d{3,4}[pi])/i)
      if (qm2) quality = qm2[1]
      else if (linkText.match(/4[kK]/i)) quality = '4K'
      else if (linkText.match(/1080/i)) quality = '1080p'
      else if (linkText.match(/720/i)) quality = '720p'

      var proxyUrl = 'https://p.111477.xyz/bulk?u=' + encodeURIComponent(fullUrl)
      sources.push({
        url: proxyUrl,
        quality: quality,
        type: ext === 'm3u8' ? 'hls' : 'mp4'
      })
    }

    // Sort: 4K first, then by resolution descending
    sources.sort(function(a, b) {
      var qa = parseInt(a.quality, 10) || 0
      var qb = parseInt(b.quality, 10) || 0
      return qb - qa
    })

    res.json({ sources: sources.slice(0, 5), tracks: [] })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== MediaFlow Proxy (proxies any stream URL through MediaFlow) =====
var MF_BASE = process.env.MEDIAFLOW_URL || 'https://anime-api-1-yj1f.onrender.com'
var MF_PASS = process.env.MF_PASSWORD || 'ba2ddd746ce702f9126a8a309638e004'

router.get('/mf-proxy', async function(req, res) {
  try {
    var { url, referer, type } = req.query
    if (!url) return res.json({ sources: [], error: 'missing url' })

    var isM3u8 = url.indexOf('.m3u8') > -1 || type === 'hls'
    var proxyUrl

    if (isM3u8) {
      proxyUrl = MF_BASE + '/proxy/hls/manifest.m3u8?d=' + encodeURIComponent(url) + '&api_password=' + MF_PASS
      if (referer) proxyUrl += '&h_Referer=' + encodeURIComponent(referer)
    } else {
      proxyUrl = MF_BASE + '/proxy/stream?d=' + encodeURIComponent(url) + '&api_password=' + MF_PASS
      if (referer) proxyUrl += '&h_Referer=' + encodeURIComponent(referer)
    }

    res.json({
      sources: [{ url: proxyUrl, quality: 'Auto', type: isM3u8 ? 'hls' : 'mp4', _provider: 'MediaFlow' }],
      tracks: []
    })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== MediaFlow + VidLink (reliable VidLink extraction proxied through MediaFlow) =====
router.get('/mf-vixsrc', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    var mediaType = type || 'tv'

    // Step 1: Get VidLink HLS URL (this works reliably)
    var encResp = await fetchWithTimeout('https://enc-dec.app/api/enc-vidlink?text=' + tmdbId, {
      headers: { 'User-Agent': UA }
    }, 6000)
    var encData = await encResp.json()
    var encrypted = encData && encData.result
    if (!encrypted) return res.json({ sources: [] })

    var vidUrl = mediaType === 'movie'
      ? 'https://vidlink.pro/api/b/movie/' + encrypted + '?multiLang=0'
      : 'https://vidlink.pro/api/b/tv/' + encrypted + '/' + season + '/' + episode + '?multiLang=0'

    var streamResp = await fetchWithTimeout(vidUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vidlink.pro' }
    }, 6000)
    var streamData = await streamResp.json()
    var playlist = streamData && streamData.stream && streamData.stream.playlist
    if (!playlist) return res.json({ sources: [] })

    // Extract captions
    var tracks = []
    if (streamData.stream && streamData.stream.captions) {
      for (var ci = 0; ci < streamData.stream.captions.length; ci++) {
        var cap = streamData.stream.captions[ci]
        if (cap.url && cap.language) {
          tracks.push({ file: cap.url, label: cap.language })
        }
      }
    }

    // Step 2: Proxy the HLS through MediaFlow for better playback
    var mfUrl = MF_BASE + '/proxy/hls/manifest.m3u8?d=' + encodeURIComponent(playlist) + '&api_password=' + MF_PASS + '&h_Referer=' + encodeURIComponent('https://vidlink.pro')

    var mfResp = await fetchWithTimeout(mfUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual'
    }, 10000)

    if (mfResp.ok) {
      return res.json({ sources: [{ url: mfUrl, quality: 'Auto', type: 'hls' }], tracks: tracks })
    }

    // Fallback: return the direct VidLink URL with subs
    res.json({ sources: [{ url: playlist, quality: 'Auto', type: 'hls' }], tracks: tracks })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== AnimeSaturn (via Consumet through CF Worker) =====
router.get('/animesaturn', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    if (!tmdbId) return res.json({ sources: [] })
    var mediaType = type || 'tv'

    var showData
    try {
      showData = await tmdbFetch(mediaType + '/' + tmdbId)
    } catch (e) {
      return res.json({ sources: [], error: 'TMDB lookup failed' })
    }

    var searchTerms = [showData.name || showData.title, showData.original_name || showData.original_title].filter(Boolean)
    if (!searchTerms.length) return res.json({ sources: [], error: 'No title' })
    var seen = {}
    searchTerms = searchTerms.filter(function(t) { return seen[t] ? false : (seen[t] = true) })

    var animeId = null
    for (var si = 0; si < searchTerms.length; si++) {
      try {
        var sr = await fetch('https://anime-api-nu-eight.vercel.app/search?q=' + encodeURIComponent(searchTerms[si]) + '&_force=AnimeSaturn', {
          headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000)
        })
        if (!sr.ok) continue
        var sd = await sr.json()
        var results = sd.results || []
        if (results.length) { animeId = results[0].id; break }
      } catch {}
    }
    if (!animeId) return res.json({ sources: [], error: 'Not found on AnimeSaturn' })

    var ir = await fetch('https://anime-api-nu-eight.vercel.app/info?id=' + encodeURIComponent(animeId) + '&provider=AnimeSaturn', {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000)
    })
    if (!ir.ok) return res.json({ sources: [], error: 'Info failed' })
    var infoData = await ir.json()
    var episodes = infoData.episodes || []
    if (!episodes.length) return res.json({ sources: [], error: 'No episodes' })

    var epNum = parseInt(episode, 10) || 1
    var match = null
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].number === epNum) { match = episodes[i]; break }
    }
    if (!match) return res.json({ sources: [], error: 'Episode ' + epNum + ' not found' })

    var wr = await fetch('https://anime-api-nu-eight.vercel.app/watch?id=' + encodeURIComponent(match.id) + '&provider=AnimeSaturn', {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000)
    })
    if (!wr.ok) return res.json({ sources: [], error: 'Watch failed' })
    var watchData = await wr.json()
    var sources = (watchData.sources || []).map(function(s) {
      return { url: s.url, quality: s.quality || 'HD', type: s.isM3U8 ? 'hls' : (s.type || 'hls') }
    })
    var tracks = (watchData.tracks || []).map(function(t) {
      return { file: t.file, label: t.label || 'English' }
    })

    res.json({ sources: sources, tracks: tracks })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

// ===== HDHub (Stremio addon, direct MKV + HLS with subtitles) =====
router.get('/hdhub', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    if (!tmdbId) return res.json({ sources: [] })
    var mediaType = type || 'tv'

    var extData
    try {
      extData = await tmdbFetch(mediaType + '/' + tmdbId + '/external_ids')
    } catch (e) {
      return res.json({ sources: [], error: 'TMDB lookup failed' })
    }
    var imdbId = extData && extData.imdb_id
    if (!imdbId) return res.json({ sources: [], error: 'No IMDB ID' })

    var hdUrl = mediaType === 'movie'
      ? 'https://hdhub.thevolecitor.qzz.io/stream/movie/' + imdbId + '.json'
      : 'https://hdhub.thevolecitor.qzz.io/stream/series/' + imdbId + ':' + season + ':' + episode + '.json'

    var hdResp
    try {
      hdResp = await fetchWithTimeout(hdUrl, {
        headers: { 'User-Agent': UA }
      }, 10000)
    } catch (e) {
      return res.json({ sources: [], error: 'HDHub timeout' })
    }
    if (!hdResp.ok) return res.json({ sources: [], error: 'HDHub status ' + hdResp.status })
    var hdData = await hdResp.json()
    var items = hdData && hdData.streams ? hdData.streams : []

    var sources = []
    var tracks = []
    var seenUrls = {}

    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var url = item.url || ''
      if (!url) continue
      if (url.indexOf('/login.php') > -1) continue
      if (url.indexOf('.zip') > -1) continue
      if (url.indexOf('.rar') > -1) continue
      if (seenUrls[url]) continue
      seenUrls[url] = true

      var quality = 'HD'
      var name = item.name || ''
      var qm = name.match(/(\d{3,4}p)/i)
      if (qm) quality = qm[1]
      else if (name.match(/4[kK]/i)) quality = '4K'
      else if (name.match(/2160/i)) quality = '2160p'
      else if (name.match(/1080/i)) quality = '1080p'
      else if (name.match(/720/i)) quality = '720p'

      var streamType = url.indexOf('.m3u8') > -1 ? 'hls' : 'mp4'
      var headers = item.behaviorHints && item.behaviorHints.proxyHeaders && item.behaviorHints.proxyHeaders.request

      // Extract subtitles if present
      if (item.subtitles && item.subtitles.length) {
        for (var si = 0; si < item.subtitles.length; si++) {
          var sub = item.subtitles[si]
          if (sub.url && sub.lang) {
            // Deduplicate subtitles
            var dup = false
            for (var ti = 0; ti < tracks.length; ti++) {
              if (tracks[ti].file === sub.url) { dup = true; break }
            }
            if (!dup) {
              tracks.push({ file: sub.url, label: sub.lang === 'en' ? 'English' : (sub.lang || 'Unknown') })
            }
          }
        }
      }

      sources.push({
        url: url,
        quality: quality,
        type: streamType,
        headers: headers || undefined,
        _provider: name.split(' ')[0] || 'HDHub'
      })
    }

    res.json({ sources: sources, tracks: tracks })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

export default router
