/*
 * ================================================================
 * SMARTSHEET BULK USER REMOVAL SCRIPT
 * ================================================================
 * 
 * PURPOSE:
 * This script safely removes deactivated users from Smartsheet and transfers
 * their assets (sheets, workspaces, etc.) to a designated user.
 * 
 * SAFETY FEATURES:
 * - Only removes users who are already DEACTIVATED (status: DECLINED/PENDING)
 * - Active users will be skipped with clear error messages
 * - All assets are transferred to a specified user (no data loss)
 * - Comprehensive logging and status reporting
 * 
 * PREREQUISITES:
 * 1. Node.js installed
 * 2. Smartsheet API token with admin permissions
 * 3. CSV file with users to remove
 * 4. Target user ID to receive transferred assets
 * 
 * SETUP INSTRUCTIONS:
 * 1. Install dependencies: npm install smartsheet csv-parse csv-stringify
 * 2. Update SMARTSHEET_ACCESS_TOKEN below
 * 3. Update TRANSFER_TO_USER_ID below
 * 4. Create input CSV file (see INPUT FILE FORMAT below)
 * 5. Run: node remove-users.js
 * 
 * INPUT FILE FORMAT (users_to_remove.csv):
 * Can use either userId OR email columns (or both):
 * 
 * Option 1 - User IDs:
 * userId
 * 1234567890
 * 9876543210
 * 
 * Option 2 - Emails:
 * email
 * user1@company.com
 * user2@company.com
 * 
 * Option 3 - Both:
 * userId,email
 * 1234567890,user1@company.com
 * ,user2@company.com
 * 
 * OUTPUT FILES:
 * - removal_log.txt: Detailed processing log
 * - removal_status.csv: Structured status report for each user
 * 
 * STATUS MEANINGS:
 * - "SUCCESSFULLY_REMOVED": User removed, assets transferred
 * - "FAILED" + "Failed due to user not being deactivated": User still active
 * - "USER_NOT_FOUND": User doesn't exist in Smartsheet
 * - "ERROR": Technical error occurred during processing
 * 
 * IMPORTANT NOTES:
 * - This action is PERMANENT and cannot be undone
 * - Always test with a small batch first
 * - Ensure TRANSFER_TO_USER_ID is correct (admin user recommended)
 * - Users must be deactivated BEFORE running this script
 * - Script respects Smartsheet API rate limits (4 requests/second)
 * 
 * ================================================================
 */

const client = require('smartsheet');
const fs = require('fs');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');

// ================================================================
// CONFIGURATION - UPDATE THESE VALUES BEFORE RUNNING
// ================================================================

// Your Smartsheet API access token (requires admin permissions)
// Get this from: https://app.smartsheet.com/b/home -> Account -> Personal Settings -> API Access
const SMARTSHEET_ACCESS_TOKEN = 'YOUR_API_TOKEN_HERE';

// Input CSV file containing users to remove (see format above)
const INPUT_FILE = 'users_to_remove.csv';

// Output files for logging and status reporting
const LOG_FILE = 'removal_log.txt';           // Detailed processing log
const STATUS_FILE = 'removal_status.csv';     // Structured status report

// CRITICAL: User ID to receive transferred assets from removed users
// This should be an admin user who will take ownership of:
// - Sheets, reports, dashboards
// - Workspaces and folders
// - Any other assets owned by removed users
// Find User ID: Admin Center -> User Management -> click user -> URL shows ID
const TRANSFER_TO_USER_ID = 'YOUR_TRANSFER_USER_ID_HERE';

// ================================================================
// SMARTSHEET CLIENT SETUP
// ================================================================

// Initialize Smartsheet API client
const smartsheet = client.createClient({
  accessToken: SMARTSHEET_ACCESS_TOKEN,
  logLevel: 'info' // Set to 'debug' for more detailed API logs
});

// Rate limiting helper - Smartsheet allows 300 requests per minute
// This ensures we stay well under the limit at ~240 requests/minute
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================================================================
// HELPER FUNCTIONS
// ================================================================

