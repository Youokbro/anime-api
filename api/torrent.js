import express from 'express'
var router = express.Router()
router.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function normalizeSize(str) {
  if (!str || str === 'unknown') return 0
  str = str.replace(/,/g, '').trim()
  var m = str.match(/^([\d.]+)\s*(GiB|GB|MiB|MB|KiB|KB|B)?$/i)
  if (m) {
    var n = parseFloat(m[1])
    var u = (m[2] || '').toLowerCase()
    if (u === 'gib' || u === 'gb') return Math.round(n * 1024)
    if (u === 'mib' || u === 'mb') return Math.round(n)
    if (u === 'kib' || u === 'kb') return Math.round(n / 1024)
    if (u === 'b') return Math.round(n / (1024 * 1024))
  }
  var n = parseFloat(str)
  return isNaN(n) ? 0 : Math.round(n)
}

async function fetchText(url, ref) {
  var r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': ref || 'https://www.google.com/' } })
  return r.text()
}

async function searchNyaa(query) {
  var html = await fetchText('https://nyaa.si/?q=' + encodeURIComponent(query) + '&s=seeders&o=desc')
  var results = []
  var tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/)
  if (!tbodyMatch) return results
  var tbody = tbodyMatch[1]
  var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  var match
  while ((match = rowRe.exec(tbody)) !== null) {
    var row = match[1]
    var tds = row.match(/<td[^>]*>[\s\S]*?<\/td>/g)
    if (!tds || tds.length < 3) continue
    var titleLink = row.match(/<a[^>]*href="\/view\/\d+"[^>]*>([\s\S]*?)<\/a>/)
    if (!titleLink) continue
    var title = titleLink[1].replace(/<[^>]*>/g, '').trim()
    if (!title) continue
    var magnetLink = row.match(/href="(magnet:\?[^"]+)"/)
    if (!magnetLink) continue
    var sizeC = tds[tds.length - 3] || ''
    var seedC = tds[tds.length - 2] || ''
    var leechC = tds[tds.length - 1] || ''
    var sizeM = sizeC.match(/>([\s\S]*?)</)
    var seedM = seedC.match(/>([\d,]+)</)
    var leechM = leechC.match(/>([\d,]+)</)
    var quality = 'unknown'
    var qm = title.match(/(\d{3,4}[pi])/i)
    if (qm) quality = qm[1]
    else if (title.match(/4[kK]/i)) quality = '4K'
    else if (title.match(/1080/i)) quality = '1080p'
    else if (title.match(/720/i)) quality = '720p'
    results.push({
      title: title,
      magnet: magnetLink[1],
      size: normalizeSize(sizeM ? sizeM[1].trim() : 'unknown'),
      seeders: seedM ? parseInt(seedM[1].replace(/,/g, '')) : 0,
      leechers: leechM ? parseInt(leechM[1].replace(/,/g, '')) : 0,
      quality: quality,
      source: 'nyaa'
    })
  }
  return results
}

