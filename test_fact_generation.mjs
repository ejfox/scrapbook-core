import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { completion } from './scripts/llmService.mjs';
import { fetchPageContent } from './helpers.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Get an interesting article with rich content
const { data: articles } = await supabase
  .from('scraps')
  .select('*')
  .eq('source', 'pinboard')
  .not('title', 'is', null)
  .not('content', 'is', null)
  .order('created_at', { ascending: false })
  .limit(10);

// Pick an interesting article
const article = articles.find(a =>
  a.content && a.content.length > 1000
) || articles[0];

console.log('📚 Testing article:', article.title?.substring(0, 100));
console.log('URL:', article.url);
console.log('\n' + '='.repeat(80));

// Fetch full content
let content = article.content || '';
try {
  if (article.url) {
    console.log('Fetching full content...');
    const fullContent = await fetchPageContent(article.url);
    if (fullContent && fullContent.length > content.length) {
      content = fullContent;
      console.log(`✓ Fetched ${fullContent.length} characters`);
    }
  }
} catch (error) {
  console.log('Using cached content');
}

// Test 6 POWER frontier models for creative fact generation
const models = [
  'anthropic/claude-3.5-sonnet',    // $3/$15 per 1M - Most creative
  'openai/gpt-4o',                  // $2.50/$10 per 1M - Strong reasoning
  'anthropic/claude-3.5-haiku',     // $0.80/$4 per 1M - Fast Claude
  'mistralai/mistral-large-2411',   // ~$2/$6 per 1M - European perspective
  'google/gemini-2.5-flash',        // $0.30/$2.50 per 1M - Current model
  'deepseek/deepseek-chat-v3.1'     // $0.27/$1 per 1M - Surprisingly good
];

// Creative fact generation prompt
const prompt = `Analyze this article and generate a rich, insightful summary with fascinating facts.

Title: ${article.title}
URL: ${article.url}
Content: ${content.substring(0, 4000)}

GENERATE:
1. A compelling 2-3 sentence summary that captures the essence
2. A list of 5-7 fascinating, specific facts or insights from the article
3. Key themes and concepts (3-5 main ideas)
4. Notable quotes or data points if present
5. Why this matters or what makes it interesting

BE CREATIVE AND INSIGHTFUL:
- Extract surprising or counterintuitive facts
- Identify patterns and connections
- Highlight unique details others might miss
- Make it engaging and memorable
- Focus on the "so what?" - why should someone care?

Format as a rich, readable summary that would make someone want to learn more.`;

console.log('\n🔬 FACT GENERATION MODEL COMPARISON');
console.log('Testing frontier models for creative summarization\n');

for (const model of models) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🤖 Testing ${model}:`);
    const startTime = Date.now();

    const response = await completion({
      model,
      prompt,
      max_tokens: 1000,
      temperature: 0.7  // Higher temp for creativity
    });

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = response?.content || response || '';

    console.log(`⏱️  Time: ${timeTaken}s`);
    console.log(`📝 Response length: ${summary.length} characters`);

    // Show first 800 chars of the summary
    console.log(`\n--- Summary Preview ---`);
    console.log(summary.substring(0, 800) + '...\n');

    // Count interesting metrics
    const bulletPoints = (summary.match(/[•\-\*]\s/g) || []).length;
    const numbers = (summary.match(/\d+/g) || []).length;
    const quotes = (summary.match(/["'"]/g) || []).length / 2;

    console.log(`📊 Metrics:`);
    console.log(`  • Bullet points: ${bulletPoints}`);
    console.log(`  • Numbers/data: ${numbers}`);
    console.log(`  • Quotes: ${Math.floor(quotes)}`);

    // Estimate cost for 1000 summaries
    const tokenEstimate = 5000; // Rough estimate for prompt + response
    const costs = {
      'anthropic/claude-3.5-sonnet': (tokenEstimate * 0.000003) + (1000 * 0.000015),
      'openai/gpt-4o': (tokenEstimate * 0.0000025) + (1000 * 0.00001),
      'anthropic/claude-3.5-haiku': (tokenEstimate * 0.0000008) + (1000 * 0.000004),
      'mistralai/mistral-large-2411': (tokenEstimate * 0.000002) + (1000 * 0.000006),
      'google/gemini-2.5-flash': (tokenEstimate * 0.0000003) + (1000 * 0.0000025),
      'deepseek/deepseek-chat-v3.1': (tokenEstimate * 0.00000027) + (1000 * 0.000001)
    };

    const estimatedCost = costs[model] || 0;
    console.log(`💰 Cost per summary: $${estimatedCost.toFixed(6)}`);
    console.log(`💸 Cost per 1000 summaries: $${(estimatedCost * 1000).toFixed(2)}`);

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('\n🎯 EVALUATION CRITERIA:');
console.log('• Creativity and insight quality');
console.log('• Fact extraction accuracy');
console.log('• Engaging writing style');
console.log('• Unique perspectives');
console.log('• Cost vs quality tradeoff');
console.log('\n💡 For creative tasks like summarization:');
console.log('• Claude 3.5 Sonnet excels at nuanced, creative summaries');
console.log('• GPT-4o provides strong analytical insights');
console.log('• Mistral Large offers unique European perspective');
console.log('• DeepSeek is surprisingly good for the price');