import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

// Build connection string from Supabase env vars
const supabaseUrl = process.env.SUPABASE_URL?.replace('https://', '').replace('.supabase.co', '');
const connectionString = process.env.DATABASE_URL ||
  `postgresql://postgres.${supabaseUrl}:${process.env.SUPABASE_KEY}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  verbose: true,
  strict: true,
});
