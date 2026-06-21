import express from 'express'
var router = express.Router()

const TMDB_PROXY = 'https://miruro-api-navy.vercel.app/tmdb'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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

// ===== VidLink Provider (self-hosted, via enc-dec.app + vidlink.pro) =====
router.get('/vidlink', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    var mediaType = type || 'tv'

    var encResp = await fetchWithTimeout('https://enc-dec.app/api/enc-vidlink?text=' + tmdbId, {
      headers: { 'User-Agent': UA }
    }, 6000)
    var encData = await encResp.json()
    var encrypted = encData.text
    if (!encrypted) return res.json({ sources: [] })

    var url = mediaType === 'movie'
      ? 'https://vidlink.pro/api/b/movie/' + encrypted + '?multiLang=0'
      : 'https://vidlink.pro/api/b/tv/' + encrypted + '/' + season + '/' + episode + '?multiLang=0'

    var streamResp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vidlink.pro' }
    }, 6000)
    var streamData = await streamResp.json()
    var playlist = streamData && streamData.data && streamData.data.stream && streamData.data.stream.playlist
    if (!playlist) return res.json({ sources: [] })

    res.json({ sources: [{ url: playlist, quality: 'Auto', type: 'hls' }], tracks: [] })
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

    var apiResp = await fetchWithTimeout(apiUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json, text/javascript, */*; q=0.01' }
    }, 6000)
    var apiData = await apiResp.json()
    var embedPath = apiData && apiData.src
    if (!embedPath) return res.json({ sources: [] })

    var embedResp = await fetchWithTimeout(BASE + embedPath, {
      headers: { 'User-Agent': UA, 'Referer': BASE + '/', 'Origin': BASE }
    }, 6000)
    var html = await embedResp.text()

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

// ===== MediaFlow + VixSrc (passes vixsrc.to TV/movie URL through MediaFlow's VixCloud extractor) =====
router.get('/mf-vixsrc', async function(req, res) {
  try {
    var { tmdbId, season, episode, type } = req.query
    var mediaType = type || 'tv'
    var BASE = 'https://vixsrc.to'

    // Pass the movie/TV page URL directly to MediaFlow's VixCloud extractor
    var pageUrl = mediaType === 'movie'
      ? BASE + '/movie/' + tmdbId
      : BASE + '/tv/' + tmdbId + '/' + season + '/' + episode

    var mfUrl = MF_BASE + '/extractor/video?host=VixCloud&d=' + encodeURIComponent(pageUrl) + '&api_password=' + MF_PASS + '&redirect_stream=true'

    var mfResp = await fetchWithTimeout(mfUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual'
    }, 12000)

    if (mfResp.status >= 300 && mfResp.status < 400) {
      var location = mfResp.headers.get('location')
      if (location) {
        return res.json({ sources: [{ url: location, quality: 'Auto', type: 'hls' }], tracks: [] })
      }
    }

    var mfData = await mfResp.json()
    if (mfData && mfData.url) {
      return res.json({ sources: [{ url: mfData.url, quality: mfData.quality || 'Auto', type: mfData.type || 'hls' }], tracks: [] })
    }
    if (mfData && mfData.sources && mfData.sources.length) {
      return res.json(mfData)
    }

    res.json({ sources: [] })
  } catch (e) {
    res.json({ sources: [], error: e.message })
  }
})

export default router
