import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import chalk from 'chalk';
import sgMail from '@sendgrid/mail';

const STUCK_THRESHOLD_MINS = 5;

dotenv.config();

// Initialize SendGrid only if API key is present
if (process.env.SENDGRID_API_KEY?.startsWith('SG.')) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.log(chalk.yellow('⚠️ SendGrid API key not configured - email reports disabled'));
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log(chalk.blue(`
╔═══════════════════════════════════════╗
║      DATABASE INTEGRITY CHECKER        ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
╚═══════════════════════════════════════╝
`));

// Check for invalid source/type combinations
const VALID_COMBINATIONS = {
  pinboard: ['bookmark'],
  mastodon: ['status'],
  arena: ['block'],
  github: ['repo', 'gist', 'issue', 'pull_request'],
  lock: ['init']
};

async function checkStuckProcessing() {
  console.log(chalk.yellow('\n🔄 Checking for stuck processing...'));
  
  
  
  const { data: stuckScraps } = await supabase
    .from('scraps')
    .select('id, scrap_id, processing_instance_id, processing_started_at')
    .not('processing_instance_id', 'is', null)
    .lt('processing_started_at', 
      new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString()
    );

  if (stuckScraps?.length) {
    console.log(chalk.red(`Found ${stuckScraps.length} scraps stuck in processing`));
    stuckScraps.slice(0, 5).forEach(scrap => {
      console.log(chalk.gray(`  ${scrap.scrap_id} - Instance: ${scrap.processing_instance_id}`));
      console.log(chalk.gray(`    Started: ${new Date(scrap.processing_started_at).toLocaleString()}`));
    });

    // Clear stuck processing
    const { error } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null
      })
      .in('id', stuckScraps.map(s => s.id));

    if (error) {
      console.error('Failed to clear stuck processing:', error);
    } else {
      console.log(chalk.green('Cleared stuck processing states'));
    }
  } else {
    console.log(chalk.green('No stuck processing found'));
  }

  return {
    stuck_count: stuckScraps?.length || 0,
    cleared: Boolean(stuckScraps?.length)
  };
}

async function checkFieldIntegrity() {
  console.log(chalk.yellow('\n🔍 Starting field integrity check...'));
  
  const fields = {
    required: ['id', 'source', 'content', 'created_at', 'updated_at'],
    optional: ['summary', 'tags', 'relationships', 'metadata', 'url', 'screenshot_url', 
              'location', 'title', 'latitude', 'longitude', 'type', 'published_at', 'shared'],
    vectors: ['embedding', 'embedding_nomic', 'image_embedding']
  };

  const stats = {};
  
  // Get total record count first
  const { count: totalRecords } = await supabase
    .from('scraps')
    .select('*', { count: 'exact', head: true });
  
  console.log(chalk.blue(`📊 Total records in database: ${totalRecords}`));
  
  // Exit early if no records
  if (!totalRecords) {
    console.log(chalk.yellow('ℹ️ No records found in database. Skipping field integrity check.'));
    return {
      required: {},
      optional: {},
      vectors: {}
    };
  }
  
  // Check each category
  for (const [category, fieldList] of Object.entries(fields)) {
    console.log(chalk.yellow(`\n📋 Checking ${category} fields...`));
    stats[category] = {};
    
    for (const field of fieldList) {
      process.stdout.write(chalk.gray(`  ⚡ Analyzing ${field}... `));
      
      const { count: nullCount } = await supabase
        .from('scraps')
        .select('*', { count: 'exact', head: true })
        .is(field, null);
      
      const coverage = ((1 - nullCount/totalRecords) * 100).toFixed(1);
      const color = coverage > 90 ? 'green' : coverage > 70 ? 'yellow' : 'red';
      
      process.stdout.write(chalk[color](`${coverage}% complete\n`));
      
      if (nullCount > 0) {
        // Sample a few records with null values
        const { data: samples } = await supabase
          .from('scraps')
          .select('id, source, type, created_at')
          .is(field, null)
          .limit(3);
          
        if (samples?.length) {
          console.log(chalk.gray(`    Missing in ${samples.length} records, examples:`));
          samples.forEach(sample => {
            console.log(chalk.gray(`    - ${sample.source}/${sample.type} (${new Date(sample.created_at).toLocaleDateString()})`));
          });
        }
      }
      
      stats[category][field] = {
        null_count: nullCount,
        total: totalRecords,
        coverage: parseFloat(coverage)
      };
    }
  }

  console.log(chalk.green('\n✅ Field integrity check complete'));
  return stats;
}