/**
 * Get user details by ID to check their status
 * 
 * This function checks if a user exists and gets their current status.
 * User status can be:
 * - ACTIVE: User is active (cannot be removed)
 * - DECLINED: User invitation was declined or user was deactivated (can be removed)
 * - PENDING: User invitation is pending (can be removed)
 * 
 * @param {string} userId - Smartsheet user ID
 * @returns {Object} User status information
 */
async function getUserStatus(userId) {
  try {
    const response = await smartsheet.users.getUser({
      id: userId
    });

    return {
      exists: true,
      status: response.status,
      email: response.email,
      name: `${response.firstName || ''} ${response.lastName || ''}`.trim()
    };
  } catch (error) {
    // Handle specific error cases
    if (error.errorCode === 1006) { // User not found
      return {
        exists: false,
        status: 'NOT_FOUND',
        email: 'Unknown',
        name: 'Unknown'
      };
    }
    // Re-throw other errors to be handled by caller
    throw error;
  }
}
// ================================================================
// MAIN PROCESSING FUNCTION
// ================================================================

/**
 * Main function for bulk removal of users from Smartsheet.
 * 
 * This function processes a CSV file containing user information (userId and/or email)
 * and attempts to remove each user from Smartsheet while transferring their assets
 * to a specified user. The process includes comprehensive logging and status reporting.
 * 
 * The function operates in 5 main steps:
 * 1. Reads and parses the input CSV file
 * 2. Initializes logging with session headers
 * 3. Processes each user (lookup, status check, removal with asset transfer)
 * 4. Generates a detailed CSV status report
 * 5. Finalizes logging and displays summary statistics
 * 
 * Rate limiting is applied between API calls (250ms delay = ~4 requests/second)
 * to comply with Smartsheet API limits.
 * 
 * @async
 * @function main
 * @throws {Error} Exits process with code 1 if input file not found or contains no valid users
 * @returns {Promise<void>} Resolves when all users have been processed
 * 
 * @requires INPUT_FILE - Path to CSV file with userId and/or email columns
 * @requires TRANSFER_TO_USER_ID - User ID to transfer assets to
 * @requires LOG_FILE - Path for detailed processing log
 * @requires STATUS_FILE - Path for CSV status report
 * 
 * @example
 * // Input CSV format:
 * // userId,email
 * // 1234567890,user1@company.com
 * // 9876543210,user2@company.com
 * 
 * @see {@link getUserStatus} For user status checking functionality
 * @see {@link smartsheet.users.removeUser} For the Smartsheet API removal method
 */
