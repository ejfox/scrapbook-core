#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { performance } from 'perf_hooks'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════╗
║                COMPREHENSIVE AI QUALITY AUDIT             ║
║           ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━           ║
║  🔍 Analyzing recent AI extractions for completeness      ║
║  📊 Measuring quality metrics across all AI fields        ║
║  🎯 Testing specific content types and edge cases         ║
╚═══════════════════════════════════════════════════════════╝
`))

// Quality thresholds
const QUALITY_THRESHOLDS = {
  summary: {
    minLength: 500,
    requiredElements: ['content overview', 'key points'],
    avoid: ['unknown', 'error', 'failed'],
  },
  tags: {
    minCount: 3,
    avoid: ['pinboard', 'bookmark', 'link'],
    preferSpecific: true,
  },
  relationships: {
    minCount: 1,
    requiredFields: ['source', 'target', 'type'],
  },
  location: {
    avoid: ['unknown', 'n/a', 'none', ''],
    requireSpecific: true,
  },
  financial_analysis: {
    triggers: ['$', 'price', 'cost', 'revenue', 'investment', 'fund'],
    requiredFields: ['amount', 'currency', 'context'],
  },
}

class QualityAnalyzer {
  constructor() {
    this.results = {
      summary: { passed: 0, total: 0, issues: [] },
      tags: { passed: 0, total: 0, issues: [] },
      relationships: { passed: 0, total: 0, issues: [] },
      location: { passed: 0, total: 0, issues: [] },
      financial_analysis: { passed: 0, total: 0, issues: [] },
      overall: { passed: 0, total: 0 },
    }
    this.scrapExamples = {
      excellent: [],
      good: [],
      needs_improvement: [],
      failed: [],
    }
  }

  analyzeSummary(summary, content, scrapId) {
    this.results.summary.total++

    if (!summary || summary.length < QUALITY_THRESHOLDS.summary.minLength) {
      this.results.summary.issues.push({
        scrapId,
        issue: `Summary too short: ${summary?.length || 0} chars (min: ${QUALITY_THRESHOLDS.summary.minLength})`,
        severity: 'high',
      })
      return 0
    }

    let score = 100

    // Check for prohibited terms
    for (const term of QUALITY_THRESHOLDS.summary.avoid) {
      if (summary.toLowerCase().includes(term)) {
        score -= 30
        this.results.summary.issues.push({
          scrapId,
          issue: `Contains prohibited term: "${term}"`,
          severity: 'high',
        })
      }
    }

    // Check for structure (bullets, paragraphs)
    const hasBullets = summary.includes('•') || summary.includes('- ')
    const hasMultipleParagraphs = summary.split('\n\n').length > 1

    if (!hasBullets && !hasMultipleParagraphs) {
      score -= 20
      this.results.summary.issues.push({
        scrapId,
        issue: 'Summary lacks structure (no bullets or multiple paragraphs)',
        severity: 'medium',
      })
    }

    // Check content relevance
    if (content) {
      const summaryWords = summary.toLowerCase().split(/\s+/)
      const contentWords = content.toLowerCase().split(/\s+/).slice(0, 100) // First 100 words
      const overlap = summaryWords.filter(word =>
        word.length > 3 && contentWords.includes(word),
      ).length

      if (overlap < 5) {
        score -= 25
        this.results.summary.issues.push({
          scrapId,
          issue: 'Summary may not be relevant to content',
          severity: 'medium',
        })
      }
    }

    if (score >= 70) this.results.summary.passed++
    return score
  }

  analyzeTags(tags, content, scrapId) {
    this.results.tags.total++

    if (!Array.isArray(tags) || tags.length < QUALITY_THRESHOLDS.tags.minCount) {
      this.results.tags.issues.push({
        scrapId,
        issue: `Insufficient tags: ${tags?.length || 0} (min: ${QUALITY_THRESHOLDS.tags.minCount})`,
        severity: 'high',
      })
      return 0
    }

    let score = 100

    // Check for generic/prohibited tags
    const genericCount = tags.filter(tag =>
      QUALITY_THRESHOLDS.tags.avoid.includes(tag.toLowerCase()),
    ).length

    if (genericCount > 0) {
      score -= genericCount * 15
      this.results.tags.issues.push({
        scrapId,
        issue: `Contains ${genericCount} generic tags: ${tags.filter(tag =>
          QUALITY_THRESHOLDS.tags.avoid.includes(tag.toLowerCase()),
        ).join(', ')}`,
        severity: 'medium',
      })
    }

    // Check for specificity
    const specificTags = tags.filter(tag =>
      tag.length > 3 && !QUALITY_THRESHOLDS.tags.avoid.includes(tag.toLowerCase()),
    )

    if (specificTags.length < 2) {
      score -= 20
      this.results.tags.issues.push({
        scrapId,
        issue: 'Lacks specific, descriptive tags',
        severity: 'medium',
      })
    }

    if (score >= 70) this.results.tags.passed++
    return score
  }

  analyzeRelationships(relationships, content, scrapId) {
    this.results.relationships.total++

    if (!Array.isArray(relationships) || relationships.length === 0) {
      this.results.relationships.issues.push({
        scrapId,
        issue: 'No relationships extracted',
        severity: 'medium',
      })
      return 50 // Not always applicable, so medium score
    }

    let score = 100

    // Check relationship structure
    for (const rel of relationships) {
      if (!rel.source?.type || !rel.source?.name || !rel.target?.type || !rel.target?.name || !rel.type) {
        score -= 30
        this.results.relationships.issues.push({
          scrapId,
          issue: 'Malformed relationship structure',
          severity: 'high',
        })
      }
    }

    // Check for meaningful relationships
    const meaningfulRels = relationships.filter(rel =>
      rel.source?.name?.length > 2 && rel.target?.name?.length > 2,
    )

    if (meaningfulRels.length === 0) {
      score -= 40
      this.results.relationships.issues.push({
        scrapId,
        issue: 'No meaningful relationships found',
        severity: 'medium',
      })
    }

    if (score >= 70) this.results.relationships.passed++
    return score
  }

  analyzeLocation(location, latitude, longitude, content, scrapId) {
    this.results.location.total++

    // Check if content likely contains location info
    const locationKeywords = ['in ', 'at ', 'from ', 'located', 'city', 'country', 'street', 'avenue']
    const hasLocationContext = content && locationKeywords.some(keyword =>
      content.toLowerCase().includes(keyword),
    )

    if (!location || QUALITY_THRESHOLDS.location.avoid.includes(location.toLowerCase())) {
      if (hasLocationContext) {
        this.results.location.issues.push({
          scrapId,
          issue: 'Failed to extract location despite location context in content',
          severity: 'high',
        })
        return 0
      } else {
        // No location context, so acceptable to have no location
        this.results.location.passed++
        return 100
      }
    }

    let score = 100

    // Check for coordinates
    if (!latitude || !longitude) {
      score -= 20
      this.results.location.issues.push({
        scrapId,
        issue: 'Location name provided but missing coordinates',
        severity: 'low',
      })
    }

    // Check for specificity
    if (location.length < 3) {
      score -= 30
      this.results.location.issues.push({
        scrapId,
        issue: 'Location too generic or short',
        severity: 'medium',
      })
    }

    if (score >= 70) this.results.location.passed++
    return score
  }

  analyzeFinancialAnalysis(financial_analysis, content, scrapId) {
    this.results.financial_analysis.total++

    // Check if content contains financial triggers
    const hasFinancialContent = content && QUALITY_THRESHOLDS.financial_analysis.triggers.some(trigger =>
      content.toLowerCase().includes(trigger),
    )

    if (!financial_analysis) {
      if (hasFinancialContent) {
        this.results.financial_analysis.issues.push({
          scrapId,
          issue: 'Financial content detected but no analysis provided',
          severity: 'medium',
        })
        return 30
      } else {
        // No financial content, so acceptable
        this.results.financial_analysis.passed++
        return 100
      }
    }

    let score = 100

    // Validate financial analysis structure
    if (typeof financial_analysis !== 'object') {
      score -= 50
      this.results.financial_analysis.issues.push({
        scrapId,
        issue: 'Financial analysis not properly structured',
        severity: 'high',
      })
    }

    if (score >= 70) this.results.financial_analysis.passed++
    return score
  }

  categorizeScrap(scores, scrap) {
    const avgScore = Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.values(scores).length

    const example = {
      id: scrap.id,
      title: scrap.title?.substring(0, 60) + '...',
      url: scrap.url,
      source: scrap.source,
      avgScore: Math.round(avgScore),
      scores,
    }

    if (avgScore >= 90) {
      this.scrapExamples.excellent.push(example)
    } else if (avgScore >= 75) {
      this.scrapExamples.good.push(example)
    } else if (avgScore >= 50) {
      this.scrapExamples.needs_improvement.push(example)
    } else {
      this.scrapExamples.failed.push(example)
    }
  }

  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalScraps: this.results.summary.total,
        overallSuccessRate: this.calculateOverallSuccessRate(),
        fieldSuccessRates: this.calculateFieldSuccessRates(),
      },
      detailed: this.results,
      examples: this.scrapExamples,
      recommendations: this.generateRecommendations(),
    }

    return report
  }

  calculateOverallSuccessRate() {
    const totalChecks = Object.values(this.results).reduce((sum, field) =>
      sum + (field.total || 0), 0,
    )
    const totalPassed = Object.values(this.results).reduce((sum, field) =>
      sum + (field.passed || 0), 0,
    )

    return totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 100) : 0
  }

  calculateFieldSuccessRates() {
    const rates = {}
    Object.entries(this.results).forEach(([field, data]) => {
      if (data.total > 0) {
        rates[field] = Math.round((data.passed / data.total) * 100)
      }
    })
    return rates
  }

  generateRecommendations() {
    const recommendations = []

    // Analyze patterns in issues
    const allIssues = Object.values(this.results).flatMap(field => field.issues || [])
    const highSeverityCount = allIssues.filter(issue => issue && issue.severity === 'high').length

    if (highSeverityCount > 5) {
      recommendations.push({
        priority: 'high',
        issue: 'High number of critical AI extraction failures',
        action: 'Review and retrain AI models, check prompt engineering',
      })
    }

    // Field-specific recommendations
    Object.entries(this.results).forEach(([field, data]) => {
      const successRate = data.total > 0 ? (data.passed / data.total) * 100 : 100

      if (successRate < 70) {
        recommendations.push({
          priority: successRate < 50 ? 'high' : 'medium',
          issue: `${field} extraction success rate below threshold (${Math.round(successRate)}%)`,
          action: `Focus on improving ${field} extraction logic and validation`,
        })
      }
    })

    return recommendations
  }
}

async function fetchRecentScraps(limit = 10) {
  console.log(chalk.blue(`🔍 Fetching ${limit} most recent scraps with AI fields...`))

  const { data, error } = await supabase
    .from('scraps')
    .select(`
      id, title, url, content, source, type,
      summary, tags, relationships, location, latitude, longitude,
      metadata, created_at, updated_at, published_at
    `)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Database query failed: ${error.message}`)
  }

  console.log(chalk.green(`✅ Retrieved ${data.length} scraps for analysis`))
  return data
}

