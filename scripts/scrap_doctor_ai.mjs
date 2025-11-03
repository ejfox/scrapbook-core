#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import ora from 'ora'
import { program } from 'commander'
import path from 'path'
import fs from 'fs'

// Import AI services and utilities
import { summarizeContent } from './aiSummarization.mjs'
import { extractRelationships } from './aiRelationshipExtraction.mjs'
import { extractLocation } from './aiGeolocation.mjs'
import { extractFinancialAnalysis } from './aiFinancialAnalysis.mjs'
import { enrichWithReasoningFields } from './reasoningFields.mjs'
import { generateScreenshot } from './generateScreenshot.mjs'
import { completion, MODELS } from './llmService.mjs'
import { getModelForTask } from '../lib/config.mjs'
import { fetchPageContent } from '../helpers.js'
import { trackCost } from './costTracking.mjs'
import Bottleneck from 'bottleneck'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
)

// Rate limiter for screenshots: 1 every 3 seconds
const browserLimiter = new Bottleneck({
  minTime: 3000,
  maxConcurrent: 1,
})

// Set up CLI
program
  .name('scrap-doctor-ai')
  .description('🩺 AI-powered doctor for your digital memory - generates rich summaries and tags')
  .version('2.0.0')

program
  .command('repair')
  .description('Repair scraps with AI-generated summaries, tags, and relationships')
  .option('-s, --source <source>', 'Only repair specific source')
  .option('-t, --type <type>', 'Only repair specific type (summary, tags, relationships, location, financial, screenshot)')
  .option('-l, --limit <number>', 'Limit repairs to N scraps', '10')
  .option('-a, --auto', 'Auto-repair without prompts')
  .option('--fetch-content', 'Fetch full content from URLs', true)
  .option('-f, --force', 'Force regenerate all fields even if they exist')
  .action(repair)