async function main() {
  // Display startup information
  console.log('================================================================');
  console.log('SMARTSHEET BULK USER REMOVAL SCRIPT');
  console.log('================================================================');
  console.log(`Input file: ${INPUT_FILE}`);
  console.log(`Transfer assets to user ID: ${TRANSFER_TO_USER_ID}`);
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`Status report: ${STATUS_FILE}`);
  console.log('================================================================\n');
  
  console.log(`Starting bulk user removal for users in ${INPUT_FILE}...`);
  console.log(`Assets will be transferred to user ID: ${TRANSFER_TO_USER_ID}`);
  
  const usersToProcess = [];
  const statusResults = [];

  // ================================================================
  // STEP 1: READ AND PARSE INPUT CSV FILE
  // ================================================================
  
  console.log('\n--- STEP 1: Reading input file ---');
  
  // Check if input file exists
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`ERROR: Input file '${INPUT_FILE}' not found!`);
    console.log('Please create the input file with the following format:');
    console.log('  userId,email');
    console.log('  1234567890,user1@company.com');
    console.log('  9876543210,user2@company.com');
    process.exit(1);
  }
  // Parse CSV file - supports flexible column names
  // Accepts: userId, email, or both columns
  const parser = fs
    .createReadStream(INPUT_FILE)
    .pipe(parse({
      columns: true, // Auto-detect headers from first row
      trim: true,    // Remove whitespace from values
      skip_empty_lines: true // Ignore blank rows
    }));

  // Read each row and extract user information
  for await (const row of parser) {
    // Support both userId and email columns for flexibility
    if (row.userId || row.email) {
      usersToProcess.push({
        userId: row.userId || null,
        email: row.email || null,
        originalRow: row // Keep original data for reference
      });
    }
  }

  if (usersToProcess.length === 0) {
    console.error('ERROR: No valid users found in input file!');
    console.log('Make sure your CSV has either "userId" or "email" columns.');
    process.exit(1);
  }

  console.log(`✅ Loaded ${usersToProcess.length} users from ${INPUT_FILE}`);

  // ================================================================
  // STEP 2: INITIALIZE LOGGING
  // ================================================================
  
  console.log('\n--- STEP 2: Setting up logging ---');
  
  // Create/append to log file with session header
  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  // Write session header to log file
  logStream.write(`\n${'='.repeat(70)}\n`);
  logStream.write(`REMOVAL SESSION STARTED: ${new Date().toISOString()}\n`);
  logStream.write(`Input file: ${INPUT_FILE}\n`);
  logStream.write(`Transfer to user ID: ${TRANSFER_TO_USER_ID}\n`);
  logStream.write(`Total users to process: ${usersToProcess.length}\n`);
  logStream.write(`${'='.repeat(70)}\n`);

  // ================================================================
  // STEP 3: PROCESS EACH USER
  // ================================================================
  
  console.log('\n--- STEP 3: Processing users ---');
  console.log('This may take several minutes depending on the number of users...');
  console.log('(Rate limited to ~4 requests per second for API compliance)\n');
  
  // Initialize counters for final summary
  let successCount = 0;
  let failedCount = 0;
  let notFoundCount = 0;

  // Process each user sequentially with rate limiting
  for (let i = 0; i < usersToProcess.length; i++) {
    const userInfo = usersToProcess[i];
    const userId = userInfo.userId;
    const userIdentifier = userId || userInfo.email;

    console.log(`[${i + 1}/${usersToProcess.length}] Processing user: ${userIdentifier}`);
    
    try {
      // ----------------------------------------------------------------
      // SUBSTEP 3A: Check user status
      // ----------------------------------------------------------------
      
      let userStatus;
      
      if (userId) {
        // Direct lookup by User ID (faster)
        userStatus = await getUserStatus(userId);
      } else {
        // Lookup by email address (requires additional API call with pagination)
        try {
          console.log(`  → Looking up user by email: ${userInfo.email}`);
          
          let foundUser = null;
          let pageNumber = 1;
          let hasMorePages = true;
          
          // Search through all pages to find the user by email
          while (hasMorePages && !foundUser) {
            const users = await smartsheet.users.listUsers({
              queryParameters: { 
                email: userInfo.email,
                pageSize: 100,  // Maximum page size
                page: pageNumber
              }
            });
            
            // Check if we found the user on this page
            if (users.data && users.data.length > 0) {
              foundUser = users.data.find(user => 
                user.email && user.email.toLowerCase() === userInfo.email.toLowerCase()
              );
            }
            
            // Check if there are more pages to search
            hasMorePages = users.totalPages && pageNumber < users.totalPages;
            
            if (hasMorePages && !foundUser) {
              pageNumber++;
              // Short sleep (in milliseconds) between page requests to respect API limits
              await sleep(100);
            }
          }
          
          if (foundUser) {
            userStatus = await getUserStatus(foundUser.id);
            userInfo.userId = foundUser.id; // Update with found ID
            console.log(`  → Found user ID: ${foundUser.id}`);
          } else {
            userStatus = { exists: false, status: 'NOT_FOUND', email: userInfo.email, name: 'Unknown' };
          }
        } catch (error) {
          userStatus = { exists: false, status: 'LOOKUP_FAILED', email: userInfo.email, name: 'Unknown' };
        }
      }

      // ----------------------------------------------------------------
      // SUBSTEP 3B: Prepare status tracking object
      // ----------------------------------------------------------------
      
      // Create detailed status record for each user
      const statusResult = {
        userId: userInfo.userId || 'N/A',
        email: userStatus.email,
        name: userStatus.name,
        originalStatus: userStatus.status,
        action: '',
        status: '',
        timestamp: new Date().toISOString(),
        notes: ''
      };

      // ----------------------------------------------------------------
      // SUBSTEP 3C: Determine action based on user status
      // ----------------------------------------------------------------

      if (!userStatus.exists) {
        // CASE 1: User doesn't exist in Smartsheet
        const msg = `[${i + 1}/${usersToProcess.length}] ❌ USER NOT FOUND: ${userIdentifier}`;
        console.log(msg);
        logStream.write(`${new Date().toISOString()} - ${msg}\\n`);
        
        statusResult.action = 'CHECK_STATUS';
        statusResult.status = 'USER_NOT_FOUND';
        statusResult.notes = 'User does not exist in Smartsheet';
        notFoundCount++;
        
      } else if (userStatus.status !== 'DECLINED' && userStatus.status !== 'PENDING') {
        // CASE 2: User exists but is still active - CANNOT REMOVE
        const msg = `[${i + 1}/${usersToProcess.length}] ⚠️  FAILED: User ${userIdentifier} (${userStatus.status}) - failed due to user not being deactivated`;
        console.error(msg);
        logStream.write(`${new Date().toISOString()} - ${msg}\\n`);
        
        console.log(`  → User must be deactivated before removal. Current status: ${userStatus.status}`);
        
        statusResult.action = 'REMOVE_USER';
        statusResult.status = 'FAILED';
        statusResult.notes = 'Failed due to user not being deactivated';
        failedCount++;
        
      } else {
        // CASE 3: User is deactivated - PROCEED WITH REMOVAL
        console.log(`  → User is deactivated (${userStatus.status}). Proceeding with removal...`);
        
        try {
          // ----------------------------------------------------------------
          // SUBSTEP 3D: Remove user and transfer assets
          // ----------------------------------------------------------------
          
          await smartsheet.users.removeUser({
            id: userInfo.userId,
            queryParameters: {
              transferTo: TRANSFER_TO_USER_ID,  // Transfer ownership
              removeFromSharing: true          // Remove from shared items
            }
          });

          const msg = `[${i + 1}/${usersToProcess.length}] ✅ SUCCESS: User ${userIdentifier} successfully removed`;
          console.log(msg);
          console.log(`  → Assets transferred to user ID: ${TRANSFER_TO_USER_ID}`);
          logStream.write(`${new Date().toISOString()} - ${msg}\\n`);
          
          statusResult.action = 'REMOVE_USER';
          statusResult.status = 'SUCCESSFULLY_REMOVED';
          statusResult.notes = `Assets transferred to user ID ${TRANSFER_TO_USER_ID}`;
          successCount++;
          
        } catch (removeError) {
          // Handle removal API errors
          const errorMsg = removeError.message || JSON.stringify(removeError);
          const msg = `[${i + 1}/${usersToProcess.length}] ❌ REMOVAL FAILED: User ${userIdentifier} - ${errorMsg}`;
          console.error(msg);
          logStream.write(`${new Date().toISOString()} - ${msg}\\n`);
          
          statusResult.action = 'REMOVE_USER';
          statusResult.status = 'FAILED';
          statusResult.notes = `Removal error: ${errorMsg}`;
          failedCount++;
        }
      }

      statusResults.push(statusResult);

    } catch (error) {
      // Handle unexpected errors during processing
      const errorMsg = error.message || JSON.stringify(error);
      const msg = `[${i + 1}/${usersToProcess.length}] ❌ ERROR: User ${userIdentifier} - ${errorMsg}`;
      console.error(msg);
      logStream.write(`${new Date().toISOString()} - ${msg}\\n`);
      
      statusResults.push({
        userId: userInfo.userId || 'N/A',
        email: userInfo.email || 'Unknown',
        name: 'Unknown',
        originalStatus: 'ERROR',
        action: 'CHECK_STATUS',
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        notes: `Processing error: ${errorMsg}`
      });
      
      failedCount++;
    }

    // ----------------------------------------------------------------
    // SUBSTEP 3E: Rate limiting pause
    // ----------------------------------------------------------------
    
    // Pause between API calls to respect Smartsheet rate limits
    // 250ms = ~4 requests/second = 240 requests/minute (well under 300/min limit)
    await sleep(250);
  }
  // ================================================================
  // STEP 4: GENERATE STATUS REPORT CSV
  // ================================================================
  
  console.log('\\n--- STEP 4: Generating status report ---');
  console.log(`Writing detailed status report to: ${STATUS_FILE}`);
  
  // Generate CSV with comprehensive status information for each user
  const csvOutput = stringify(statusResults, {
    header: true,
    columns: [
      { key: 'userId', header: 'User ID' },
      { key: 'email', header: 'Email' },
      { key: 'name', header: 'Name' },
      { key: 'originalStatus', header: 'Original Status' },
      { key: 'action', header: 'Action Attempted' },
      { key: 'status', header: 'Result Status' },
      { key: 'timestamp', header: 'Processed At' },
      { key: 'notes', header: 'Notes' }
    ]
  });

  // Write status report to file
  fs.writeFileSync(STATUS_FILE, csvOutput);

  // ================================================================
  // STEP 5: FINALIZE LOGGING AND DISPLAY SUMMARY
  // ================================================================
  
  // Write session summary to log file
  logStream.write(`\\n${'='.repeat(70)}\\n`);
  logStream.write(`REMOVAL SESSION COMPLETED: ${new Date().toISOString()}\\n`);
  logStream.write(`Total Processed: ${usersToProcess.length}\\n`);
  logStream.write(`Successfully Removed: ${successCount}\\n`);
  logStream.write(`Failed Removals: ${failedCount}\\n`);
  logStream.write(`Users Not Found: ${notFoundCount}\\n`);
  logStream.write(`Status Report: ${STATUS_FILE}\\n`);
  logStream.write(`${'='.repeat(70)}\\n`);
  logStream.close();

  // Display final summary to console
  console.log('\\n================================================================');
  console.log('PROCESSING COMPLETE');
  console.log('================================================================');
  console.log(`Total Processed: ${usersToProcess.length}`);
  console.log(`✅ Successfully Removed: ${successCount}`);
  console.log(`❌ Failed Removals: ${failedCount}`);
  console.log(`❓ Users Not Found: ${notFoundCount}`);
  console.log('');
  console.log('📄 Output Files:');
  console.log(`   Detailed status report: ${STATUS_FILE}`);
  console.log(`   Full processing log: ${LOG_FILE}`);
  console.log('');
  
  if (failedCount > 0) {
    console.log('⚠️  Some users could not be removed. Common reasons:');
    console.log('   • User is still active (must be deactivated first)');
    console.log('   • User has active shares that prevent removal');
    console.log('   • API permission issues');
    console.log(`   Check ${STATUS_FILE} for specific details.`);
  }
  
  if (successCount > 0) {
    console.log(`✅ ${successCount} users successfully removed.`);
    console.log(`   All assets transferred to user ID: ${TRANSFER_TO_USER_ID}`);
  }
  
  console.log('================================================================\\n');
}

// ================================================================
// ERROR HANDLING AND SCRIPT EXECUTION
// ================================================================

// Handle unhandled promise rejections gracefully
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Script terminated due to unexpected error.');
  process.exit(1);
});

// Execute main function with error handling
main().catch(error => {
  console.error('❌ Fatal error occurred:', error);
  console.error('Script terminated. Check the error message above for details.');
  process.exit(1);
});

// ================================================================
// END OF SCRIPT
// ================================================================