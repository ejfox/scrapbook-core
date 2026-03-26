#!/usr/bin/env node

/**
 * Package Structure Verification
 * Validates that all packages are properly structured without requiring npm install
 */

import fs from 'fs'
import path from 'path'

const packagesDir = './packages'
const packages = [
  'entity-extraction',
  'content-summarization',
  'content-geolocation',
  'financial-analysis',
]

const requiredFiles = ['package.json', 'index.mjs', 'README.md']

console.log('🔍 Verifying package structure...\n')

let allValid = true

for (const pkg of packages) {
  const pkgPath = path.join(packagesDir, pkg)
  console.log(`📦 Checking @scrapbook/${pkg}...`)

  // Check if directory exists
  if (!fs.existsSync(pkgPath)) {
    console.log(`  ❌ Directory not found: ${pkgPath}`)
    allValid = false
    continue
  }

  // Check required files
  for (const file of requiredFiles) {
    const filePath = path.join(pkgPath, file)
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      console.log(`  ✓ ${file} (${stats.size} bytes)`)
    } else {
      console.log(`  ❌ Missing ${file}`)
      allValid = false
    }
  }

  // Check package.json content
  const packageJsonPath = path.join(pkgPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

    // Validate essential fields
    const essentialFields = ['name', 'version', 'description', 'main', 'type', 'exports']
    let missingFields = []

    for (const field of essentialFields) {
      if (!packageJson[field]) {
        missingFields.push(field)
      }
    }

    if (missingFields.length === 0) {
      console.log('  ✓ package.json is valid')
    } else {
      console.log(`  ⚠️  package.json missing fields: ${missingFields.join(', ')}`)
    }
  }

  console.log()
}

// Check root package.json workspace config
console.log('📦 Checking root package.json...')
const rootPackageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'))

if (rootPackageJson.workspaces && rootPackageJson.workspaces.includes('packages/*')) {
  console.log('  ✓ Workspaces configured')
} else {
  console.log('  ❌ Workspaces not configured')
  allValid = false
}

// Check if packages are listed as dependencies
const pkgDeps = Object.keys(rootPackageJson.dependencies || {})
  .filter(dep => dep.startsWith('@scrapbook/'))

if (pkgDeps.length === packages.length) {
  console.log(`  ✓ All ${packages.length} packages listed as dependencies`)
} else {
  console.log(`  ⚠️  Only ${pkgDeps.length}/${packages.length} packages listed as dependencies`)
}

console.log()

// Summary
if (allValid) {
  console.log('✅ All packages are properly structured!')
  console.log('\nNext steps:')
  console.log('  1. Run `npm install` to set up workspaces')
  console.log('  2. Test package imports with `node test-packages.mjs`')
  console.log('  3. Complete standalone implementations for geolocation and financial-analysis')
} else {
  console.log('❌ Some validation checks failed')
  console.log('Please review the output above and fix any issues')
}

console.log('\n📚 See PACKAGE_VALIDATION.md for detailed status')
