import dotenv from 'dotenv'
import fs from 'fs'
import { execSync } from 'child_process'

// Check for environment variables before dotenv
console.log('\nEnvironment before dotenv:')
console.log('OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY)

// Load environment variables
dotenv.config()

// Read the .env file directly
const envFile = fs.readFileSync('.env', 'utf8')
console.log('\nRaw .env file contents for OPENROUTER_API_KEY:')
const openRouterLine = envFile
  .split('\n')
  .find((line) => line.startsWith('OPENROUTER_API_KEY'))
console.log(openRouterLine)

// Check for environment variables in shell
console.log('\nShell environment:')
try {
  const shellEnv = execSync('env | grep OPENROUTER_API_KEY').toString()
  console.log(shellEnv)
} catch (error) {
  console.log('Not found in shell environment')
}

console.log('\nLoaded environment variables after dotenv:')
console.log('OPENROUTER_API_KEY:', {
  value: process.env.OPENROUTER_API_KEY,
  length: process.env.OPENROUTER_API_KEY?.length,
  firstChars: process.env.OPENROUTER_API_KEY?.substring(0, 10),
  lastChars: process.env.OPENROUTER_API_KEY?.slice(-10),
})