async function repair(options) {
  console.log(chalk.cyan('🔧 AI-Powered Scrap Doctor - Repair Mode\n'))

  const spinner = ora('Finding scraps that need repair...').start()

  // Get scraps that need repair - most recent first
  let query = supabase
    .from('scraps')
    .select('*')
    .order('created_at', { ascending: false })  // Most recent first
    .limit(parseInt(options.limit))

  if (options.source) {
    query = query.eq('source', options.source)
  }

  // Filter based on repair type
  if (options.type === 'summary') {
    query = query.or('summary.is.null,summary.eq.""')
  } else if (options.type === 'tags') {
    query = query.or('tags.is.null,tags.eq.{}')
  } else if (options.type === 'relationships') {
    query = query.or('relationships.is.null,relationships.eq.{}')
  } else if (options.type === 'location') {
    query = query.is('location', null)
  } else if (options.type === 'financial') {
    // For now, select all scraps since financial_analysis column may not exist yet
    // query = query.is('financial_analysis', null);
  } else if (options.type === 'screenshot') {
    query = query.not('url', 'is', null).is('screenshot_url', null)
  } else {
    // Get scraps missing any AI enrichment (excluding financial_analysis until column exists)
    query = query.or('summary.is.null,tags.is.null,relationships.is.null,location.is.null')
  }

  const { data: scraps, error } = await query

  if (error) {
    spinner.stop()
    console.error(chalk.red('❌ Error fetching scraps:'), error.message)
    return
  }

  spinner.stop()

  if (!scraps || scraps.length === 0) {
    console.log(chalk.green('✅ No scraps need repair!'))
    return
  }

  console.log(chalk.yellow(`Found ${scraps.length} scraps that need repair.\n`))

  let repaired = 0
  let failed = 0
  const retryQueue = [] // Queue for scraps that failed content fetch

  for (const [index, scrap] of scraps.entries()) {
    const progress = `[${index + 1}/${scraps.length}]`
    console.log(chalk.gray(`${progress} Repairing: ${scrap.title?.substring(0, 60) || scrap.url?.substring(0, 60) || scrap.scrap_id}...`))

    try {
      const result = await repairScrapWithAI(scrap, options)

      // Check if content fetch failed or returned insufficient content
      if (result && result.needsRetry) {
        retryQueue.push({ scrap, reason: result.retryReason, attempts: 1 })
        console.log(chalk.yellow(`  ⏭️  Queued for retry: ${result.retryReason}`))
      } else {
        repaired++
        console.log(chalk.green('  ✅ Repaired'))
      }
    } catch (error) {
      failed++
      console.log(chalk.red(`  ❌ Failed: ${error.message}`))
    }

    // Process retry queue every 10 scraps
    if ((index + 1) % 10 === 0 && retryQueue.length > 0) {
      console.log(chalk.blue(`\n🔄 Processing ${retryQueue.length} queued retries...\n`))

      const retriesToProcess = [...retryQueue]
      retryQueue.length = 0 // Clear queue

      for (const retry of retriesToProcess) {
        if (retry.attempts >= 3) {
          failed++
          console.log(chalk.red(`  ❌ Max retries reached for ${retry.scrap.title?.substring(0, 40)}`))
          continue
        }

        console.log(chalk.gray(`  🔄 Retry #${retry.attempts + 1}: ${retry.scrap.title?.substring(0, 60) || retry.scrap.url?.substring(0, 60)}...`))

        try {
          const result = await repairScrapWithAI(retry.scrap, options)

          if (result && result.needsRetry) {
            retryQueue.push({ ...retry, attempts: retry.attempts + 1 })
            console.log(chalk.yellow(`    ⏭️  Re-queued: ${result.retryReason}`))
          } else {
            repaired++
            console.log(chalk.green('    ✅ Retry successful'))
          }
        } catch (error) {
          failed++
          console.log(chalk.red(`    ❌ Retry failed: ${error.message}`))
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      console.log() // Blank line after retry batch
    }

    // Small delay to be nice to APIs
    if (index < scraps.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // Final retry pass for any remaining items
  if (retryQueue.length > 0) {
    console.log(chalk.blue(`\n🔄 Final pass: Processing ${retryQueue.length} remaining retries...\n`))

    for (const retry of retryQueue) {
      if (retry.attempts >= 3) {
        failed++
        console.log(chalk.red(`  ❌ Max retries reached for ${retry.scrap.title?.substring(0, 40)}`))
        continue
      }

      console.log(chalk.gray(`  🔄 Final retry: ${retry.scrap.title?.substring(0, 60) || retry.scrap.url?.substring(0, 60)}...`))

      try {
        const result = await repairScrapWithAI(retry.scrap, options)

        if (!result || !result.needsRetry) {
          repaired++
          console.log(chalk.green('    ✅ Retry successful'))
        } else {
          failed++
          console.log(chalk.red(`    ❌ Still insufficient: ${result.retryReason}`))
        }
      } catch (error) {
        failed++
        console.log(chalk.red(`    ❌ Retry failed: ${error.message}`))
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  console.log(chalk.blue('\n📊 Repair Summary:'))
  console.log(`  ✅ Repaired: ${repaired}`)
  console.log(`  ❌ Failed: ${failed}`)
  console.log(`  📈 Success rate: ${Math.round((repaired / scraps.length) * 100)}%`)
}

async function repairScrapWithAI(scrap, options) {
  const updates = {}
  const scrapId = scrap.scrap_id

  // If a specific type is requested, ONLY process that type
  const shouldProcessAll = !options.type || options.force
  const shouldProcessType = (type) => !options.type || options.type === type || options.force

  // Determine what content to use for AI processing
  let content = scrap.content || scrap.title || ''

  // Only fetch content if we're processing fields that need it (not for screenshots)
  let contentFetchFailed = false
  if (options.type !== 'screenshot' && options.fetchContent && scrap.url && (!content || content.length < 200)) {
    console.log(chalk.dim(`    Fetching content from ${scrap.url.substring(0, 50)}...`))
    try {
      const fetchedContent = await fetchPageContent(scrap.url)
      if (fetchedContent && fetchedContent.length > content.length) {
        content = fetchedContent
        console.log(chalk.dim(`    ✓ Fetched ${fetchedContent.length} chars of content`))
      }
    } catch (error) {
      contentFetchFailed = true
      console.log(chalk.dim(`    ⚠ Could not fetch content: ${error.message}`))
    }
  }

  // Check if we have insufficient content and should retry
  const MIN_CONTENT_LENGTH = 500
  if (options.fetchContent && scrap.url && content.length < MIN_CONTENT_LENGTH && contentFetchFailed) {
    // TODO: After 3+ retries, use vision model on screenshot_url as last resort
    // if (retryAttempts >= 3 && scrap.screenshot_url) {
    //   content = await extractTextFromScreenshot(scrap.screenshot_url)
    // }
    return {
      needsRetry: true,
      retryReason: `Insufficient content (${content.length} chars, fetch failed)`,
    }
  }

  // Generate summary if missing
  if (shouldProcessType('summary') && (!scrap.summary || scrap.summary.trim() === '')) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping summary (insufficient content)'))
    } else {
      console.log(chalk.dim('    Generating AI summary...'))
      console.log(chalk.gray(`      Input: ${content.length} chars, URL: ${scrap.url}`))
      try {
        const summary = await summarizeContent(content, {
          scrapId,
          taskType: 'summarization',
          url: scrap.url,
          title: scrap.title,
        })

        if (summary && summary.length > 50) {
          updates.summary = summary
          console.log(chalk.dim(`    ✓ Generated ${summary.length} char summary`))
        } else {
        // Critical field - throw if generation failed
          console.error(chalk.red('    ✗ CRITICAL: Summary generation returned empty/short result'))
          console.error(chalk.red(`      Scrap ID: ${scrapId}`))
          console.error(chalk.red(`      Content length: ${content.length}`))
          console.error(chalk.red(`      Summary received: ${JSON.stringify(summary)}`))
          throw new Error('Summary generation returned empty result')
        }
      } catch (error) {
        console.error(chalk.red('    ✗ SUMMARY GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
        throw error // Re-throw to stop repair
      }
    } // Close else block for summary content check
  }

  // Generate tags if missing or bad (only has 'pinboard')
  const hasBadTags = scrap.tags && scrap.tags.length === 1 && scrap.tags[0] === 'pinboard'
  if (shouldProcessType('tags') && (!scrap.tags || scrap.tags.length === 0 || hasBadTags)) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping tags (insufficient content)'))
    } else {
      console.log(chalk.dim('    Generating AI tags...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try {
        const tags = await generateTags(content, scrap)
        if (tags && tags.length > 0) {
          updates.tags = tags
          console.log(chalk.dim(`    ✓ Generated ${tags.length} tags: ${tags.join(', ')}`))
        } else {
          console.error(chalk.yellow('    ⚠ Tag generation returned empty array'))
          console.error(chalk.yellow(`      Scrap ID: ${scrapId}`))
          console.error(chalk.yellow(`      Content length: ${content.length}`))
          console.error(chalk.yellow(`      Tags received: ${JSON.stringify(tags)}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ TAG GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for tags content check
  }

  // Extract relationships if missing
  if (shouldProcessType('relationships') && (!scrap.relationships || scrap.relationships.length === 0)) {
    // Skip if no content
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping relationships (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting relationships...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))

      // Try 3 different models for relationship extraction
      const models = [
        'deepseek/deepseek-chat-v3.1',     // First try: DeepSeek (default)
        'google/gemini-2.5-flash',         // Second try: Gemini
        'openai/gpt-4o-mini',               // Third try: OpenAI
      ]

      let relationships = []
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const model = models[attempt]
          console.log(chalk.dim(`      Attempt ${attempt + 1}/3 with ${model}...`))

          relationships = await extractRelationships(content, {
            scrapId,
            url: scrap.url,
            title: scrap.title,
            model,
          })

          // If we got relationships, break out of retry loop
          if (relationships && relationships.length > 0) {
            updates.relationships = relationships
            console.log(chalk.dim(`    ✓ Extracted ${relationships.length} relationships from ${model}`))
            break
          } else {
            console.log(chalk.yellow(`      ${model} returned empty relationships`))
            console.log(chalk.gray(`        Response: ${JSON.stringify(relationships)}`))
          }
        } catch (error) {
          console.error(chalk.yellow(`      Attempt ${attempt + 1} with ${models[attempt]} FAILED`))
          console.error(chalk.yellow(`        Error: ${error.message}`))
          console.error(chalk.gray(`        Stack: ${error.stack}`))
          if (attempt < 2) {
          // Wait a bit before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      }

      if (!relationships || relationships.length === 0) {
        console.error(chalk.red('    ✗ ALL 3 MODELS FAILED TO EXTRACT RELATIONSHIPS'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Content length: ${content.length}`))
        console.error(chalk.red(`      Models tried: ${models.join(', ')}`))
      }
    } // Close else block for content check
  }

  // Extract locations if missing
  if (shouldProcessType('location') && !scrap.location) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping location (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting locations...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try{
        const locationData = await extractLocation(content, {
          scrapId,
          url: scrap.url,
          title: scrap.title,
        })

        if (locationData) {
          updates.location = locationData
          console.log(chalk.dim(`    ✓ Extracted location: ${locationData.location || 'Unknown'}`))
        } else {
          console.log(chalk.yellow('    ⚠ Location extraction returned null'))
          console.log(chalk.gray(`      Scrap ID: ${scrapId}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ LOCATION EXTRACTION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for location content check
  }

  // Extract financial analysis if missing
  if (shouldProcessType('financial') && (!scrap.financial_analysis || typeof scrap.financial_analysis === 'undefined')) {
    if (!content || content.length < 50) {
      console.log(chalk.dim('    ⏭️  Skipping financial analysis (insufficient content)'))
    } else {
      console.log(chalk.dim('    Extracting financial analysis...'))
      console.log(chalk.gray(`      Input: ${content.length} chars`))
      try {
        const financialAnalysis = await extractFinancialAnalysis(content, {
          url: scrap.url,
          isRawText: false,
        })

        // Only add financial analysis if we found some assets or meaningful data
        if (financialAnalysis && (
          (financialAnalysis.assets && financialAnalysis.assets.length > 0) ||
        (financialAnalysis.tracked_assets && financialAnalysis.tracked_assets.length > 0) ||
        (financialAnalysis.discovered_assets && financialAnalysis.discovered_assets.length > 0) ||
        Math.abs(financialAnalysis.overall_market_sentiment || 0) > 0.1
        )) {
          updates.financial_analysis = financialAnalysis
          const assetCount = (financialAnalysis.assets || []).length
          const trackedCount = (financialAnalysis.tracked_assets || []).length
          const discoveredCount = (financialAnalysis.discovered_assets || []).length
          console.log(chalk.dim(`    ✓ Extracted financial data: ${trackedCount} tracked, ${discoveredCount} discovered assets`))
        } else {
          console.log(chalk.gray('    ℹ No financial assets found (empty or low sentiment)'))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ FINANCIAL ANALYSIS FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    } // Close else block for financial content check
  }

  // Extract reasoning fields if missing (content_type, concept_tags, extraction_confidence)
  // Note: reasoning fields require summary, so they implicitly require content
  if (shouldProcessType('reasoning') &&
      scrap.summary &&
      (!scrap.content_type || !scrap.concept_tags || !scrap.extraction_confidence)) {
    console.log(chalk.dim('    Extracting reasoning fields...'))
    console.log(chalk.gray(`      Summary length: ${(scrap.summary || updates.summary || '').length} chars`))
    try {
      // Create a temporary object to pass to enrichWithReasoningFields
      const tempScrap = {
        ...scrap,
        ...updates, // Include any updates we've made (like summary/tags)
      }

      await enrichWithReasoningFields(tempScrap, { scrapId })

      // Copy the extracted fields to updates
      if (tempScrap.content_type) updates.content_type = tempScrap.content_type
      if (tempScrap.concept_tags) updates.concept_tags = tempScrap.concept_tags
      if (tempScrap.extraction_confidence) updates.extraction_confidence = tempScrap.extraction_confidence

      // Auto-add !news tag for news articles
      if (tempScrap.content_type === 'news' && (updates.tags || scrap.tags)) {
        const currentTags = updates.tags || scrap.tags || []
        if (!currentTags.includes('!news')) {
          updates.tags = ['!news', ...currentTags]
          console.log(chalk.dim(`    ✓ Auto-added !news tag`))
        }
      }

      const conceptCount = (tempScrap.concept_tags || []).length
      console.log(chalk.dim(`    ✓ ${tempScrap.content_type}, ${conceptCount} concepts`))
      if (conceptCount > 0) {
        console.log(chalk.gray(`      Concepts: ${(tempScrap.concept_tags || []).join(', ')}`))
      }
    } catch (error) {
      console.error(chalk.red('    ✗ REASONING EXTRACTION FAILED'))
      console.error(chalk.red(`      Scrap ID: ${scrapId}`))
      console.error(chalk.red(`      URL: ${scrap.url}`))
      console.error(chalk.red(`      Has summary: ${!!(scrap.summary || updates.summary)}`))
      console.error(chalk.red(`      Error: ${error.message}`))
      console.error(chalk.red(`      Stack: ${error.stack}`))
    }
  }

  // Generate screenshot if missing
  if (shouldProcessType('screenshot') && !scrap.screenshot_url) {
    // Special handling for Are.na images
    if (scrap.source === 'arena' && scrap.metadata?.image_data) {
      const imageUrl = scrap.metadata.image_data.original_url ||
                      scrap.metadata.image_data.display ||
                      scrap.metadata.image_data.cloudinary_url
      if (imageUrl) {
        updates.screenshot_url = imageUrl
        const imgShort = imageUrl.split('/').pop()?.substring(0, 20) || 'image'
        console.log(chalk.dim(`    ✓ Arena image: ${imgShort}`))
      }
    }
    // For everything else with a URL, generate screenshot
    else if (scrap.url) {
      console.log(chalk.dim('    Generating screenshot...'))
      console.log(chalk.gray(`      URL: ${scrap.url.substring(0, 80)}`))
      try {
        const screenshot = await browserLimiter.schedule(() =>
          generateScreenshot(scrap.url),
        )

        if (screenshot?.url) {
          updates.screenshot_url = screenshot.url
          const filename = screenshot.url.split('/').pop()?.substring(0, 20) || 'screenshot'
          console.log(chalk.dim(`    ✓ Screenshot: ${filename}`))
        } else {
          console.log(chalk.yellow('    ⚠ Screenshot generation returned no URL'))
          console.log(chalk.yellow(`      Scrap ID: ${scrapId}`))
          console.log(chalk.yellow(`      Response: ${JSON.stringify(screenshot)}`))
        }
      } catch (error) {
        console.error(chalk.red('    ✗ SCREENSHOT GENERATION FAILED'))
        console.error(chalk.red(`      Scrap ID: ${scrapId}`))
        console.error(chalk.red(`      URL: ${scrap.url}`))
        console.error(chalk.red(`      Error: ${error.message}`))
        console.error(chalk.red(`      Stack: ${error.stack}`))
      }
    }
  }

  // Update the scrap if we have any updates
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    console.log(chalk.gray(`    📝 Updating ${Object.keys(updates).length} fields: ${Object.keys(updates).join(', ')}`))

    // Retry database update up to 3 times for network failures
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase
          .from('scraps')
          .update(updates)
          .eq('scrap_id', scrap.scrap_id)

        if (error) {
          console.error(chalk.red('    ✗ DATABASE UPDATE FAILED'))
          console.error(chalk.red(`      Scrap ID: ${scrapId}`))
          console.error(chalk.red(`      Fields: ${Object.keys(updates).join(', ')}`))
          console.error(chalk.red(`      Error: ${JSON.stringify(error)}`))
          throw error
        }
        // Success - break out of retry loop
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < 3) {
          console.log(chalk.yellow(`    ⚠ DB update attempt ${attempt} failed, retrying... (${error.message})`))
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt)) // Exponential backoff
        }
      }
    }

    if (lastError) {
      console.error(chalk.red('    ✗ DATABASE UPDATE EXCEPTION (after 3 retries)'))
      console.error(chalk.red(`      Error: ${lastError.message}`))
      console.error(chalk.red(`      Stack: ${lastError.stack}`))
      throw lastError
    }
  } else {
    console.log(chalk.gray('    ℹ No updates needed'))
  }
}

async function generateTags(content, scrap) {
  const model = getModelForTask('tagging')

  // User's existing tags from ejfox.com/tags.json
  const userTags = ['!inspo','!tobuy','!tohire','3d','3dmodel','aboutme','activism','advice','america','analog','anarchism','api','ar','ar15','arduino','art','audio','automation','beacon','blender','book','callofduty','camping','cannabis','cheatsheet','chess','cli','climatechange','clothes','cms','code','coding','comedy','cooking','covid','crypto','cryptocurrency','css','culture','d3','data','database','datajournalism','dataset','dataviz','demo','design','dj','documentary','drama','ecology','editing','education','election2020','elections','electronics','event','exercise','Fashion','food','funny','game','games','generative','git','github','gpt3','guns','hackers','hacking','hardware','health','howto','html','hudsonvalley','infographic','inspiration','internet','ios','irc','javascript','jiujitsu','journalism','jquery','js','json','lackofdata','legal','linocut','livestream','machinelearning','mapping','maps','markdown','mastodon','media','meditation','military','militias','minecraft','motorcycle','movies','music','nature','network','nft','node','nodejs','ny','nypd','oakland','occupy','occupyoakland','opensource','opinion','osint','osx','pdf','People','personal','photography','photojournalism','pico8','podcast','police','politics','pottery','process','product','programming','project','protest','psychedelics','qgis','quantifiedself','quote','R','raspberrypi','recipe','reference','research','resource','security','sex','shapefile','shortcut','soap','sqlite','startups','study','systemsthinking','tactics','teaching','tech','technique','tool','travel','tributary','tv','twitter','typography','ui','utility','ux','video','videogames','vim','vinyl','visualization','visuals','vj','vr','vue','watercolor','webdesign','woodworking','writing','youtube']

  const prompt = `You are a content tagger. Analyze this content and select appropriate tags.

${scrap.title ? `Title: ${scrap.title}` : ''}
${scrap.url ? `URL: ${scrap.url}` : ''}

Content: ${content.substring(0, 3000)}

EXISTING TAGS TO PREFER (use these when relevant):
${userTags.slice(0, 100).join(', ')}

RULES:
1. Use SINGLE WORDS only (e.g., "javascript" not "javascript-framework")
2. Prefer tags from the existing tags list above when they match the content
3. Use lowercase only
4. Concatenate multi-word concepts into one word (e.g., "machinelearning", "dataviz", "opensource")
5. Generate 5-10 relevant tags

FOCUS ON:
- Technologies mentioned (javascript, python, react, nodejs, arduino)
- Concepts (machinelearning, dataviz, security, privacy)
- Content type (tutorial, documentation, tool, demo, video)
- Domains (art, music, design, journalism, gaming)

NEVER USE:
- Generic tags like "pinboard", "bookmark", "web", "article", "post"
- Hyphenated words
- Multiple word phrases

Return ONLY a comma-separated list of lowercase single-word tags. No explanations.`

  try {
    const response = await completion({
      model,
      prompt,
      max_tokens: 150,
      temperature: 0.5,
      taskType: 'tagging',
      scrapId: scrap.scrap_id,
    })

    // Handle both response formats (object with content property or direct string)
    const content = response?.content || response

    if (content && typeof content === 'string') {
      // Parse the tags from the response
      const rawTags = content
        .toLowerCase()
        .replace(/[\n\r]/g, ' ')  // Remove newlines
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0 && tag.length < 30)  // Max length for single word tags

      // Filter out useless generic tags
      const uselessTags = ['pinboard', 'bookmark', 'link', 'url', 'web', 'website', 'page', 'bookmarks', 'article', 'post']
      const filteredTags = rawTags.filter(tag => !uselessTags.includes(tag))

      // Track the cost
      if (response.usage) {
        trackCost(model, response.usage.prompt_tokens, response.usage.completion_tokens)
      }

      return filteredTags
    }
  } catch (error) {
    console.error('Error generating tags:', error)
  }

  return []
}

// Make it executable
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse()
}

export { repair, repairScrapWithAI, generateTags }
