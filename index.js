const client = require('smartsheet');
const fs = require('fs');
const { parse } = require('csv-parse');

// --- CONFIGURATION ---
const SMARTSHEET_ACCESS_TOKEN = 'YOUR_API_TOKEN_HERE';
const INPUT_FILE = 'users_to_deactivate.csv';
const LOG_FILE = 'deactivation_log.txt';

const smartsheet = client.createClient({
  accessToken: SMARTSHEET_ACCESS_TOKEN,
  logLevel: 'info'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`Starting bulk deactivation for users in ${INPUT_FILE}...`);
  const usersToProcess = [];

  // 1. Read the CSV file using csv-parse
  // This is safer and handles BOM, odd encodings, and edge cases better than standard split
  const parser = fs
    .createReadStream(INPUT_FILE)
    .pipe(parse({
      columns: true, // Auto-detect headers (e.g., 'userId')
      trim: true,    // Trims whitespace from values automatically
      skip_empty_lines: true
    }));

  for await (const row of parser) {
    // Assumes your CSV header is "userId"
    if (row.userId) {
      usersToProcess.push(row.userId);
    }
  }

  console.log(`Loaded ${usersToProcess.length} users. Beginning deactivation...`);
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  // 2. Iterate and Deactivate
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < usersToProcess.length; i++) {
    const userId = usersToProcess[i];
    
    try {
      await smartsheet.users.deactivateUser({ id: userId });

      const msg = `[${i + 1}/${usersToProcess.length}] SUCCESS: User ${userId} deactivated.`;
      console.log(msg);
      logStream.write(`${new Date().toISOString()} - ${msg}\n`);
      successCount++;
    } catch (error) {
      const errorMsg = error.message || JSON.stringify(error);
      const msg = `[${i + 1}/${usersToProcess.length}] FAILED: User ${userId} - ${errorMsg}`;
      console.error(msg);
      logStream.write(`${new Date().toISOString()} - ${msg}\n`);
      errorCount++;
    }

    // Rate Limit: Pausing 250ms (~4 requests/sec) to stay safe under the 300/min limit
    await sleep(250);
  }

  console.log('--- PROCESSING COMPLETE ---');
  console.log(`Total Success: ${successCount}`);
  console.log(`Total Failed: ${errorCount}`);
}

main();