async function checkVectorDimensions() {
  console.log(chalk.yellow('\n📐 Checking vector dimensions...'));
  
  const vectors = {
    embedding: 1536,        // OpenAI dimensions
    embedding_nomic: 768,   // Nomic dimensions
    image_embedding: 512    // Vision dimensions
  };

  const stats = {};
  
  for (const [field, expectedDim] of Object.entries(vectors)) {
    const { data } = await supabase
      .from('scraps')
      .select(`id, scrap_id, ${field}`)
      .not(field, 'is', null)
      .limit(1000);
      
    const dimensions = data?.map(row => row[field]?.length).filter(Boolean);
    const invalidDims = dimensions.filter(d => d !== expectedDim);
    
    stats[field] = {
      total_vectors: dimensions.length,
      invalid_dimensions: invalidDims.length,
      has_issues: invalidDims.length > 0
    };

    // Only log summary of issues
    if (invalidDims.length > 0) {
      console.log(chalk.red(
        `Found ${invalidDims.length} ${field} vectors with incorrect dimensions ` +
        `(expected ${expectedDim})`
      ));
    }
  }

  return stats;
}

async function checkSourceTypeValidity() {
  console.log(chalk.yellow('\n🏷️ Checking source/type validity...'));
  
  // Simpler query that doesn't try to count using id
  const { data, error } = await supabase
    .from('scraps')
    .select('source, type')
    .not('source', 'is', null);

  if (error) {
    console.error('Error fetching source/type stats:', error);
    return {
      combinations: [],
      invalid: []
    };
  }
    
  // Group and count in JavaScript
  const grouped = data.reduce((acc, row) => {
    const key = `${row.source}-${row.type}`;
    if (!acc[key]) {
      acc[key] = {
        source: row.source,
        type: row.type,
        count: 0
      };
    }
    acc[key].count++;
    return acc;
  }, {});

  const formattedData = Object.values(grouped);
  
  // Check for invalid combinations
  const invalid = formattedData.filter(row => {
    const validTypes = VALID_COMBINATIONS[row.source];
    return !validTypes?.includes(row.type);
  });

  return {
    combinations: formattedData,
    invalid
  };
}

async function checkDateConsistency() {
  console.log(chalk.yellow('\n📅 Checking date consistency...'));
  
  const { data } = await supabase
    .from('scraps')
    .select('*')
    .or(
      'created_at.gt.updated_at',
      'published_at.gt.created_at',
      'updated_at.gt.current_timestamp'
    );

  return {
    invalid_dates: data || [],
    issues: data?.map(row => ({
      id: row.id,
      created: row.created_at,
      updated: row.updated_at,
      published: row.published_at,
      issues: [
        row.created_at > row.updated_at && 'created_at after updated_at',
        row.published_at > row.created_at && 'published_at after created_at',
        row.updated_at > new Date() && 'updated_at in future'
      ].filter(Boolean)
    }))
  };
}

async function checkGeoData() {
  console.log(chalk.yellow('\n🌍 Checking geo data...'));
  
  const { data } = await supabase
    .from('scraps')
    .select('id, scrap_id, location, latitude, longitude')
    .or(
      'location.not.is.null,latitude.not.is.null,longitude.not.is.null'
    );

  const incomplete = data?.filter(row => {
    const hasLocation = Boolean(row.location);
    const hasCoords = Boolean(row.latitude && row.longitude);
    return hasLocation !== hasCoords;
  });

  if (incomplete?.length) {
    console.log(chalk.red(`Found ${incomplete.length} records with inconsistent geo data`));
    incomplete.slice(0, 5).forEach(scrap => {
      console.log(`  ${scrap.scrap_id}:`);
      console.log(`    Location: ${scrap.location || 'missing'}`);
      console.log(`    Coords: ${scrap.latitude},${scrap.longitude || 'missing'}`);
    });
  }

  return {
    total_geo: data?.length || 0,
    incomplete: incomplete || []
  };
}

