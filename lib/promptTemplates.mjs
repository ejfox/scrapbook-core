/**
 * Prompt Templates for Thread-Aware Summarization
 *
 * Builds AI prompts that naturally incorporate thread context,
 * letting the AI decide if connections are meaningful.
 *
 * Philosophy: Context is informational, not prescriptive.
 * The AI judges relevance - we just provide the ingredients.
 */

/**
 * Build a thread-aware summarization prompt
 *
 * @param {string} content - The content to summarize
 * @param {Object|null} threadContext - Related scraps context from threadContext.mjs
 * @param {Object} options - Additional options
 * @returns {string} The formatted prompt
 */
export function buildThreadAwarePrompt(content, threadContext, _options = {}) {
  const baseInstructions = `You are summarizing content for a digital memory system. Create a rich, detailed summary that captures everything interesting and useful.

Instructions:
• Generate as many bullet points as the content warrants (typically 5-15)
• Each point must start with "• "
• Be comprehensive - capture ALL interesting facts, insights, quotes, numbers, dates, names
• For articles: main thesis, supporting arguments, evidence, counterpoints, conclusions, author insights
• For code/docs: purpose, key features, how it works, API details, examples, limitations
• For products: all features, pricing tiers, technical specs, use cases, comparisons
• For social media: the actual content of posts, discussions, key points made

Write in a natural, informative style. Be specific and detailed. Include context that helps understand why this was saved.`

  // If no thread context, return basic prompt
  if (!threadContext || !threadContext.relatedScraps || threadContext.relatedScraps.length === 0) {
    return `${baseInstructions}

Content to summarize:
${content}`
  }

  // Build thread-aware context section
  const contextSection = buildContextSection(threadContext)

  return `${baseInstructions}

${contextSection}

---

NEW CONTENT TO SUMMARIZE:
${content}

---

THREAD-AWARE SUMMARIZATION INSTRUCTIONS:
1. First, thoroughly summarize the new content above
2. If you notice natural connections to the recently saved items:
   - Weave them into your narrative conversationally
   - Example: "This builds on the transformer architecture explored in 'Attention Is All You Need' (2 weeks ago)..."
   - Example: "While previous items focused on theory, this provides practical implementation..."
   - Example: "Offers a contrasting perspective to the approach discussed yesterday..."
3. If connections feel forced or tenuous, ignore them - focus on the content itself
4. Note what's genuinely novel or different from recent exploration
5. Don't create a separate "Related items" section - blend connections naturally into the summary

Write as if explaining to your future self how this piece fits into your ongoing exploration of these topics.`
}

/**
 * Build the context section describing related scraps
 */
function buildContextSection(threadContext) {
  const { relatedScraps, dominantThemes, connectionStrength, temporalWindow } = threadContext

  // Describe the exploration pattern
  const themeText = dominantThemes && dominantThemes.length > 0
    ? `You've been exploring themes around: ${dominantThemes.map(t => `"${t}"`).join(', ')}`
    : 'You\'ve been saving related content'

  // Format related items concisely
  const relatedItems = relatedScraps.map(scrap => {
    let item = `• "${scrap.title}" (${scrap.when})`

    if (scrap.snippet) {
      item += ` - ${scrap.snippet}`
    }

    if (scrap.sharedTags && scrap.sharedTags.length > 0) {
      item += ` [${scrap.sharedTags.join(', ')}]`
    }

    return item
  }).join('\n')

  // Add connection strength hint
  const strengthHint = getStrengthHint(connectionStrength)

  return `RECENT CONTEXT (past ${temporalWindow}):
${themeText}

Recently saved:
${relatedItems}

Connection strength: ${connectionStrength} ${strengthHint}`
}

/**
 * Get a hint about how to handle connections based on strength
 */
function getStrengthHint(strength) {
  switch (strength) {
  case 'strong':
    return '- These items are highly related. Connections will likely be meaningful.'
  case 'medium':
    return '- These items share some themes. Look for substantive connections.'
  case 'weak':
    return '- These items share a few themes. Only mention if connections are meaningful.'
  case 'minimal':
    return '- These items are loosely related. Connections may not be relevant.'
  default:
    return ''
  }
}

/**
 * Build system message for thread-aware summarization
 */
export function buildThreadAwareSystemMessage() {
  return {
    role: 'system',
    content: `You are an expert content analyst helping someone build their digital memory.

Your summaries help them remember:
- Why they saved something
- What was interesting about it
- How it connects to their ongoing explorations
- All the key information they might want to recall later

You're not just a summarizer - you're a knowledgeable librarian who remembers what they've been reading and can spot meaningful patterns in their intellectual journey.

Be thorough, insightful, and capture the essence of why this content matters in the context of their evolving knowledge base.`,
  }
}

/**
 * Build user message with thread context
 */
export function buildThreadAwareUserMessage(content, threadContext, options = {}) {
  return {
    role: 'user',
    content: buildThreadAwarePrompt(content, threadContext, options),
  }
}

/**
 * Create a complete messages array for thread-aware summarization
 * Compatible with OpenAI/Anthropic chat completion format
 */
export function buildThreadAwareMessages(content, threadContext, options = {}) {
  return [
    buildThreadAwareSystemMessage(),
    buildThreadAwareUserMessage(content, threadContext, options),
  ]
}

/**
 * For backwards compatibility: build prompt string (deprecated)
 */
export function buildPrompt(content, threadContext, options = {}) {
  console.warn('buildPrompt() is deprecated. Use buildThreadAwarePrompt() instead.')
  return buildThreadAwarePrompt(content, threadContext, options)
}

/**
 * Preview what the context section looks like
 * Useful for debugging and tuning
 */
export function previewContext(threadContext) {
  if (!threadContext) {
    return 'No thread context available'
  }

  return buildContextSection(threadContext)
}

export default {
  buildThreadAwarePrompt,
  buildThreadAwareSystemMessage,
  buildThreadAwareUserMessage,
  buildThreadAwareMessages,
  buildPrompt, // deprecated
  previewContext,
}
