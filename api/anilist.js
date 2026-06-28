import express from 'express'
import crypto from 'crypto'

var router = express.Router()
var CLIENT_ID = '43388'
var FRONTEND = 'https://youokbro.github.io/anime'

// Step 1: Generate PKCE verifier+challenge, redirect to AniList (redirect_uri=frontend, already registered)
router.get('/login', function(req, res) {
  var verifier = crypto.randomBytes(64).toString('base64url')
  var challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  var url = 'https://anilist.co/api/v2/oauth/authorize?' +
    'client_id=' + CLIENT_ID +
    '&response_type=code' +
    '&code_challenge_method=S256' +
    '&code_challenge=' + challenge +
    '&state=' + verifier +
    '&redirect_uri=' + encodeURIComponent(FRONTEND)
  res.redirect(url)
})

// Step 2: Frontend sends code + verifier here to exchange for token
router.get('/exchange', async function(req, res) {
  try {
    var code = req.query.code
    var verifier = req.query.verifier
    if (!code || !verifier) return res.status(400).json({ error: 'missing code or verifier' })
    var resp = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: code,
        code_verifier: verifier,
        redirect_uri: FRONTEND
      })
    })
    var data = await resp.json()
    if (data.access_token) {
      res.json({ access_token: data.access_token })
    } else {
      res.status(400).json({ error: data.error || 'token exchange failed' })
    }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