// Update the sendEmailReport function
async function sendEmailReport(report, claimSection) {
  const { fields, vectors, sourceTypes, dates, geo, duplicates } = report;
  
  const html = `
    <h1>Scrapbook Database Integrity Report</h1>
    <p>Report generated at: ${new Date().toISOString()}</p>

    ${claimSection}

    <h2>📊 Field Coverage</h2>
    ${Object.entries(fields).map(([category, stats]) => `
      <h3>${category.toUpperCase()}</h3>
      <ul>
        ${Object.entries(stats).map(([field, data]) => {
          const coverage = ((1 - data.null_count / data.total) * 100).toFixed(1);
          const color = coverage > 90 ? 'green' : coverage > 70 ? 'orange' : 'red';
          return `<li style="color: ${color}">${field}: ${coverage}% coverage (${data.null_count} null)</li>`;
        }).join('')}
      </ul>
    `).join('')}

    <h2>📐 Vector Embeddings Summary</h2>
    ${Object.entries(vectors).map(([field, stats]) => `
      <h3>${field}</h3>
      <p>Total vectors: ${stats.total_vectors}</p>
      ${stats.invalid_dimensions > 0 ? `
        <p style="color: red">⚠️ Found ${stats.invalid_dimensions} vectors with incorrect dimensions</p>
      ` : '<p style="color: green">✓ All vectors have correct dimensions</p>'}
    `).join('')}

    <h2>🏷️ Source/Type Distribution</h2>
    <ul>
      ${sourceTypes.combinations?.map(combo => {
        const isValid = VALID_COMBINATIONS[combo.source]?.includes(combo.type);
        return `<li style="color: ${isValid ? 'green' : 'red'}">
          ${combo.source}/${combo.type}: ${combo.count} records
        </li>`;
      }).join('')}
    </ul>

    <h2>📅 Date Issues</h2>
    ${dates.invalid_dates.length > 0 ? `
      <p style="color: red">Found ${dates.invalid_dates.length} records with date issues</p>
      <ul>
        ${dates.issues.slice(0, 5).map(issue => `
          <li>${issue.id}:
            <ul>
              ${issue.issues.map(i => `<li>${i}</li>`).join('')}
            </ul>
          </li>
        `).join('')}
      </ul>
    ` : '<p style="color: green">No date issues found</p>'}

    <h2>🌍 Geo Data</h2>
    <p>Total records with geo data: ${geo.total_geo}</p>
    <p>Incomplete geo records: ${geo.incomplete.length}</p>
  `;

  try {
    await sgMail.send({
      to: 'ejfox@ejfox.com',
      from: 'ejfox@room302.studio',
      subject: 'Scrapbook Database Integrity Report',
      html,
      text: 'Please view this email in an HTML-capable client'
    });

    console.log(chalk.green('\n📧 Email report sent successfully'));
  } catch (error) {
    console.error(chalk.red('\n❌ Error sending email report:'), error);
    console.error('Error details:', error.response?.body);
  }
}

// Add a function to check and fix vector dimensions
async function fixVectorDimensions() {
  console.log(chalk.yellow('\n🔧 Checking and fixing vector dimensions...'));
  
  const { data: invalidEmbeddings } = await supabase
    .from('scraps')
    .select('id, scrap_id, embedding')
    .not('embedding', 'is', null);
    
  for (const scrap of invalidEmbeddings) {
    if (scrap.embedding.length !== 1536) {  // OpenAI dimensions
      // console.log(chalk.red(`Invalid embedding dimensions for ${scrap.scrap_id}: ${scrap.embedding.length}`));
      
      // Clear invalid embedding
      const { error } = await supabase
        .from('scraps')
        .update({ embedding: null })
        .eq('id', scrap.id);
        
      if (error) {
        console.error(`Failed to clear invalid embedding: ${error.message}`);
      }
    }
  }
}

// Add function to check for critical missing fields
async function checkCriticalFields() {
  console.log(chalk.yellow('\n🔍 Checking critical fields...'));
  
  const criticalFields = ['url', 'title', 'type'];
  const { data: scraps } = await supabase
    .from('scraps')
    .select('id, source, scrap_id, url, title, type')
    .or(criticalFields.map(field => `${field}.is.null`).join(','));
    
  if (scraps?.length) {
    console.log(chalk.red(`Found ${scraps.length} records with missing critical fields`));
    // Log sample of problematic records
    scraps.slice(0, 5).forEach(scrap => {
      console.log(`  ${scrap.source}/${scrap.scrap_id}:`);
      criticalFields.forEach(field => {
        if (!scrap[field]) console.log(`    Missing ${field}`);
      });
    });
  }
}