async function testSpecificCases() {
  console.log(chalk.blue('\n🎯 Testing specific content types...'))

  const results = {}

  // Test news articles
  try {
    const { data: newsData, error: newsError } = await supabase
      .from('scraps')
      .select('id, title, url, content, summary, tags, location, relationships')
      .or('content.ilike.%news%,content.ilike.%report%,url.ilike.%news%,url.ilike.%reuters%,url.ilike.%bbc%')
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3)

    results.news = newsData || []
    console.log(chalk.green(`✅ Found ${results.news.length} news examples`))
  } catch (err) {
    console.log(chalk.yellow(`⚠️  Could not test news cases: ${err.message}`))
    results.news = []
  }

  // Test technical content
  try {
    const { data: techData, error: techError } = await supabase
      .from('scraps')
      .select('id, title, url, content, summary, tags, relationships')
      .or('content.ilike.%code%,content.ilike.%programming%,content.ilike.%software%,url.ilike.%github%')
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3)

    results.technical = techData || []
    console.log(chalk.green(`✅ Found ${results.technical.length} technical examples`))
  } catch (err) {
    console.log(chalk.yellow(`⚠️  Could not test technical cases: ${err.message}`))
    results.technical = []
  }

  // Test financial content
  try {
    const { data: financeData, error: financeError } = await supabase
      .from('scraps')
      .select('id, title, url, content, summary, tags, metadata')
      .or('content.ilike.%$%,content.ilike.%price%,content.ilike.%investment%,content.ilike.%revenue%')
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3)

    results.finance = financeData || []
    console.log(chalk.green(`✅ Found ${results.finance.length} finance examples`))
  } catch (err) {
    console.log(chalk.yellow(`⚠️  Could not test finance cases: ${err.message}`))
    results.finance = []
  }

  return results
}

