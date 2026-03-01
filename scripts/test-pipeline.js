/**
 * Integration test: runs the full 3-phase pipeline once against live
 * TikTok FYP + OpenRouter + Supabase.
 *
 * This tests the complete flow:
 *   Scrape FYP → Score → Trash Gate → Deep Analysis → Synthesis →
 *   Brand Fit → Supabase writes → Screenshot cleanup
 *
 * Usage: node scripts/test-pipeline.js
 */
require('dotenv').config();
const { runPipelineOnce } = require('../src/pipeline');

(async () => {
  try {
    console.log('');
    console.log('=== Full Pipeline Integration Test ===');
    console.log('');
    console.log('This will:');
    console.log('  1. Scrape TikTok FYP (30-60s)');
    console.log('  2. Score all videos');
    console.log('  3. Phase 1: Trash Gate (batch LLM filter)');
    console.log('  4. Phase 2: Deep Analysis (per-trend multimodal LLM)');
    console.log('  5. Phase 3: Cross-Trend Synthesis');
    console.log('  6. Brand Fit scoring (3 brands x surviving trends)');
    console.log('  7. Write everything to Supabase');
    console.log('  8. Cleanup screenshots');
    console.log('');

    const stats = await runPipelineOnce();

    console.log('');
    console.log('=== PIPELINE RESULTS ===');
    console.log(`  Scraped:     ${stats.scraped} videos from FYP`);
    console.log(`  New trends:  ${stats.new}`);
    console.log(`  Updated:     ${stats.updated}`);
    console.log(`  Signals:     ${stats.signals} (passed Trash Gate)`);
    console.log(`  Filtered:    ${stats.filtered} (noise)`);
    console.log(`  Analyzed:    ${stats.analyzed} (deep analysis)`);
    console.log(`  Synthesized: ${stats.synthesized ? 'YES' : 'NO'}`);
    console.log(`  Brand fits:  ${stats.brand_fits} rows`);
    console.log(`  Errors:      ${stats.errors}`);
    console.log('');

    // Basic sanity checks
    const issues = [];
    if (stats.scraped === 0) issues.push('No videos scraped — TikTok may be blocking');
    if (stats.scraped > 0 && stats.signals === 0) issues.push('Trash Gate filtered everything — check prompt');
    if (stats.signals > 0 && stats.analyzed === 0) issues.push('Deep analysis produced no results — check API key');

    if (issues.length > 0) {
      console.log('=== ISSUES ===');
      for (const issue of issues) {
        console.log(`  WARNING: ${issue}`);
      }
      console.log('');
    } else {
      console.log('=== ALL CHECKS PASSED ===');
      console.log('');
    }
  } catch (err) {
    console.error('Integration test failed:', err);
    process.exit(1);
  }
})();
