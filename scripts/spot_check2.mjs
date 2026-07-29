#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

// 1. Preamble leak count across whole DB
const { count: total } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
const { count: preamble } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .ilike('summary', '%based on the provided screenshot%')
const { count: preamble2 } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .ilike('summary', "Here's a detailed summary%")
const { count: noContent } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .ilike('title', '%No content available%')
const { count: nullUrl } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .is('url', null)
const { count: lockRows } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .or('scrap_id.eq.__run_lock__,scrap_id.like.%lock%')
const { count: hasShot } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .not('screenshot_url', 'is', null)
const { count: bogusFin } = await supabase.from('scraps').select('*', { count: 'exact', head: true })
  .ilike('financial_analysis', '%AAPL%')

console.log(`Total scraps:                         ${total}`)
console.log(`  null url:                           ${nullUrl}  (${(nullUrl/total*100).toFixed(1)}%)`)
console.log(`  "No content available" title:       ${noContent}  (${(noContent/total*100).toFixed(1)}%)`)
console.log(`  lock/internal rows leaking:         ${lockRows}`)
console.log(`  has screenshot_url:                 ${hasShot}  (${(hasShot/total*100).toFixed(1)}%)`)
console.log(`  summary w/ "provided screenshot":   ${preamble}  (${(preamble/total*100).toFixed(1)}%)`)
console.log(`  summary w/ "Here's a detailed...":  ${preamble2}  (${(preamble2/total*100).toFixed(1)}%)`)
console.log(`  financial_analysis containing AAPL: ${bogusFin}  (${(bogusFin/total*100).toFixed(1)}%)`)

// 2. Validate a sample of screenshot URLs actually resolve
const { data: shots } = await supabase.from('scraps').select('id, screenshot_url')
  .not('screenshot_url', 'is', null).order('created_at', { ascending: false }).limit(20)

console.log(`\n--- Screenshot URL liveness (sample of 20 recent) ---`)
let ok = 0, bad = 0
await Promise.all(shots.map(async s => {
  try {
    const r = await fetch(s.screenshot_url, { method: 'HEAD' })
    if (r.ok) ok++; else { bad++; console.log(`  ${r.status}  ${s.screenshot_url}`) }
  } catch (e) { bad++; console.log(`  ERR  ${s.screenshot_url}  ${e.message}`) }
}))
console.log(`  live: ${ok}/20   broken: ${bad}/20`)