function displayQualityReport(report) {
  console.log(chalk.cyan('\n' + '='.repeat(80)))
  console.log(chalk.cyan('                           QUALITY AUDIT REPORT'))
  console.log(chalk.cyan('='.repeat(80)))

  // Overall Summary
  console.log(chalk.white('\n📊 OVERALL SUMMARY'))
  console.log(chalk.white('━'.repeat(50)))
  console.log(`Total Scraps Analyzed: ${chalk.yellow(report.summary.totalScraps)}`)
  console.log(`Overall Success Rate: ${
    report.summary.overallSuccessRate >= 80
      ? chalk.green(report.summary.overallSuccessRate + '%')
      : report.summary.overallSuccessRate >= 60
        ? chalk.yellow(report.summary.overallSuccessRate + '%')
        : chalk.red(report.summary.overallSuccessRate + '%')
  }`)

  // Field Success Rates
  console.log(chalk.white('\n📈 FIELD SUCCESS RATES'))
  console.log(chalk.white('━'.repeat(50)))
  Object.entries(report.summary.fieldSuccessRates).forEach(([field, rate]) => {
    const color = rate >= 80 ? chalk.green : rate >= 60 ? chalk.yellow : chalk.red
    const total = report.detailed[field]?.total || 0
    console.log(`${field.padEnd(20)}: ${color(rate + '%')} (${total} tested)`)
  })

  // Critical Issues
  const criticalIssues = Object.values(report.detailed).flatMap(field =>
    field.issues?.filter(issue => issue.severity === 'high') || [],
  )

  if (criticalIssues.length > 0) {
    console.log(chalk.red('\n🚨 CRITICAL ISSUES'))
    console.log(chalk.red('━'.repeat(50)))
    criticalIssues.slice(0, 5).forEach(issue => {
      console.log(chalk.red(`• ${issue.issue} (Scrap: ${issue.scrapId})`))
    })
    if (criticalIssues.length > 5) {
      console.log(chalk.red(`... and ${criticalIssues.length - 5} more critical issues`))
    }
  }

  // Examples
  console.log(chalk.white('\n🎯 PERFORMANCE EXAMPLES'))
  console.log(chalk.white('━'.repeat(50)))

  if (report.examples.excellent.length > 0) {
    console.log(chalk.green('\n✨ EXCELLENT (90%+ quality):'))
    report.examples.excellent.slice(0, 2).forEach(example => {
      console.log(chalk.green(`  • ${example.title} (${example.avgScore}%)`))
      console.log(chalk.gray(`    ${example.url?.substring(0, 60)}...`))
    })
  }

  if (report.examples.failed.length > 0) {
    console.log(chalk.red('\n❌ NEEDS ATTENTION (<50% quality):'))
    report.examples.failed.slice(0, 2).forEach(example => {
      console.log(chalk.red(`  • ${example.title} (${example.avgScore}%)`))
      console.log(chalk.gray(`    ${example.url?.substring(0, 60)}...`))
    })
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log(chalk.white('\n💡 RECOMMENDATIONS'))
    console.log(chalk.white('━'.repeat(50)))
    report.recommendations.forEach(rec => {
      const priorityColor = rec.priority === 'high' ? chalk.red : chalk.yellow
      console.log(`${priorityColor('[' + rec.priority.toUpperCase() + ']')} ${rec.issue}`)
      console.log(chalk.gray(`  → ${rec.action}`))
    })
  }

  console.log(chalk.cyan('\n' + '='.repeat(80)))
}

