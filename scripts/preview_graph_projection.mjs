#!/usr/bin/env node

import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import {
  createProjectionRecords,
  DEFAULT_EXTRACTOR_VERSION,
  DEFAULT_FETCH_PAGE_SIZE,
  DEFAULT_ONTOLOGY_VERSION,
  fetchRelationshipScraps,
} from '../lib/graphProjection.mjs'

dotenv.config()

const EXTRACTOR_VERSION = DEFAULT_EXTRACTOR_VERSION
const ONTOLOGY_VERSION = DEFAULT_ONTOLOGY_VERSION
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'data', 'graph-preview', 'latest')

function parseArgs(argv) {
  const options = {
    limit: null,
    scrapId: null,
    outputDir: DEFAULT_OUTPUT_DIR,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--limit' && argv[i + 1]) {
      options.limit = Number.parseInt(argv[i + 1], 10)
      i += 1
    } else if (arg === '--scrap-id' && argv[i + 1]) {
      options.scrapId = argv[i + 1]
      i += 1
    } else if (arg === '--output-dir' && argv[i + 1]) {
      options.outputDir = path.resolve(argv[i + 1])
      i += 1
    }
  }

  return options
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY')
  }

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { auth: { persistSession: false } },
  )
}

async function writeProjection(outputDir, projection) {
  await fs.mkdir(outputDir, { recursive: true })

  const files = [
    ['summary.json', projection.summary],
    ['graph_documents.json', projection.documents],
    ['graph_entities.json', projection.entities],
    ['graph_claims.json', projection.claims],
    ['graph_evidence.json', projection.evidence],
  ]

  await Promise.all(files.map(([filename, payload]) =>
    fs.writeFile(
      path.join(outputDir, filename),
      JSON.stringify(payload, null, 2),
    )))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const scraps = await fetchRelationshipScraps(getSupabase(), {
    limit: options.limit,
    scrapId: options.scrapId,
    pageSize: DEFAULT_FETCH_PAGE_SIZE,
  })
  const projection = createProjectionRecords(scraps, {
    extractorVersion: EXTRACTOR_VERSION,
    ontologyVersion: ONTOLOGY_VERSION,
    projectionSource: 'preview_graph_projection',
  })
  await writeProjection(options.outputDir, projection)

  console.log('Graph projection preview written to:', options.outputDir)
  console.log(JSON.stringify(projection.summary, null, 2))
}

main().catch((error) => {
  console.error('Failed to preview graph projection:', error.message)
  process.exit(1)
})
