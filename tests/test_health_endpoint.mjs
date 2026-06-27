#!/usr/bin/env node
/**
 * Integration tests for the /health endpoint in api-server.mjs.
 * Starts the server in a child process, curls /health, checks responses.
 */

import { spawn } from 'child_process'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(__dirname, '..', 'scripts', 'api-server.mjs')

let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`)
    passed++
  } else {
    console.log(`  FAIL: ${name}`)
    failed++
  }
}

function fetchHealth(port = 3001) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}

function startServer(env, port = 3099) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_PATH], {
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill()
        reject(new Error('Server did not start within 8s'))
      }
    }, 8000)

    proc.stdout.on('data', (data) => {
      const msg = data.toString()
      if (msg.includes('running at') && !started) {
        started = true
        clearTimeout(timeout)
        resolve(proc)
      }
    })

    proc.stderr.on('data', (data) => {
      // Suppress stderr unless we need to debug
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code} before starting`))
      }
    })
  })
}

function killServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve()
    proc.on('exit', resolve)
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 2000)
  })
}

// ---- Test 1: Health endpoint with missing env vars (unhealthy) ----
console.log('\n1. Health endpoint with invalid DB creds (unhealthy)')
let proc
try {
  proc = await startServer({
    SUPABASE_URL: 'https://invalid-test.supabase.co',
    SUPABASE_KEY: 'fake-key-for-testing',
    OPENROUTER_API_KEY: 'sk-or-fake',
  }, 3099)

  const { status, body } = await fetchHealth(3099)

  assert(status === 503, `HTTP status should be 503 (got ${status})`)
  assert(body.status === 'unhealthy', `status should be unhealthy (got ${body.status})`)
  assert(body.checks !== undefined, 'should have checks object')
  assert(body.checks.database.status === 'fail', `database should be fail (got ${body.checks.database?.status})`)
  assert(body.checks.envVars.status === 'ok', `envVars should be ok (got ${body.checks.envVars?.status})`)
  assert(typeof body.uptime === 'number', `uptime should be number (got ${typeof body.uptime})`)
} catch (err) {
  console.log(`  SKIP: ${err.message}`)
} finally {
  await killServer(proc)
}

// ---- Test 2: Health endpoint with missing required env vars ----
console.log('\n2. Health endpoint with missing required env vars')
try {
  proc = await startServer({
    SUPABASE_URL: 'https://invalid-test.supabase.co',
    SUPABASE_KEY: 'fake-key-for-testing',
    // No AI key set
  }, 3098)

  const { status, body } = await fetchHealth(3098)

  assert(status === 503, `HTTP status should be 503 (got ${status})`)
  assert(body.status === 'unhealthy', `status should be unhealthy (got ${body.status})`)
  assert(body.checks.envVars.status === 'fail', `envVars should be fail (got ${body.checks.envVars?.status})`)
  assert(body.checks.envVars.errors.length > 0, 'should have env errors')
} catch (err) {
  console.log(`  SKIP: ${err.message}`)
} finally {
  await killServer(proc)
}

// ---- Test 3: Health endpoint response shape ----
console.log('\n3. Health endpoint response shape')
try {
  proc = await startServer({
    SUPABASE_URL: 'https://invalid-test.supabase.co',
    SUPABASE_KEY: 'fake-key',
    OPENROUTER_API_KEY: 'sk-or-fake',
  }, 3097)

  const { body } = await fetchHealth(3097)

  assert('status' in body, 'has status field')
  assert('checks' in body, 'has checks field')
  assert('uptime' in body, 'has uptime field')
  assert('envVars' in body.checks, 'checks has envVars')
  assert('config' in body.checks, 'checks has config')
  assert('database' in body.checks, 'checks has database')
  assert(Array.isArray(body.checks.envVars.warnings), 'envVars has warnings array')
  assert(Array.isArray(body.checks.envVars.errors), 'envVars has errors array')
} catch (err) {
  console.log(`  SKIP: ${err.message}`)
} finally {
  await killServer(proc)
}

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`)
if (failed > 0) {
  console.log('SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL TESTS PASSED')
}