async function main() {
  const startTime = performance.now()

  try {
    // Initialize analyzer
    const analyzer = new QualityAnalyzer()

    // Fetch recent scraps
    const scraps = await fetchRecentScraps(10)

    console.log(chalk.blue('\n🔬 Analyzing AI extraction quality...'))

    // Analyze each scrap
    for (const scrap of scraps) {
      console.log(chalk.gray(`\nAnalyzing: ${scrap.title?.substring(0, 50)}...`))

      // Extract financial analysis from metadata if available
      const financial_analysis = scrap.metadata?.financial_analysis || null

      const scores = {
        summary: analyzer.analyzeSummary(scrap.summary, scrap.content, scrap.id),
        tags: analyzer.analyzeTags(scrap.tags, scrap.content, scrap.id),
        relationships: analyzer.analyzeRelationships(scrap.relationships, scrap.content, scrap.id),
        location: analyzer.analyzeLocation(scrap.location, scrap.latitude, scrap.longitude, scrap.content, scrap.id),
        financial_analysis: analyzer.analyzeFinancialAnalysis(financial_analysis, scrap.content, scrap.id),
      }

      analyzer.categorizeScrap(scores, scrap)
    }

    // Test specific cases
    const specificCases = await testSpecificCases()

    // Generate and display report
    const report = analyzer.generateReport()
    report.specificCases = specificCases

    displayQualityReport(report)

    // Save detailed report
    const reportPath = `/tmp/quality_audit_${Date.now()}.json`
    await import('fs/promises').then(fs =>
      fs.writeFile(reportPath, JSON.stringify(report, null, 2)),
    )

    const duration = performance.now() - startTime
    console.log(chalk.blue(`\n⏱️  Audit completed in ${duration.toFixed(2)}ms`))
    console.log(chalk.blue(`📄 Detailed report saved to: ${reportPath}`))

    // Exit with appropriate code
    const overallSuccess = report.summary.overallSuccessRate >= 80
    process.exit(overallSuccess ? 0 : 1)

  } catch (error) {
    console.error(chalk.red('\n❌ Audit failed:'), error.message)
    if (error.stack) {
      console.error(chalk.gray(error.stack))
    }
    process.exit(1)
  }
}

// Self-executing
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { QualityAnalyzer, fetchRecentScraps, testSpecificCases }
