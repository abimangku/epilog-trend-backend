/**
 * Manual test: runs the FYP scraper once and dumps results to console.
 * Usage: node scripts/test-fyp-scraper.js
 */
require('dotenv').config();
const { scrapeOnce } = require('../src/scrapers/tiktok');

(async () => {
  try {
    console.log('Starting FYP scraper test (max 10 videos, 60s timeout)...\n');
    const results = await scrapeOnce({ maxVideos: 10, timeoutMs: 60000 });

    console.log(`\n=== RESULTS ===`);
    console.log(`Videos scraped: ${results.videos.length}`);
    console.log(`Screenshots taken: ${results.screenshots.length}\n`);

    for (const v of results.videos) {
      console.log(`--- ${v.author} ---`);
      console.log(`  Title: ${(v.title || '').slice(0, 80)}`);
      console.log(`  Likes: ${v.likes} | Comments: ${v.comments} | Shares: ${v.shares} | Bookmarks: ${v.bookmarks}`);
      console.log(`  Hashtags: ${(v.hashtags || []).join(', ')}`);
      console.log(`  Audio: ${v.audio_title || 'none'} (${v.audio_id || 'no id'})`);
      console.log(`  Screenshot: ${v.screenshot_path ? 'YES' : 'NO'}`);
      console.log('');
    }
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
