import express from 'express'
var router = express.Router()

router.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Content-Type', 'application/json')
  next()
})

var BASE = 'https://v2.seedr.cc/api/v0.1/p'
var TOKEN = process.env.SEEDR_API_KEY || ''

async function seedrFetch(method, path, body) {
  var opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Accept': 'application/json'
    }
  }
  if (body) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  var r = await fetch(BASE + path, opts)
  var data
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data: data }
}

router.post('/add', async function(req, res) {
  try {
    var magnet = req.body.magnet || req.query.magnet
    if (!magnet) return res.status(400).json({ error: 'missing magnet' })
    var result = await seedrFetch('POST', '/tasks', { magnet: magnet })
    res.status(result.status).json(result.data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/status', async function(req, res) {
  try {
    var taskId = req.query.task_id
    if (!taskId) return res.status(400).json({ error: 'missing task_id' })
    var result = await seedrFetch('GET', '/tasks/' + taskId)
    res.json(result.data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/contents', async function(req, res) {
  try {
    var folderId = req.query.folder_id || '0'
    var result = await seedrFetch('GET', '/fs/folder/' + folderId + '/contents')
    res.json(result.data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/hls', async function(req, res) {
  try {
    var fileId = req.query.file_id
    if (!fileId) return res.status(400).json({ error: 'missing file_id' })
    var result = await seedrFetch('GET', '/download/file/' + fileId + '/url')
    if (result.data && result.data.url) {
      res.json({ url: result.data.url, name: result.data.name })
    } else {
      res.status(404).json({ error: 'no url' })
    }
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/task/:id', async function(req, res) {
  try {
    var taskId = req.params.id
    var result = await seedrFetch('DELETE', '/tasks/' + taskId)
    res.status(result.status).json(result.data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/delete', async function(req, res) {
  try {
    var items = req.body.items || req.query.items
    if (!items) return res.status(400).json({ error: 'missing items' })
    if (typeof items === 'string') items = JSON.parse(items)
    var result = await seedrFetch('POST', '/fs/batch/delete', { delete_arr: JSON.stringify(items) })
    res.json(result.data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/cleanup', async function(req, res) {
  try {
    var count = 0
    // Delete active tasks from /tasks endpoint (where Seedr stores active downloads)
    var tasksResp = await seedrFetch('GET', '/tasks')
    if (tasksResp.data && tasksResp.data.torrents) {
      var tasks = tasksResp.data.torrents
      for (var i = 0; i < tasks.length; i++) {
        var tid = tasks[i].id
        if (tid) {
          try {
            await seedrFetch('DELETE', '/tasks/' + tid)
            count++
          } catch (e) {}
        }
      }
    }
    // Also clean up filesystem (folders/files from previous downloads)
    var root = await seedrFetch('GET', '/fs/folder/0/contents')
    if (root.data) {
      var data = root.data
      var batchItems = []
      ;(data.folders || []).forEach(function(f) { batchItems.push({ type: 'folder', id: f.id }) })
      ;(data.files || []).forEach(function(f) { batchItems.push({ type: 'file', id: f.id }) })
      if (batchItems.length) {
        try {
          await seedrFetch('POST', '/fs/batch/delete', { delete_arr: JSON.stringify(batchItems) })
          count += batchItems.length
        } catch (e) {}
      }
    }
    res.json({ ok: true, deleted: count })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
