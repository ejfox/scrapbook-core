import { summarizeContent, metaSummaryToTags } from './aiSummarization.mjs'
import axios from 'axios'
import chalk from 'chalk'

// Test prompts to try
const TEST_PROMPTS = {
  default: 'When analyzing this portion of a webpage, your goal is to distill its content into concise, standalone bullet points...',
  aggressive: 'Create an extremely concise summary. Be ruthless about cutting unnecessary details.',
  technical: 'Focus on technical details, code snippets, and specific implementation details.',
}

async function testSummarization() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║     NEURAL SUMMARIZATION TEST v1.0    ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║    [STATUS: INITIALIZING SYSTEMS]     ║
╚═══════════════════════════════════════╝
`))

  console.log(chalk.blue(`[${new Date().toISOString()}] > Loading test data...`))

  // Use recent endpoint for quick testing
  const response = await axios.get('https://api.pinboard.in/v1/posts/recent', {
    params: {
      auth_token: process.env.PINBOARD_TOKEN,
      format: 'json',
      count: 5, // Just get 5 most recent
    },
  })

  const testSamples = response.data.posts
    .filter(b => b && b.description && b.description.length > 0)
    .map(b => ({
      title: b.description,
      url: b.href,
      content: b.extended || b.description,
    }))

  if (testSamples.length === 0) {
    console.error(chalk.red('No valid test samples found!'))
    return
  }

  console.log(chalk.green(`[SYS] ✓ Loaded ${testSamples.length} test samples`))

  for (const [promptName, prompt] of Object.entries(TEST_PROMPTS)) {
    console.log(chalk.yellow(`
┌─────────────────────────────────────┐
│ PROMPT_ID: ${promptName.padEnd(24)} │
└─────────────────────────────────────┘
`))
    console.log(chalk.gray(`>> ${prompt.substring(0, 50)}...\n`))

    for (const [index, sample] of testSamples.entries()) {
      console.log(chalk.blue(`
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
PROCESSING SAMPLE ${index + 1}/${testSamples.length}
TITLE: ${sample.title || 'Untitled'}
URL: ${sample.url || 'No URL'}
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
`))

      console.log(chalk.gray('[INFO] Generating summary...'))
      const summary = await summarizeContent(sample.content, { prompt })

      console.log(chalk.green('\n>>> SUMMARY OUTPUT >>>'))
      console.log(chalk.white(summary))

      console.log(chalk.gray('\n[INFO] Extracting tags...'))
      const tags = await metaSummaryToTags(summary, {})
      console.log(chalk.cyan(`\n>> TAGS: ${tags}`))

      console.log(chalk.yellow(`
┌─ METRICS ────────────────────────────┐
│ Input length: ${String(sample.content.length).padEnd(8)} chars      │
│ Output length: ${String(summary.length).padEnd(8)} chars      │
│ Compression: ${((summary.length / sample.content.length) * 100).toFixed(1).padEnd(8)}%          │
└────────────────────────────────────────┘
`))
    }
  }

  console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║        TEST SEQUENCE COMPLETE         ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║      [STATUS: SYSTEMS NOMINAL]        ║
╚═══════════════════════════════════════╝
`))
}

testSummarization().catch(error => {
  console.error(chalk.red(`
╔═══════════════════════════════════════╗
║           SYSTEM FAILURE              ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║         ${error.message.slice(0, 35).padEnd(35)} ║
╚═══════════════════════════════════════╝
`))
})