// Replace checkExactDuplicates with this version
// async function checkExactDuplicates() {
//   console.log(chalk.yellow('\n🔍 Checking for exact duplicates...'));
  
//   // First check if we have any records
//   const { count: totalRecords } = await supabase
//     .from('scraps')
//     .select('*', { count: 'exact', head: true });
    
//   if (!totalRecords) {
//     console.log(chalk.yellow('ℹ️ No records found in database. Skipping duplicate check.'));
//     return {
//       duplicate_urls: [],
//       duplicate_titles: []
//     };
//   }

//   // Check URL duplicates
//   const { data: urlDupes, error: urlError } = await supabase
//     .from('scraps')
//     .select('url, count(*)')
//     .not('url', 'is', null)
//     .group('url')
//     .having('count(*)', 'gt', 1);

//   if (urlError) {
//     console.error('Error checking URL duplicates:', urlError);
//   }

//   // Check title duplicates
//   const { data: titleDupes, error: titleError } = await supabase
//     .from('scraps')
//     .select('title, count(*)')
//     .not('title', 'is', null)
//     .group('title')
//     .having('count(*)', 'gt', 1);

//   if (titleError) {
//     console.error('Error checking title duplicates:', titleError);
//   }

//   // Log duplicates if found
//   if (urlDupes?.length) {
//     console.log(chalk.red(`\nFound ${urlDupes.length} URLs with duplicates:`));
//     for (const dupe of urlDupes.slice(0, 3)) {
//       const { data: examples } = await supabase
//         .from('scraps')
//         .select('id, source, created_at, url')
//         .eq('url', dupe.url)
//         .order('created_at');
      
//       if (examples?.length) {
//         console.log(`\n  URL: ${dupe.url}`);
//         examples.forEach(ex => 
//           console.log(`    - ${ex.source} (${new Date(ex.created_at).toLocaleDateString()})`)
//         );
//       }
//     }
//   } else {
//     console.log(chalk.green('No duplicate URLs found'));
//   }

//   return {
//     duplicate_urls: urlDupes || [],
//     duplicate_titles: titleDupes || []
//   };
// }

// Add these validation functions
async function validateClaimStates() {
  console.log(chalk.yellow('\n🔄 Validating claim states...'));
  
  const issues = {
    stuck: [],
    invalid: [],
    orphaned: [],
    suspicious: []
  };

  // Check for stuck claims
  const { data: stuckScraps } = await supabase
    .from('scraps')
    .select('id, scrap_id, processing_instance_id, processing_started_at')
    .not('processing_instance_id', 'is', null)
    .lt('processing_started_at', 
      new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString()
    );

  if (stuckScraps?.length) {
    issues.stuck = stuckScraps;
    console.log(chalk.red(`Found ${stuckScraps.length} scraps stuck in processing`));
    stuckScraps.slice(0, 5).forEach(scrap => {
      const duration = Math.round((Date.now() - new Date(scrap.processing_started_at).getTime()) / 1000 / 60);
      console.log(chalk.gray(`  ${scrap.scrap_id}:`));
      console.log(chalk.gray(`    Instance: ${scrap.processing_instance_id}`));
      console.log(chalk.gray(`    Started: ${new Date(scrap.processing_started_at).toLocaleString()}`));
      console.log(chalk.gray(`    Duration: ${duration} minutes`));
    });
  }

  // Check for invalid states (processing_instance_id without processing_started_at or vice versa)
  const { data: invalidScraps } = await supabase
    .from('scraps')
    .select('id, scrap_id, processing_instance_id, processing_started_at')
    .or(
      'and(processing_instance_id.is.null,processing_started_at.not.is.null)',
      'and(processing_instance_id.not.is.null,processing_started_at.is.null)'
    );

  if (invalidScraps?.length) {
    issues.invalid = invalidScraps;
    console.log(chalk.red(`Found ${invalidScraps.length} scraps with invalid claim states`));
  }

  // Check for suspicious patterns (multiple claims by same instance)
  // Fetch all active claims within the threshold time
  const { data: activeScraps, error } = await supabase
    .from('scraps')
    .select('processing_instance_id')
    .not('processing_instance_id', 'is', null)
    .gt(
      'processing_started_at',
      new Date(Date.now() - STUCK_THRESHOLD_MINS * 60 * 1000).toISOString()
    );

  if (error) {
    console.error('Error fetching active claims:', error);
  } else {
    // Group and count the number of active claims per instance ID
    const counts = activeScraps.reduce((acc, scrap) => {
      const instanceId = scrap.processing_instance_id;
      acc[instanceId] = (acc[instanceId] || 0) + 1;
      return acc;
    }, {});

    // Identify instances with more than 10 active claims
    const suspiciousInstances = Object.entries(counts)
      .filter(([_, count]) => count > 10)
      .map(([instanceId, count]) => ({ processing_instance_id: instanceId, count }));

    if (suspiciousInstances.length > 0) {
      issues.suspicious = suspiciousInstances;
      console.log(
        chalk.yellow(`Found ${suspiciousInstances.length} instances with high claim counts`)
      );
      suspiciousInstances.forEach(claim => {
        console.log(
          chalk.gray(`  ${claim.processing_instance_id}: ${claim.count} active claims`)
        );
      });
    } else {
      console.log(chalk.green('No instances with high claim counts found'));
    }
  }

  return issues;
}

