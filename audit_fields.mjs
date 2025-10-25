import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function auditFields() {
  console.log('🔍 SCRAPBOOK FIELD COMPLETENESS AUDIT\n');
  console.log('=' .repeat(80));

  // Get total count
  const { count: total } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📊 Total Scraps: ${total.toLocaleString()}\n`);

  // Check each field
  const fields = [
    { name: 'ai_summary', label: 'AI Summary' },
    { name: 'ai_tags', label: 'AI Tags' },
    { name: 'summary', label: 'Summary (legacy)' },
    { name: 'tags', label: 'Tags (legacy)' },
    { name: 'relationships', label: 'Relationships' },
    { name: 'location', label: 'Location' },
    { name: 'latitude', label: 'Latitude' },
    { name: 'longitude', label: 'Longitude' },
    { name: 'financial_analysis', label: 'Financial Analysis' },
    { name: 'screenshot_url', label: 'Screenshots' },
    { name: 'embedding', label: 'Embeddings' },
  ];

  for (const field of fields) {
    const result = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true })
      .not(field.name, 'is', null);

    const count = result.count || 0;
    const percentage = ((count / total) * 100).toFixed(1);
    const status = percentage > 80 ? '✅' : percentage > 50 ? '🟡' : percentage > 20 ? '⚠️' : '❌';

    console.log(`${status} ${field.label.padEnd(25)} ${count.toLocaleString().padStart(6)} / ${total.toLocaleString()} (${percentage}%)`);
  }

  // Check for array/object field specifics
  console.log('\n' + '=' .repeat(80));
  console.log('\n🔍 DETAILED CHECKS:\n');

  // Relationships with actual data
  const relResult = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .not('relationships', 'is', null)
    .neq('relationships', '[]');
  const relWithData = relResult.count || 0;

  console.log(`📊 Relationships (non-empty): ${relWithData.toLocaleString()} (${((relWithData / total) * 100).toFixed(1)}%)`);

  // AI Tags with actual data
  const tagsResult = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .not('ai_tags', 'is', null)
    .neq('ai_tags', '[]');
  const tagsWithData = tagsResult.count || 0;

  console.log(`🏷️  AI Tags (non-empty): ${tagsWithData.toLocaleString()} (${((tagsWithData / total) * 100).toFixed(1)}%)`);

  // Geo-located (both lat and lon)
  const geoResult = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  const geolocated = geoResult.count || 0;

  console.log(`📍 Fully Geo-located (lat+lon): ${geolocated.toLocaleString()} (${((geolocated / total) * 100).toFixed(1)}%)`);

  // Recent activity (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentResult = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .gte('updated_at', sevenDaysAgo.toISOString());
  const recentlyUpdated = recentResult.count || 0;

  console.log(`\n⏰ Updated in last 7 days: ${recentlyUpdated.toLocaleString()} (${((recentlyUpdated / total) * 100).toFixed(1)}%)`);

  // Calculate backlog
  const backlogResult = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true })
    .is('ai_summary', null);
  const needsProcessing = backlogResult.count || 0;

  console.log('\n' + '=' .repeat(80));
  console.log(`\n🚨 BACKLOG: ${needsProcessing.toLocaleString()} scraps need AI processing`);
  console.log(`💰 Estimated cost to process backlog: ~$${(needsProcessing * 0.002).toFixed(2)} (rough estimate)\n`);
}

auditFields().catch(console.error);
