import express from 'express'
import crypto from 'crypto'

var router = express.Router()
var REDIRECT = 'https://anime-api-nu-eight.vercel.app/api/anilist/callback'
var FRONTEND = 'https://youokbro.github.io/anime/'

// Step 1: Generate PKCE verifier+challenge, redirect to AniList
router.get('/login', function(req, res) {
  var verifier = crypto.randomBytes(64).toString('base64url')
  var challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  var url = 'https://anilist.co/api/v2/oauth/authorize?' +
    'client_id=43388' +
    '&response_type=code' +
    '&code_challenge_method=S256' +
    '&code_challenge=' + challenge +
    '&state=' + verifier +
    '&redirect_uri=' + encodeURIComponent(REDIRECT)
  res.redirect(url)
})

// Step 2: AniList redirects here with code + state (which is our verifier)
router.get('/callback', async function(req, res) {
  try {
    var code = req.query.code
    var verifier = req.query.state
    if (!code || !verifier) {
      return res.redirect(FRONTEND + '#error=' + encodeURIComponent('missing code or verifier'))
    }
    var resp = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: '43388',
        code: code,
        code_verifier: verifier,
        redirect_uri: REDIRECT
      })
    })
    var data = await resp.json()
    if (data.access_token) {
      res.type('html').send('<script>location.href="' + FRONTEND + '#access_token=' + data.access_token + '"</script>')
    } else {
      res.type('html').send('<script>location.href="' + FRONTEND + '#error=' + encodeURIComponent(data.error || 'token exchange failed') + '"</script>')
    }
  } catch (e) {
    res.type('html').send('<script>location.href="' + FRONTEND + '#error=' + encodeURIComponent(e.message) + '"</script>')
  }
})

export default router