async function clearProblematicClaims(issues) {
  console.log(chalk.yellow('\n🧹 Cleaning up problematic claims...'));
  
  const claimsToClean = [
    ...issues.stuck.map(s => s.id),
    ...issues.invalid.map(s => s.id)
  ];

  if (claimsToClean.length > 0) {
    const { error } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null
      })
      .in('id', claimsToClean);

    if (error) {
      console.error('Failed to clear problematic claims:', error);
    } else {
      console.log(chalk.green(`Cleared ${claimsToClean.length} problematic claims`));
    }
  }

  return claimsToClean.length;
}

async function cleanupOrphanedScraps() {
  console.log(chalk.yellow('\n🧹 Cleaning up orphaned scraps...'));

  // Find scraps that are stuck in initial "Processing..." state
  const { data: orphanedScraps } = await supabase
    .from('scraps')
    .select('*')
    .eq('content', 'Processing...')
    .is('processing_instance_id', null);

  if (orphanedScraps?.length) {
    console.log(chalk.red(`Found ${orphanedScraps.length} orphaned scraps`));
    
    // Delete orphaned scraps
    const { error } = await supabase
      .from('scraps')
      .delete()
      .in('id', orphanedScraps.map(s => s.id));

    if (error) {
      console.error('Failed to delete orphaned scraps:', error);
    } else {
      console.log(chalk.green(`Deleted ${orphanedScraps.length} orphaned scraps`));
    }
  } else {
    console.log(chalk.green('No orphaned scraps found'));
  }

  return {
    orphaned_count: orphanedScraps?.length || 0,
    cleaned: Boolean(orphanedScraps?.length)
  };
}

// Add this function
async function cleanupProcessingScraps() {
  console.log(chalk.yellow('\n🧹 Cleaning up Processing... scraps'));
  
  // Find all scraps stuck in Processing... state
  const { data: processingScraps } = await supabase
    .from('scraps')
    .select('*')
    .eq('content', 'Processing...');

  if (processingScraps?.length) {
    console.log(chalk.red(`Found ${processingScraps.length} scraps stuck in Processing... state`));
    
    // Delete them
    const { error } = await supabase
      .from('scraps')
      .delete()
      .in('id', processingScraps.map(s => s.id));

    if (error) {
      console.error('Failed to delete Processing... scraps:', error);
    } else {
      console.log(chalk.green(`Deleted ${processingScraps.length} Processing... scraps`));
    }
  } else {
    console.log(chalk.green('No Processing... scraps found'));
  }
}

