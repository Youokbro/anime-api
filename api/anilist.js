import express from 'express'
import crypto from 'crypto'

var router = express.Router()

router.get('/callback', async function(req, res) {
  try {
    var code = req.query.code
    var verifier = req.query.state
    if (!code || !verifier) {
      return res.redirect('https://youokbro.github.io/anime/#error=' + encodeURIComponent('missing code or verifier'))
    }
    var resp = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: '43388',
        code: code,
        code_verifier: verifier,
        redirect_uri: 'https://anime-api-nu-eight.vercel.app/api/anilist/callback'
      })
    })
    var data = await resp.json()
    if (data.access_token) {
      res.redirect('https://youokbro.github.io/anime/#access_token=' + data.access_token)
    } else {
      res.redirect('https://youokbro.github.io/anime/#error=' + encodeURIComponent(data.error || 'token exchange failed'))
    }
  } catch (e) {
    res.redirect('https://youokbro.github.io/anime/#error=' + encodeURIComponent(e.message))
  }
})

export default router
