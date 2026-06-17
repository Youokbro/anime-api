import { ANIME } from '@consumet/extensions';

const PROVIDERS = ['Hianime', 'AnimePahe', 'AnimeSaturn', 'AnimeUnity', 'AnimeKai', 'KickAssAnime'];

async function testProviders() {
  console.log("Starting provider tests for: Naruto\n");
  
  for (const name of PROVIDERS) {
    console.log(`Testing: ${name}...`);
    try {
      if (!ANIME[name]) {
        console.log(`❌ ${name}: Provider not found in @consumet/extensions`);
        continue;
      }
      
      const provider = new ANIME[name]();
      const results = await provider.search("Naruto");
      
      if (results && results.results && results.results.length > 0) {
        console.log(`✅ ${name}: Working! (Found ${results.results.length} results)`);
      } else {
        console.log(`⚠️ ${name}: Returned no results`);
      }
    } catch (error) {
      console.log(`❌ ${name}: Failed with error: ${error.message}`);
    }
    console.log("-----------------------------------");
  }
}

testProviders();