// Update main function to include orphaned cleanup
async function main() {
  console.log(chalk.green('Starting comprehensive database integrity check...'));
  const startTime = Date.now();
  
  try {
    // Check if database is empty first
    const { count: totalRecords } = await supabase
      .from('scraps')
      .select('*', { count: 'exact', head: true });
      
    if (!totalRecords) {
      console.log(chalk.yellow('\n⚠️ Database is empty. No integrity checks needed.'));
      return;
    }

    // Add this at the start
    await cleanupProcessingScraps();
    
    const report = {
      fields: await checkFieldIntegrity(),
      // duplicates: await checkExactDuplicates(),
      duplicates: null,
      vectors: await checkVectorDimensions(),
      sourceTypes: await checkSourceTypeValidity(),
      dates: await checkDateConsistency(),
      geo: await checkGeoData(),
      processing: await checkStuckProcessing(),
      orphaned: await cleanupOrphanedScraps()
    };
    
    // Print detailed report
    console.log(chalk.blue('\n═══════════════════════════════'));
    console.log(chalk.blue('     INTEGRITY REPORT   '));
    console.log(chalk.blue('═══════════════════════════════\n'));
    
    // Field Stats
    console.log(chalk.yellow('📊 FIELD COVERAGE'));
    Object.entries(report.fields).forEach(([category, stats]) => {
      console.log(`\n${category.toUpperCase()}:`);
      Object.entries(stats).forEach(([field, data]) => {
        const coverage = ((1 - data.null_count/data.total) * 100).toFixed(1);
        const color = coverage > 90 ? 'green' : coverage > 70 ? 'yellow' : 'red';
        console.log(chalk[color](`  ${field}: ${coverage}% coverage (${data.null_count} null)`));
      });
    });

    // Vector Stats
    console.log(chalk.yellow('\n📐 VECTOR DIMENSIONS'));
    Object.entries(report.vectors).forEach(([field, stats]) => {
      console.log(`\n${field}:`);
      console.log(`  Total vectors: ${stats.total_vectors}`);
      console.log(`  Invalid dimensions: ${stats.invalid_dimensions}`);
      if (stats.invalid_dimensions > 0) {
        console.log('  Dimension counts:', stats.dimension_counts);
      }
    });

    // Source/Type Stats
    console.log(chalk.yellow('\n🏷️ SOURCE/TYPE COMBINATIONS'));
    report.sourceTypes.combinations?.forEach(combo => {
      const isValid = VALID_COMBINATIONS[combo.source]?.includes(combo.type);
      const color = isValid ? 'green' : 'red';
      console.log(chalk[color](`  ${combo.source}/${combo.type}: ${combo.count} records`));
    });

    // Date Issues
    console.log(chalk.yellow('\n📅 DATE ISSUES'));
    if (report.dates.invalid_dates.length > 0) {
      console.log(chalk.red(`Found ${report.dates.invalid_dates.length} records with date issues`));
      report.dates.issues.slice(0, 5).forEach(issue => {
        console.log(`  ${issue.id}:`);
        issue.issues.forEach(i => console.log(`    - ${i}`));
      });
    } else {
      console.log(chalk.green('No date issues found'));
    }

    // Geo Data
    console.log(chalk.yellow('\n🌍 GEO DATA'));
    console.log(`Total records with geo data: ${report.geo.total_geo}`);
    console.log(`Incomplete geo records: ${report.geo.incomplete.length}`);
    
    // Add vector fixing
    if (report.vectors.embedding.invalid_dimensions > 0) {
      await fixVectorDimensions();
    }
    
    const claimIssues = await validateClaimStates();
    const clearedClaimsCount = await clearProblematicClaims(claimIssues);

    // Add to report
    report.claims = {
      stuck: claimIssues.stuck.length,
      invalid: claimIssues.invalid.length,
      suspicious: claimIssues.suspicious.length,
      cleared: clearedClaimsCount
    };

    // Add claims section to report output
    console.log(chalk.yellow('\n🔒 CLAIM STATUS'));
    console.log(chalk.red(`  Stuck Claims: ${report.claims.stuck}`));
    console.log(chalk.red(`  Invalid States: ${report.claims.invalid}`));
    console.log(chalk.yellow(`  Suspicious Patterns: ${report.claims.suspicious}`));
    console.log(chalk.green(`  Claims Cleared: ${report.claims.cleared}`));

    // Include in email report
    const claimSection = `
      <h2>🔒 Claim Status</h2>
      <ul>
        <li style="color: ${report.claims.stuck > 0 ? 'red' : 'green'}">
          Stuck Claims: ${report.claims.stuck}
        </li>
        <li style="color: ${report.claims.invalid > 0 ? 'red' : 'green'}">
          Invalid States: ${report.claims.invalid}
        </li>
        <li style="color: ${report.claims.suspicious > 0 ? 'orange' : 'green'}">
          Suspicious Patterns: ${report.claims.suspicious}
        </li>
        <li style="color: green">
          Claims Cleared: ${report.claims.cleared}
        </li>
      </ul>
    `;

    // Send email report, passing claimSection
    await sendEmailReport(report, claimSection);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(chalk.green(`\n✨ Check completed in ${duration}s`));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error during integrity check:'), error);
    process.exit(1);
  }
}

main().catch(console.error); 