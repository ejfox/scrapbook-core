#!/usr/bin/env node

import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const PAGE_SIZE = 1000
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'entity-graph', 'latest')

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { persistSession: false } },
)

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeType(value) {
  const type = normalizeText(value)
  return type || 'Entity'
}

function nodeKey(name, type) {
  return `${normalizeType(type)}::${name.toLowerCase()}`
}

function normalizeRelationship(raw) {
  if (!raw || typeof raw !== 'object') return null

  // Newer format
  if (raw.source?.name && raw.target?.name && raw.type) {
    return {
      sourceName: normalizeText(raw.source.name),
      sourceType: normalizeType(raw.source.type),
      targetName: normalizeText(raw.target.name),
      targetType: normalizeType(raw.target.type),
      relationshipType: normalizeText(raw.type),
    }
  }

  // Older flat format
  if (raw.source && raw.target && raw.relationship) {
    return {
      sourceName: normalizeText(raw.source),
      sourceType: normalizeType(raw.sourceType),
      targetName: normalizeText(raw.target),
      targetType: normalizeType(raw.targetType),
      relationshipType: normalizeText(raw.relationship),
    }
  }

  return null
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? '' : String(value)
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }

  const header = columns.join(',')
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(','))
  return [header, ...body].join('\n')
}

async function fetchRelationshipScraps() {
  const scraps = []
  let from = 0

  while (true) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('scraps')
      .select('id, scrap_id, title, url, source, published_at, updated_at, relationships')
      .not('relationships', 'is', null)
      .range(from, to)
      .order('updated_at', { ascending: false })

    if (error) {
      throw error
    }

    if (!data || data.length === 0) break

    scraps.push(...data)
    console.log(`Fetched ${scraps.length} scraps with relationships...`)

    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return scraps
}

async function exportEntityGraph() {
  const startedAt = new Date().toISOString()
  const scraps = await fetchRelationshipScraps()

  const nodes = new Map()
  const edges = new Map()
  let discardedRelationships = 0
  let totalRelationships = 0

  for (const scrap of scraps) {
    const relationships = Array.isArray(scrap.relationships) ? scrap.relationships : []

    for (const raw of relationships) {
      totalRelationships++
      const normalized = normalizeRelationship(raw)

      if (!normalized) {
        discardedRelationships++
        continue
      }

      const {
        sourceName,
        sourceType,
        targetName,
        targetType,
        relationshipType,
      } = normalized

      if (!sourceName || !targetName || !relationshipType) {
        discardedRelationships++
        continue
      }

      const sourceKey = nodeKey(sourceName, sourceType)
      const targetKey = nodeKey(targetName, targetType)

      if (!nodes.has(sourceKey)) {
        nodes.set(sourceKey, {
          id: sourceKey,
          name: sourceName,
          type: sourceType,
          degree: 0,
          outDegree: 0,
          inDegree: 0,
          scrapCount: 0,
          scrapIds: new Set(),
          sources: new Set(),
        })
      }

      if (!nodes.has(targetKey)) {
        nodes.set(targetKey, {
          id: targetKey,
          name: targetName,
          type: targetType,
          degree: 0,
          outDegree: 0,
          inDegree: 0,
          scrapCount: 0,
          scrapIds: new Set(),
          sources: new Set(),
        })
      }

      const sourceNode = nodes.get(sourceKey)
      const targetNode = nodes.get(targetKey)

      sourceNode.outDegree++
      sourceNode.degree++
      sourceNode.scrapIds.add(scrap.scrap_id || scrap.id)
      sourceNode.sources.add(scrap.source || 'unknown')

      targetNode.inDegree++
      targetNode.degree++
      targetNode.scrapIds.add(scrap.scrap_id || scrap.id)
      targetNode.sources.add(scrap.source || 'unknown')

      const edgeKey = `${sourceKey}::${relationshipType}::${targetKey}`
      if (!edges.has(edgeKey)) {
        edges.set(edgeKey, {
          id: edgeKey,
          source: sourceKey,
          target: targetKey,
          relationshipType,
          weight: 0,
          scrapIds: new Set(),
          examples: [],
        })
      }

      const edge = edges.get(edgeKey)
      edge.weight++
      edge.scrapIds.add(scrap.scrap_id || scrap.id)
      if (edge.examples.length < 5) {
        edge.examples.push({
          scrapId: scrap.scrap_id || scrap.id,
          title: scrap.title || null,
          url: scrap.url || null,
          source: scrap.source || null,
          publishedAt: scrap.published_at || null,
          updatedAt: scrap.updated_at || null,
        })
      }
    }
  }

  const nodeRows = [...nodes.values()]
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      degree: node.degree,
      outDegree: node.outDegree,
      inDegree: node.inDegree,
      scrapCount: node.scrapIds.size,
      sources: [...node.sources].sort(),
    }))
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))

  const edgeRows = [...edges.values()]
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relationshipType: edge.relationshipType,
      weight: edge.weight,
      scrapCount: edge.scrapIds.size,
      examples: edge.examples,
    }))
    .sort((a, b) => b.weight - a.weight || a.relationshipType.localeCompare(b.relationshipType))

  const graph = {
    exportedAt: startedAt,
    stats: {
      scrapsWithRelationships: scraps.length,
      rawRelationships: totalRelationships,
      discardedRelationships,
      nodeCount: nodeRows.length,
      edgeCount: edgeRows.length,
    },
    nodes: nodeRows,
    edges: edgeRows,
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.writeFile(path.join(OUTPUT_DIR, 'graph.json'), JSON.stringify(graph, null, 2))
  await fs.writeFile(path.join(OUTPUT_DIR, 'nodes.json'), JSON.stringify(nodeRows, null, 2))
  await fs.writeFile(path.join(OUTPUT_DIR, 'edges.json'), JSON.stringify(edgeRows, null, 2))
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'nodes.csv'),
    toCsv(
      nodeRows.map((node) => ({
        ...node,
        sources: node.sources.join('|'),
      })),
      ['id', 'name', 'type', 'degree', 'outDegree', 'inDegree', 'scrapCount', 'sources'],
    ),
  )
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'edges.csv'),
    toCsv(
      edgeRows.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relationshipType: edge.relationshipType,
        weight: edge.weight,
        scrapCount: edge.scrapCount,
      })),
      ['id', 'source', 'target', 'relationshipType', 'weight', 'scrapCount'],
    ),
  )

  console.log(`\nExport complete:`)
  console.log(`  scraps with relationships: ${scraps.length}`)
  console.log(`  nodes: ${nodeRows.length}`)
  console.log(`  edges: ${edgeRows.length}`)
  console.log(`  discarded relationships: ${discardedRelationships}`)
  console.log(`  output: ${OUTPUT_DIR}`)
}

exportEntityGraph().catch((error) => {
  console.error('Failed to export entity graph:', error.message)
  process.exit(1)
})
