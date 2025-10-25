import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function checkSummaryFormat() {
  console.log('🔍 CHECKING SUMMARY FORMAT\n');

  // Get scraps that HAVE summaries
  const { data: scrapsWithSummaries, error } = await supabase
    .from('scraps')
    .select('id, title, summary, content, tags, source, updated_at')
    .not('summary', 'is', null)
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${scrapsWithSummaries.length} scraps with summaries\n`);

  scrapsWithSummaries.forEach((scrap, i) => {
    console.log(`\n[${ i + 1}] ${scrap.title?.substring(0, 60) || 'No title'}...`);
    console.log(`   Source: ${scrap.source}`);
    console.log(`   Updated: ${scrap.updated_at}`);
    console.log('\n   SUMMARY:');
    console.log('   ' + '='.repeat(70));
    console.log(scrap.summary);
    console.log('   ' + '='.repeat(70));
    console.log(`\n   Summary length: ${scrap.summary?.length || 0} chars`);
    console.log(`   Content length: ${scrap.content?.length || 0} chars`);
    console.log(`   Tags: ${scrap.tags?.join(', ') || 'none'}`);
  });

  // Check for specific patterns
  console.log('\n\n🔍 CHECKING FOR NEWLINE-DELIMITED FORMAT:\n');

  const withNewlines = scrapsWithSummaries.filter(s => s.summary?.includes('\n'));
  console.log(`Summaries with newlines: ${withNewlines.length}/${scrapsWithSummaries.length}`);

  if (withNewlines.length > 0) {
    console.log('\nExample with newlines:');
    console.log('---');
    console.log(withNewlines[0].summary);
    console.log('---');
  }
}

checkSummaryFormat().catch(console.error);
