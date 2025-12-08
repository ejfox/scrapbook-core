#!/usr/bin/env node
/**
 * Cost Analysis Tool
 * Detailed breakdown of AI spending across models, tasks, and time periods
 */

import fs from 'fs'
import path from 'path'
import chalk from 'chalk'

const costFile = path.join(process.cwd(), 'data', 'cost-history.json')

if (!fs.existsSync(costFile)) {
  console.error(chalk.red('❌ No cost history file found'))
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(costFile, 'utf8'))

// Parse command line args
const args = process.argv.slice(2)
const command = args[0] || 'summary'
const period = args[1] || '7' // days

function formatCost(cost) {
  return chalk.green(`$${cost.toFixed(4)}`)
}

function formatTokens(tokens) {
  return chalk.blue(tokens.toLocaleString())
}

function printSummary() {
  console.log(chalk.cyan('\n💰 COST SUMMARY'))
  console.log(chalk.cyan('='.repeat(60)))

  console.log(chalk.yellow('\n📊 Lifetime Totals:'))
  console.log(`Total Cost:     ${formatCost(data.totalLifetimeCost)}`)
  console.log(`Total Tokens:   ${formatTokens(data.totalLifetimeTokens)}`)
  console.log(`Total Requests: ${chalk.blue(data.totalLifetimeRequests.toLocaleString())}`)
  console.log(`Avg Cost/Request: ${formatCost(data.totalLifetimeCost / data.totalLifetimeRequests)}`)
  console.log(`Avg Tokens/Request: ${chalk.blue(Math.round(data.totalLifetimeTokens / data.totalLifetimeRequests))}`)
}

function printDaily(days = 7) {
  console.log(chalk.cyan(`\n📅 Last ${days} Days`))
  console.log(chalk.cyan('='.repeat(60)))

  const dailyEntries = Object.entries(data.dailyStats)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, parseInt(days))

  console.log(chalk.gray('Date       | Cost      | Tokens     | Requests | Scraps | $/Scrap'))
  console.log(chalk.gray('-'.repeat(75)))

  let totalCost = 0
  let totalTokens = 0
  let totalRequests = 0
  let totalScraps = 0

  dailyEntries.forEach(([date, stats]) => {
    const costPerScrap = stats.scrapCount > 0 ? stats.cost / stats.scrapCount : 0
    console.log(
      `${date} | ${stats.cost.toFixed(4).padStart(9)} | ${stats.tokens.toString().padStart(10)} | ${stats.requests.toString().padStart(8)} | ${stats.scrapCount.toString().padStart(6)} | ${costPerScrap.toFixed(4)}`
    )
    totalCost += stats.cost
    totalTokens += stats.tokens
    totalRequests += stats.requests
    totalScraps += stats.scrapCount
  })

  console.log(chalk.gray('-'.repeat(75)))
  console.log(chalk.yellow(
    `TOTAL      | ${totalCost.toFixed(4).padStart(9)} | ${totalTokens.toString().padStart(10)} | ${totalRequests.toString().padStart(8)} | ${totalScraps.toString().padStart(6)} | ${(totalCost / totalScraps).toFixed(4)}`
  ))

  console.log(chalk.cyan('\n📈 Averages:'))
  console.log(`Daily Cost: ${formatCost(totalCost / days)}`)
  console.log(`Daily Tokens: ${formatTokens(Math.round(totalTokens / days))}`)
  console.log(`Daily Requests: ${chalk.blue(Math.round(totalRequests / days))}`)
  console.log(`Daily Scraps: ${chalk.blue(Math.round(totalScraps / days))}`)
}

function printTop() {
  console.log(chalk.cyan('\n🏆 Top Expensive Days'))
  console.log(chalk.cyan('='.repeat(60)))

  const topDays = Object.entries(data.dailyStats)
    .sort(([,a], [,b]) => b.cost - a.cost)
    .slice(0, 10)

  console.log(chalk.gray('Rank | Date       | Cost      | Scraps | $/Scrap'))
  console.log(chalk.gray('-'.repeat(60)))

  topDays.forEach(([date, stats], i) => {
    const costPerScrap = stats.scrapCount > 0 ? stats.cost / stats.scrapCount : 0
    console.log(
      `${(i + 1).toString().padStart(4)} | ${date} | ${stats.cost.toFixed(4).padStart(9)} | ${stats.scrapCount.toString().padStart(6)} | ${costPerScrap.toFixed(4)}`
    )
  })
}

