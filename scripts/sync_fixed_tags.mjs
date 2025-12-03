#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import chalk from 'chalk'
import axios from 'axios'
import Bottleneck from 'bottleneck'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const PINBOARD_API_TOKEN = process.env.PINBOARD_TOKEN

const pinboardLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 5000, // 5 seconds
})

const fixedIds = [
  'c2891727-9e54-4e05-934e-2d5b8ff28302',
  '7528a5d4-54e4-4190-8206-bef2d4f01b8f',
  'eaf558aa-5649-4788-b612-61393cda2f2f',
  'b1064a95-3e07-4cbc-a92a-49e6c2e9ce5d',
  'd3ee9e83-72dd-4ab4-ab8e-12c28bd78baf',
  '462e892b-68fd-4c2a-8e86-4d283b9e397f',
  'e92e3951-c1b3-49ac-91b8-6a745ad4d1b7'
]

async function syncFixed() {
  console.log(chalk.cyan('🔄 Syncing 7 fixed bookmarks to Pinboard\n'))

  const { data: scraps } = await supabase
    .from('scraps')
    .select('url, title, tags')
    .in('id', fixedIds)

  for (const [i, scrap] of scraps.entries()) {
    console.log(chalk.gray(`[${i+1}/7] ${scrap.title?.substring(0, 60) || scrap.url.substring(0, 60)}...`))
    console.log(chalk.green(`  New tags: ${scrap.tags.join(', ')}`))

    await pinboardLimiter.schedule(async () => {
      const response = await axios.get('https://api.pinboard.in/v1/posts/add', {
        params: {
          auth_token: PINBOARD_API_TOKEN,
          url: scrap.url,
          description: scrap.title || scrap.url,
          tags: scrap.tags.join(' '),
          replace: 'yes',
          format: 'json',
        },
      })

      if (response.data?.result_code === 'done') {
        console.log(chalk.green('  ✅ Synced\n'))
      } else {
        console.log(chalk.red(`  ❌ Failed: ${JSON.stringify(response.data)}\n`))
      }
    })
  }

  console.log(chalk.cyan('\n✨ Done! All 7 bookmarks synced with fixed tags'))
}

syncFixed()