async function search1337x(query) {
  var results = []
  var html
  try {
    html = await fetchText('https://1337x.to/search/' + encodeURIComponent(query.replace(/[^a-zA-Z0-9 ]/g, '')) + '/1/')
  } catch (e) { return results }
  var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  var match
  while ((match = rowRe.exec(html)) !== null) {
    var row = match[1]
    var cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g)
    if (!cells || cells.length < 4) continue
    var nameM = row.match(/<a[^>]*href="(\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!nameM) continue
    var name = nameM[2].replace(/<[^>]*>/g, '').trim()
    if (!name) continue
    var seedM = cells[cells.length - 4] ? cells[cells.length - 4].match(/>([\d,]+)</) : null
    var leechM = cells[cells.length - 3] ? cells[cells.length - 3].match(/>([\d,]+)</) : null
    var sizeM = cells[cells.length - 1] ? cells[cells.length - 1].match(/>([\s\S]*?)</) : null
    var quality = 'unknown'
    var qm = name.match(/(\d{3,4}[pi])/i)
    if (qm) quality = qm[1]
    else if (name.match(/4[kK]/i)) quality = '4K'
    else if (name.match(/1080/i)) quality = '1080p'
    else if (name.match(/720/i)) quality = '720p'

    results.push({
      title: name,
      magnet: null,
      detailUrl: 'https://1337x.to' + nameM[1],
      size: normalizeSize(sizeM ? sizeM[1].trim() : 'unknown'),
      seeders: seedM ? parseInt(seedM[1].replace(/,/g, '')) : 0,
      leechers: leechM ? parseInt(leechM[1].replace(/,/g, '')) : 0,
      quality: quality,
      source: '1337x'
    })
  }

  // Fetch magnets only for top 8, in parallel
  var top = results.slice(0, 8)
  await Promise.all(top.map(function(r) {
    return fetchText(r.detailUrl, 'https://1337x.to/').then(function(dh) {
      var mm = dh.match(/href="(magnet:\?[^"]+)"/)
      if (mm) r.magnet = mm[1]
    }).catch(function() {})
  }))

  return results.map(function(r) {
    delete r.detailUrl
    if (r.magnet === null) r.magnet = 'need_visit'
    return r
  })
}

async function searchTokyoTosho(query) {
  var results = []
  var html
  try {
    html = await fetchText('https://www.tokyotosho.info/search.php?terms=' + encodeURIComponent(query) + '&type=1')
  } catch (e) { return results }
  var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  var match
  while ((match = rowRe.exec(html)) !== null) {
    var row = match[1]
    if (row.indexOf('class="category_tr"') > -1) continue
    var titleM = row.match(/<a[^>]*href="(magnet:\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!titleM) continue
    var title = titleM[2].replace(/<[^>]*>/g, '').trim()
    if (!title) continue
    var sizeM = row.match(/Size:\s*<\/td><td[^>]*>([\s\S]*?)</)
    var seedM = row.match(/<span[^>]*class="seed"[^>]*>([\d,]+)<\/span>/)
    var leechM = row.match(/<span[^>]*class="leech"[^>]*>([\d,]+)<\/span>/)
    var quality = 'unknown'
    var qm = title.match(/(\d{3,4}[pi])/i)
    if (qm) quality = qm[1]
    else if (title.match(/4[kK]/i)) quality = '4K'
    else if (title.match(/1080/i)) quality = '1080p'
    else if (title.match(/720/i)) quality = '720p'
    results.push({
      title: title,
      magnet: titleM[1],
      size: normalizeSize(sizeM ? sizeM[1].trim() : 'unknown'),
      seeders: seedM ? parseInt(seedM[1].replace(/,/g, '')) : 0,
      leechers: leechM ? parseInt(leechM[1].replace(/,/g, '')) : 0,
      quality: quality,
      source: 'tokyotosho'
    })
  }
  return results
}

router.get('/search', async function(req, res) {
  try {
    var q = req.query.q
    if (!q) return res.status(400).json({ error: 'missing q' })
    var sources = req.query.sources || 'nyaa,1337x,tokyotosho'
    var srcList = sources.split(',').map(function(s) { return s.trim() })
    var tasks = []
    if (srcList.indexOf('nyaa') > -1) tasks.push(searchNyaa(q))
    if (srcList.indexOf('1337x') > -1) tasks.push(search1337x(q))
    if (srcList.indexOf('tokyotosho') > -1) tasks.push(searchTokyoTosho(q))
    var allResults = await Promise.allSettled(tasks)
    var torrents = []
    for (var i = 0; i < allResults.length; i++) {
      if (allResults[i].status === 'fulfilled') {
        torrents = torrents.concat(allResults[i].value)
      }
    }
    torrents.sort(function(a, b) { return b.seeders - a.seeders })
    res.json({ torrents: torrents })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
