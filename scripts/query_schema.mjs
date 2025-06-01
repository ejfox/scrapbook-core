#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role key for schema queries
);

console.log(chalk.blue(`
╔═══════════════════════════════════════╗
║        SUPABASE SCHEMA QUERY           ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
╚═══════════════════════════════════════╝
`));

async function querySchema() {
  try {
    // Query table schema using information_schema
    console.log(chalk.yellow("\n📋 Querying 'scraps' table schema..."));
    
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_schema', { table_name: 'scraps' });
    
    if (columnsError) {
      console.log(chalk.red("RPC function not available, trying direct query..."));
      
      // Try direct query to information_schema
      const { data: directColumns, error: directError } = await supabase
        .from('information_schema.columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_name', 'scraps')
        .eq('table_schema', 'public')
        .order('ordinal_position');
      
      if (directError) {
        console.log(chalk.red("Direct query failed, trying sample data approach..."));
        
        // Fallback: Query a sample record to see actual structure
        const { data: sampleData, error: sampleError } = await supabase
          .from('scraps')
          .select('*')
          .limit(1);
        
        if (sampleError) {
          console.error(chalk.red("Failed to query sample data:"), sampleError);
          return;
        }
        
        if (sampleData && sampleData.length > 0) {
          console.log(chalk.green("\n✅ Sample record structure:"));
          const sample = sampleData[0];
          Object.keys(sample).forEach(key => {
            const value = sample[key];
            const type = typeof value;
            const hasValue = value !== null && value !== undefined;
            console.log(`  ${key}: ${type} ${hasValue ? '✓' : '✗'}`);
          });
        }
        
      } else {
        console.log(chalk.green("\n✅ Table schema from information_schema:"));
        directColumns.forEach(col => {
          console.log(`  ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : '(not null)'}`);
        });
      }
      
    } else {
      console.log(chalk.green("\n✅ Table schema from RPC:"));
      console.log(columns);
    }
    
    // Try to get constraints
    console.log(chalk.yellow("\n🔗 Querying table constraints..."));
    const { data: constraints, error: constraintsError } = await supabase
      .from('information_schema.table_constraints')
      .select('constraint_name, constraint_type')
      .eq('table_name', 'scraps');
    
    if (!constraintsError && constraints) {
      console.log(chalk.green("✅ Table constraints:"));
      constraints.forEach(constraint => {
        console.log(`  ${constraint.constraint_name}: ${constraint.constraint_type}`);
      });
    }
    
    // Try to get indexes
    console.log(chalk.yellow("\n📇 Querying table indexes..."));
    const { data: indexes, error: indexesError } = await supabase
      .from('pg_indexes')
      .select('indexname, indexdef')
      .eq('tablename', 'scraps');
    
    if (!indexesError && indexes) {
      console.log(chalk.green("✅ Table indexes:"));
      indexes.forEach(index => {
        console.log(`  ${index.indexname}`);
        console.log(`    ${index.indexdef}`);
      });
    }
    
    // Get basic table stats
    console.log(chalk.yellow("\n📊 Getting table statistics..."));
    const { count, error: countError } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true });
    
    if (!countError) {
      console.log(chalk.green(`✅ Total records: ${count}`));
    }
    
    // Check for any records with both 'id' and 'scrap_id' fields
    console.log(chalk.yellow("\n🔍 Checking for ID field usage..."));
    const { data: idCheck, error: idError } = await supabase
      .from('scraps')
      .select('id, scrap_id')
      .limit(3);
    
    if (!idError && idCheck) {
      console.log(chalk.green("✅ Sample ID fields:"));
      idCheck.forEach((record, i) => {
        console.log(`  Record ${i+1}:`);
        console.log(`    id: ${record.id}`);
        console.log(`    scrap_id: ${record.scrap_id}`);
      });
    }
    
  } catch (error) {
    console.error(chalk.red("Error querying schema:"), error);
  }
}

querySchema().then(() => {
  console.log(chalk.blue("\n🏁 Schema query complete"));
  process.exit(0);
});