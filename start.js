import app from './api/index.js'
var PORT = process.env.PORT || 3000
app.listen(PORT, function() {
  console.log('anime-api running on port ' + PORT)
})