function printMonthly() {
  console.log(chalk.cyan('\n📆 Monthly Breakdown'))
  console.log(chalk.cyan('='.repeat(60)))

  const monthlyData = {}

  Object.entries(data.dailyStats).forEach(([date, stats]) => {
    const month = date.substring(0, 7) // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = {
        cost: 0,
        tokens: 0,
        requests: 0,
        scrapCount: 0,
        days: 0,
      }
    }
    monthlyData[month].cost += stats.cost
    monthlyData[month].tokens += stats.tokens
    monthlyData[month].requests += stats.requests
    monthlyData[month].scrapCount += stats.scrapCount
    monthlyData[month].days += 1
  })

  console.log(chalk.gray('Month    | Cost      | Tokens      | Scraps  | Days | $/Day   | $/Scrap'))
  console.log(chalk.gray('-'.repeat(80)))

  Object.entries(monthlyData)
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([month, stats]) => {
      const costPerDay = stats.cost / stats.days
      const costPerScrap = stats.scrapCount > 0 ? stats.cost / stats.scrapCount : 0
      console.log(
        `${month} | ${stats.cost.toFixed(4).padStart(9)} | ${stats.tokens.toString().padStart(11)} | ${stats.scrapCount.toString().padStart(7)} | ${stats.days.toString().padStart(4)} | ${costPerDay.toFixed(4)} | ${costPerScrap.toFixed(4)}`
      )
    })
}

function printProjections() {
  console.log(chalk.cyan('\n📊 Cost Projections'))
  console.log(chalk.cyan('='.repeat(60)))

  // Calculate last 30 days average
  const last30Days = Object.entries(data.dailyStats)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 30)

  const totalCost = last30Days.reduce((sum, [, stats]) => sum + stats.cost, 0)
  const avgDailyCost = totalCost / 30

  console.log(chalk.yellow('Based on last 30 days:'))
  console.log(`Average daily cost: ${formatCost(avgDailyCost)}`)
  console.log(`Projected weekly:   ${formatCost(avgDailyCost * 7)}`)
  console.log(`Projected monthly:  ${formatCost(avgDailyCost * 30)}`)
  console.log(`Projected yearly:   ${formatCost(avgDailyCost * 365)}`)

  // Scraps processed
  const totalScraps = last30Days.reduce((sum, [, stats]) => sum + stats.scrapCount, 0)
  const avgDailyScraps = totalScraps / 30
  const costPerScrap = avgDailyCost / avgDailyScraps

  console.log(chalk.yellow('\nProcessing Stats:'))
  console.log(`Average daily scraps: ${chalk.blue(Math.round(avgDailyScraps))}`)
  console.log(`Cost per scrap: ${formatCost(costPerScrap)}`)
  console.log(`Projected scraps/month: ${chalk.blue(Math.round(avgDailyScraps * 30))}`)
}

function printWarnings() {
  console.log(chalk.cyan('\n⚠️  Cost Warnings'))
  console.log(chalk.cyan('='.repeat(60)))

  const last30Days = Object.entries(data.dailyStats)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 30)

  const avgCost = last30Days.reduce((sum, [, stats]) => sum + stats.cost, 0) / 30

  // Find days that cost > 2x average
  const expensiveDays = last30Days.filter(([, stats]) => stats.cost > avgCost * 2)

  if (expensiveDays.length > 0) {
    console.log(chalk.red(`\n🚨 Found ${expensiveDays.length} days with costs >2x average:`))
    expensiveDays.forEach(([date, stats]) => {
      const multiplier = (stats.cost / avgCost).toFixed(1)
      console.log(
        chalk.yellow(`  ${date}: ${formatCost(stats.cost)} (${multiplier}x avg) - ${stats.scrapCount} scraps`)
      )
    })
  } else {
    console.log(chalk.green('✅ No unusual cost spikes in last 30 days'))
  }

  // Check for high cost-per-scrap days
  const highCostPerScrap = last30Days.filter(([, stats]) => {
    const costPerScrap = stats.scrapCount > 0 ? stats.cost / stats.scrapCount : 0
    return costPerScrap > 0.01 && stats.scrapCount > 10
  })

  if (highCostPerScrap.length > 0) {
    console.log(chalk.red(`\n🚨 Found ${highCostPerScrap.length} days with high cost/scrap (>$0.01):`))
    highCostPerScrap.forEach(([date, stats]) => {
      const costPerScrap = stats.cost / stats.scrapCount
      console.log(
        chalk.yellow(`  ${date}: ${formatCost(costPerScrap)}/scrap (${stats.scrapCount} scraps, total: ${formatCost(stats.cost)})`)
      )
    })
  }
}

// Main execution
console.clear()

switch (command) {
  case 'summary':
    printSummary()
    printDaily(7)
    break

  case 'daily':
    printDaily(period)
    break

  case 'monthly':
    printMonthly()
    break

  case 'top':
    printTop()
    break

  case 'projections':
    printProjections()
    break

  case 'warnings':
    printWarnings()
    break

  case 'full':
    printSummary()
    printMonthly()
    printDaily(30)
    printTop()
    printProjections()
    printWarnings()
    break

  default:
    console.log(chalk.red(`Unknown command: ${command}`))
    console.log(chalk.yellow('\nAvailable commands:'))
    console.log('  summary         - Lifetime totals + last 7 days (default)')
    console.log('  daily [N]       - Last N days breakdown (default 7)')
    console.log('  monthly         - Monthly breakdown')
    console.log('  top             - Top 10 expensive days')
    console.log('  projections     - Cost projections based on last 30 days')
    console.log('  warnings        - Find cost spikes and anomalies')
    console.log('  full            - Everything')
    console.log(chalk.gray('\nExample: node scripts/analyze_costs.mjs daily 30'))
}

console.log('')
