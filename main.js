const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const config = require('./config.json');
const discordManager = require('./discord_manager');
const { ScrapeData } = require('./scrape');
const { logTask } = require('./utils');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fs = require('fs-extra');
const path = require('path');
const webhook = require('./webhook');
const yargs = require('yargs');

// Initialize Puppeteer plugins
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Configuration
let taskCounter = 0;
let processedMessageIds = new Set(); // <<< Define at module scope

// Parse command line arguments
const args = process.argv.slice(2);
let channelUrlArg = null;
let targetChannelsArg = [];
let isHeadless = false; // Default to non-headless mode
let taskId = null;
let profileId = null;
let enableRegularMessages = false; // <-- Initialize new flag (default false)

console.log('Command line arguments:', args); // Debug log

// First check for headless flag specifically
if (args.includes('--headless')) {
  isHeadless = true;
  console.log('Headless flag detected in arguments'); // Debug log
}

// Check for enable-regular-messages flag
if (args.includes('--enable-regular-messages')) { // <-- Check for new flag
  enableRegularMessages = true;
  console.log('Enable Regular Messages flag detected in arguments'); 
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--channel' && i + 1 < args.length) {
    channelUrlArg = args[i + 1];
    i++;
  } else if (args[i] === '--targets' && i + 1 < args.length) {
    targetChannelsArg = args[i + 1].split(',');
    i++;
  } else if (args[i] === '--task-id' && i + 1 < args.length) {
    taskId = args[i + 1];
    i++;
  } else if (args[i] === '--profile' && i + 1 < args.length) {
    profileId = args[i + 1];
    i++;
  }
}

console.log('Parsed isHeadless value:', isHeadless); // Debug log
console.log('Parsed enableRegularMessages value:', enableRegularMessages); // <-- Log parsed value

// Helper function to generate task ID
function generateTaskId() {
    taskCounter++;
    return `TASK_${taskCounter.toString().padStart(4, '0')}`;
}

// Helper function to clean Nike URLs
function cleanNikeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Remove all query parameters except essential ones
        const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;
        return cleanUrl;
    } catch (error) {
        return url;
    }
}

// Helper function to check if URL is valid for Mavely
function isValidBrandUrl(url) {
    const validDomains = [
        'nike.com',
        'adidas.com',
        'amazon.com',
        // Add other supported domains as needed
    ];
    
    try {
        const urlObj = new URL(url.toLowerCase());
        return validDomains.some(domain => urlObj.hostname.includes(domain));
    } catch {
        return false;
    }
}

// Helper function to process embed values
async function processEmbedValue(value, taskId) {
    // If URL unshortening is disabled, return the original value
    if (!ENABLE_URL_UNSHORTENING) {
        logTask(taskId, 'INFO', 'URL unshortening is disabled, skipping URL processing');
        return value;
    }

    // Only proceed with URL processing if Mavely is initialized
    if (!mavelyManager || !mavelyManager.isInitialized) {
        logTask(taskId, 'INFO', 'Mavely is not initialized, skipping URL processing');
        return value;
    }

    const urlRegex = /\[.*?\]\((.*?)\)|(?:https?:\/\/[^\s<>)"']+[^\s.,;!?)<>'"])/g;
    const matches = [...value.matchAll(urlRegex)];
    let modifiedValue = value;

    // First, validate all URLs and collect only valid brand URLs
    const validUrls = [];
    for (const match of matches) {
        const originalUrl = match[1] || match[0];
        try {
            // Debug Nike URLs
            if (originalUrl.toLowerCase().includes('nike.com')) {
                logTask(taskId, 'INFO', `Processing Nike URL: ${originalUrl}`);
                // Clean the Nike URL first
                const cleanedUrl = cleanNikeUrl(originalUrl);
                logTask(taskId, 'INFO', `Cleaned Nike URL: ${cleanedUrl}`);
            }
            
            const urlToCheck = ENABLE_URL_UNSHORTENING ? await unshorten(originalUrl) : originalUrl;
            const cleanedUrlToCheck = urlToCheck.toLowerCase().includes('nike.com') ? cleanNikeUrl(urlToCheck) : urlToCheck;
            
            // Debug unshortened Nike URLs
            if (cleanedUrlToCheck.toLowerCase().includes('nike.com')) {
                logTask(taskId, 'INFO', `Cleaned unshortened Nike URL: ${cleanedUrlToCheck}`);
            }
            
            // Validate URL before trying Mavely
            if (mavelyManager && mavelyManager.isValidBrandUrl(cleanedUrlToCheck)) {
                // Try to generate a Mavely link
                const testLink = await mavelyManager.generateMavelyLink(cleanedUrlToCheck);
                
                // Debug Mavely response for Nike URLs
                if (cleanedUrlToCheck.toLowerCase().includes('nike.com')) {
                    logTask(taskId, 'INFO', `Mavely response for Nike URL: ${testLink || 'null'}`);
                }
                
                if (testLink) {
                    validUrls.push({
                        originalUrl,
                        unshortenedUrl: cleanedUrlToCheck,
                        fullMatch: match[0],
                        isMarkdown: !!match[1]
                    });
                    if (cleanedUrlToCheck.toLowerCase().includes('nike.com')) {
                        logTask(taskId, 'SUCCESS', `Nike URL validated and added to processing queue`);
                    }
                } else if (cleanedUrlToCheck.toLowerCase().includes('nike.com')) {
                    logTask(taskId, 'WARNING', `Nike URL failed validation: ${cleanedUrlToCheck}`);
                }
            }
        } catch (error) {
            if (originalUrl.toLowerCase().includes('nike.com')) {
                logTask(taskId, 'ERROR', `Error processing Nike URL: ${originalUrl}`, error);
            } else {
                logTask(taskId, 'ERROR', 'Error processing URL', error);
            }
        }
    }

    // Then, process only valid URLs with Mavely
    for (const urlData of validUrls) {
        let retryCount = 0;
        let mavelyUrl = null;
        
        // Debug Nike URLs in processing
        const isNikeUrl = urlData.unshortenedUrl.toLowerCase().includes('nike.com');
        if (isNikeUrl) {
            logTask(taskId, 'INFO', `Attempting to generate Mavely link for Nike URL: ${urlData.unshortenedUrl}`);
        }
        
        while (retryCount < MAVELY_RETRY_COUNT) {
            try {
                logTask(taskId, 'INFO', `Attempt ${retryCount + 1}/${MAVELY_RETRY_COUNT} to generate Mavely link for: ${urlData.unshortenedUrl}`);
                mavelyUrl = await mavelyManager.generateMavelyLink(urlData.unshortenedUrl);
                
                if (isNikeUrl) {
                    logTask(taskId, 'INFO', `Nike URL attempt ${retryCount + 1} result: ${mavelyUrl || 'null'}`);
                }
                
                if (mavelyUrl) {
                    logTask(taskId, 'SUCCESS', `Generated Mavely link on attempt ${retryCount + 1}`);
                    if (isNikeUrl) {
                        logTask(taskId, 'SUCCESS', `Successfully generated Mavely link for Nike URL: ${mavelyUrl}`);
                    }
                    break; // Success, exit retry loop
                }
                
                retryCount++;
                if (retryCount < MAVELY_RETRY_COUNT) {
                    logTask(taskId, 'INFO', `Retrying in ${MAVELY_RETRY_DELAY}ms`);
                    await delay(MAVELY_RETRY_DELAY);
                    continue;
                }
            } catch (error) {
                if (isNikeUrl) {
                    logTask(taskId, 'ERROR', `Error generating Mavely link for Nike URL on attempt ${retryCount + 1}`, error);
                } else {
                    logTask(taskId, 'ERROR', `Error on attempt ${retryCount + 1}`, error);
                }
                break;
            }
        }

        if (mavelyUrl) {
            if (urlData.isMarkdown) {
                const linkText = urlData.fullMatch.match(/\[(.*?)\]/)[1];
                const newLink = `[${linkText}](${mavelyUrl})`;
                modifiedValue = modifiedValue.replace(urlData.fullMatch, newLink);
            } else {
                modifiedValue = modifiedValue.replace(urlData.fullMatch, mavelyUrl);
            }
        } else if (isNikeUrl) {
            logTask(taskId, 'WARNING', `Failed to generate Mavely link for Nike URL after ${MAVELY_RETRY_COUNT} attempts`);
        }
    }

    return modifiedValue;
}

// Helper function to process embeds with Mavely links
async function processMavelyLinks(embedArray, taskId) {
    const processedEmbeds = [];
    
    for (const embed of embedArray) {
        const processedEmbed = { ...embed };
        processedEmbed.value = await processEmbedValue(embed.value, taskId);
        processedEmbeds.push(processedEmbed);
    }
    
    return processedEmbeds;
}

// Helper function to unshorten URL
async function unshorten(url) {
    // Always unshorten if URL contains 'affiliate' or 'eldenmonitors'
    if (url.toLowerCase().includes('affiliate') || url.toLowerCase().includes('eldenmonitors')) {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow'
            });
            return response.url;
        } catch (error) {
            return url;
        }
    }

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow'
        });
        return response.url;
    } catch (error) {
        throw new Error(`Failed to unshorten URL: ${error.message}`);
    }
}

// Launch a browser instance for a task
async function launchBrowser(profileId, headless = false) {
    const taskId = generateTaskId();
    // Force headless to be a boolean
    headless = headless === true;
    
    console.log('launchBrowser called with headless:', headless); // Debug log
    logTask(taskId, 'INFO', `Launching browser (Profile: ${profileId}, Headless: ${headless})`);
    
    try {
        const launchOptions = {
            headless: headless === true ? 'new' : false, // Ensure strict boolean comparison
            defaultViewport: null,
            userDataDir: `./${profileId}`,
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disk-cache-size=0'
            ]
        };
        
        console.log('Puppeteer launch options:', JSON.stringify(launchOptions, null, 2)); // Enhanced debug log
        const browser = await puppeteer.launch(launchOptions);
        
        logTask(taskId, 'SUCCESS', `Browser launched successfully in ${headless ? 'headless' : 'headed'} mode`);
        return browser;
    } catch (error) {
        logTask(taskId, 'ERROR', 'Failed to launch browser', error);
        throw error;
    }
}

// Monitor a Discord channel
async function monitorChannel(browser, channelUrl, targetChannels, taskId, enableRegularMessages, isTestingModule) {
    let page;
    let scrollIntervalId = null; // Variable to hold the interval ID
    try {
        logTask(taskId, 'INFO', `Starting monitoring for ${channelUrl}`);
        logTask(taskId, 'INFO', `Regular message processing: ${enableRegularMessages ? 'ENABLED' : 'DISABLED'}`);

        // Get existing pages (usually just the initial blank tab)
        const pages = await browser.pages();
        if (pages.length > 0) {
            page = pages[0]; // Use the first page
            logTask(taskId, 'DEBUG', 'Using the initial browser tab.');
        } else {
            // Fallback: Create a new page if none exist (shouldn't normally happen)
            logTask(taskId, 'WARNING', 'No initial pages found, creating a new one.');
            page = await browser.newPage();
        }
        
        await page.setViewport({ width: 1920, height: 1080 }); // Use a common desktop resolution

        logTask(taskId, 'INFO', `Navigating to ${channelUrl}`);
        await page.goto(channelUrl, { waitUntil: ['load', 'domcontentloaded', 'networkidle0'], timeout: 60000 });
        logTask(taskId, 'SUCCESS', `Navigation complete for ${channelUrl}`);

        // --- Focus on message list before scrolling ---
        try {
            const messageListSelector = 'ol[aria-label*="Messages in"]';
            logTask(taskId, 'INFO', `Waiting for message list element: ${messageListSelector}`);
            await page.waitForSelector(messageListSelector, { timeout: 15000 }); // Wait up to 15s
            logTask(taskId, 'INFO', `Found message list element, attempting to focus.`);
            await page.focus(messageListSelector);
            logTask(taskId, 'SUCCESS', 'Successfully focused on the message list.');
        } catch (error) {
            logTask(taskId, 'WARNING', `Could not find or focus message list element: ${error.message}. Scrolling might not work as expected.`);
            // Continue even if focus fails, scrolling might still work
        }
        // --- End focus logic ---

        // --- Start periodic scrolling ---
        scrollIntervalId = setInterval(async () => {
            if (page && !page.isClosed()) {
                try {
                    logTask(taskId, 'DEBUG', 'Pressing "End" key to scroll down.');
                    await page.keyboard.press('End');
                } catch (error) {
                    logTask(taskId, 'WARNING', `Error pressing "End" key: ${error.message}`);
                    // Optional: Clear interval if key press consistently fails?
                    // if (scrollIntervalId) clearInterval(scrollIntervalId);
                }
            } else {
                logTask(taskId, 'DEBUG', 'Page closed or not available, stopping scroll interval.');
                if (scrollIntervalId) clearInterval(scrollIntervalId); // Stop if page is gone
            }
        }, 60000); // Press End every 1 minute
        // --- End periodic scrolling ---

        const MAX_PROCESSED_IDS = 50; // Keep track of the last 50 processed messages
        let cycleCount = 0;
        let lastSuccessfulScrapeTime = null;
        let isFirstRun = true;

        while (true) {
            cycleCount++;
            try {
                logTask(taskId, 'DEBUG', `Starting monitoring cycle #${cycleCount}`);

                const scrapedMessages = await ScrapeData(page, enableRegularMessages);
                const now = new Date();

                // Scroll logic (keep as is)
                // ... existing code ...

                 // Log basic scrape results
                 logTask(taskId, 'DEBUG', 'Scrape results:', {
                     cycle: cycleCount,
                     messagesFound: scrapedMessages ? scrapedMessages.length : 0,
                     processedSetSize: processedMessageIds.size,
                     timeSinceLastSuccess: lastSuccessfulScrapeTime ?
                         `${(now - lastSuccessfulScrapeTime) / 1000}s ago` : 'never'
                 });

                // Check if scrape was successful and returned messages
                // ... existing code ...

                // Scrape was successful, update timestamp
                lastSuccessfulScrapeTime = now;
                let newMessagesProcessedThisCycle = 0;

                // First run logic: Populate processed IDs without sending webhooks
                if (isFirstRun) {
                    logTask(taskId, 'INFO', 'First run: Populating initial message IDs without sending webhooks.');
                    for (const messageData of scrapedMessages) {
                        if (messageData.messageId) {
                            processedMessageIds.add(messageData.messageId);
                        }
                    }
                    logTask(taskId, 'INFO', `First run complete. Initial processed ID count: ${processedMessageIds.size}`);
                    isFirstRun = false; // Mark first run as complete
                    // Skip further processing in this cycle after populating IDs
                    await delay(1000); // Add the standard delay before next cycle
                    continue; // Go to the next iteration of the while(true) loop
                }

                // Iterate through the found messages (only runs if not the first run)
                for (const messageData of scrapedMessages) {
                    const { messageId, regularMessage, embedArray } = messageData;

                    // Skip if message ID is missing
                    if (!messageId) {
                        logTask(taskId, 'WARNING', 'Scraped message data is missing messageId. Skipping.', messageData);
                        continue;
                    }

                    // Check if already processed
                    if (processedMessageIds.has(messageId)) {
                        logTask(taskId, 'DEBUG', `Message ${messageId} already processed. Skipping.`);
                        continue; // Skip this message
                    }

                    // --- Check for "Jump to Present" bar (example placeholder) ---
                    // if (messageIsJumpToPresentBar) { ... continue; }

                    // --- Process New Message (if not processed and not first run) ---
                    logTask(taskId, 'INFO', `Processing new message ${messageId}`);
                    newMessagesProcessedThisCycle++;

                    // Handle regular messages (this logic correctly uses the passed enableRegularMessages)
                    if (regularMessage) {
                        if (enableRegularMessages) {
                            logTask(taskId, 'INFO', `Processing regular message ${messageId}:`, {
                                username: regularMessage.username,
                                contentLength: regularMessage.content.length,
                                hasAttachments: !!regularMessage.attachments
                            });
                            // Loop through target channels for regular messages
                            for (const channelName of targetChannels) {
                                const channelConfig = config.discord.channels.find(c => c.name === channelName);
                                if (channelConfig) {
                                    logTask(taskId, 'INFO', `Sending regular message ${messageId} to channel: ${channelName}`);
                                    try {
                                        await webhook.sendRegularMessage(regularMessage, channelConfig.webhook_url, isTestingModule); // Pass flag
                                        logTask(taskId, 'SUCCESS', `Regular message ${messageId} sent to channel: ${channelName}`);
                                    } catch (error) {
                                        logTask(taskId, 'ERROR', `Error sending regular message ${messageId} to ${channelName}: ${error?.message}`, error);
                                    }
                                } else {
                                    logTask(taskId, 'WARNING', `Channel config not found for regular message target: ${channelName}`);
                                }
                            }
                        } else {
                            logTask(taskId, 'INFO', `Regular message ${messageId} detected, but processing is disabled by flag.`);
                        }
                    }
                    // Handle embeds
                    else if (embedArray && embedArray.length > 0) {
                        logTask(taskId, 'INFO', `Processing ${embedArray.length} embeds for message ${messageId}`);

                        // Loop through target channels
                        for (const channelName of targetChannels) {
                            logTask(taskId, 'DEBUG', `Looping target channel: ${channelName}`);
                            
                            logTask(taskId, 'DEBUG', `Searching config for channel: ${channelName}`);
                            const channelConfig = config.discord.channels.find(c => c.name === channelName);
                            logTask(taskId, 'DEBUG', `Found config for ${channelName}: ${!!channelConfig}`);
                            
                            if (channelConfig) {
                                logTask(taskId, 'INFO', `Sending embeds for ${messageId} to channel: ${channelName}`); 
                                try {
                                    logTask(taskId, 'DEBUG', `Attempting webhook.buildWebhook for ${channelName}`);
                                    await webhook.buildWebhook(embedArray, channelConfig.webhook_url, isTestingModule); // Pass flag
                                    logTask(taskId, 'DEBUG', `Completed webhook.buildWebhook for ${channelName}`);
                                    logTask(taskId, 'SUCCESS', `Embeds for ${messageId} sent to channel: ${channelName}`);
                                } catch (error) {
                                    // This catch block in main.js should now catch errors re-thrown from buildWebhook
                                    logTask(taskId, 'ERROR', `Error sending embeds for ${messageId} to ${channelName}: ${error?.message}`, error);
                                }
                            } else {
                                logTask(taskId, 'WARNING', `Channel config not found for: ${channelName}`);
                            }
                            logTask(taskId, 'DEBUG', `Finished processing target channel: ${channelName}`);
                        } // End for loop targetChannels
                        logTask(taskId, 'DEBUG', `Finished looping through all target channels for message ${messageId}`);
                    }
                    else {
                        logTask(taskId, 'WARNING', `Message ${messageId} has neither regular content nor embeds.`);
                    }

                    // Add to processed set
                    processedMessageIds.add(messageId);
                    // Maintain the size of the processed set
                    // ... existing code ...
                    // --- End Process New Message ---
                } // End for loop scrapedMessages

                if (newMessagesProcessedThisCycle === 0) {
                    logTask(taskId, 'DEBUG', 'No new messages found in the scraped batch this cycle.');
                }

                // Add a small delay between cycles
                await delay(1000);

            } catch (error) {
                logTask(taskId, 'ERROR', `Error in monitoring cycle #${cycleCount}: ${error.message}`, error);
                 // Log page state on error for debugging
                if (page && !page.isClosed()) {
                    try {
                        const pageUrl = page.url();
                        const pageTitle = await page.title();
                        const pageContent = await page.content(); // Get HTML content
                        logTask(taskId, 'DEBUG', 'Page state during error:', { url: pageUrl, title: pageTitle });
                        // Avoid logging potentially huge HTML content unless necessary and truncated
                        // logTask(taskId, 'DEBUG', `Page HTML (first 1000 chars): ${pageContent.substring(0, 1000)}`);
                    } catch (debugError) {
                        logTask(taskId, 'ERROR', 'Failed to get page state during error handling.', debugError);
                    }
                }
                await delay(5000); // Longer delay on error
            }
        }
    } catch (error) {
        logTask(taskId, 'ERROR', `Fatal error in monitorChannel: ${error.message}`, error);
        // Ensure browser is closed even on fatal error before throwing
        if (browser && browser.isConnected()) {
             try { await browser.close(); } catch (e) { logTask(taskId, 'ERROR', 'Error closing browser on fatal error.', e); }
        }
        throw error; // Re-throw to allow PM2 to handle restart if configured
    } finally {
         // --- Clear scroll interval ---
         if (scrollIntervalId) {
             clearInterval(scrollIntervalId);
             logTask(taskId, 'INFO', 'Cleared scroll interval.');
         }
         // --- End clear scroll interval ---

         // Ensure page is closed if it exists and isn't already closed
         if (page && !page.isClosed()) {
             try { await page.close(); } catch(e) { logTask(taskId, 'WARNING', 'Error closing page in finally block.', e); }
         }
         logTask(taskId, 'INFO', 'Monitor channel function finally block reached.');
         // Don't close the browser here if the error is outside the main loop, let the main() function handle it
    }
}

// Main function
async function main() {
    // Store all browser instances launched
    const browsers = [];

    // Use yargs for command-line arguments
    const argv = yargs(process.argv.slice(2))
        .option('channel', {
            alias: 'c',
            describe: 'Discord channel URL to monitor',
            type: 'string'
        })
        .option('targets', {
            alias: 't',
            describe: 'Comma-separated list of target channel names (from config.json)',
            type: 'string'
        })
        .option('task-id', {
            describe: 'Unique ID for this monitoring task',
            type: 'string'
        })
        .option('profile', {
            alias: 'p',
            describe: 'Profile directory path for the browser instance',
            type: 'string'
        })
        .option('headless', {
            describe: 'Run browser in headless mode',
            type: 'boolean',
            default: false // Default to non-headless if not specified
        })
        .option('enable-url-unshortening', {
            describe: 'Enable URL unshortening feature',
            type: 'boolean',
            default: false // Default to disabled
        })
        .option('enable-regular-messages', {
            describe: 'Enable processing of regular messages (not just embeds)',
            type: 'boolean',
            default: false
        })
        .option('testing-mode', { // Add new argument
            describe: 'Run in testing mode (skip webhook sends)',
            type: 'boolean',
            default: false
        })
        .demandOption(['channel', 'targets', 'task-id', 'profile'], 'Please provide all required arguments')
        .help()
        .argv;

    // Extract arguments
    const channelUrl = argv.channel;
    const targetChannels = argv.targets.split(',').map(t => t.trim()).filter(t => t);
    const taskId = argv['task-id'];
    const profileId = argv.profile;
    const headless = argv.headless;
    const enableUrlUnshortening = argv['enable-url-unshortening']; // Use bracket notation
    const enableRegularMessages = argv.enableRegularMessages;
    const isTestingModule = argv.testingMode; // Get the testing mode flag

    // Always start with an empty set for each run/restart
    processedMessageIds = new Set();
    logTask(taskId, 'INFO', 'Initialized with an empty processed message ID set for this run.');

    // Validate inputs (basic)
    if (!channelUrl || !targetChannels.length || !taskId || !profileId) {
        console.error('Error: Missing required arguments.');
        logTask(taskId || 'UNKNOWN', 'ERROR', 'Missing required arguments.', argv); // Log provided args if possible
        process.exit(1);
    }

     logTask(taskId, 'INFO', `Received task arguments:`, { // Log parsed arguments
         channelUrl,
         targets: targetChannels,
         taskId,
         profile: profileId,
         headless,
         enableUrlUnshortening,
         enableRegularMessages,
         isTestingModule // Include in log
     });

    let browser;
    try {
        // Launch browser with specified profile and headless mode
        logTask(taskId, 'INFO', `Launching browser with profile: ${profileId}, Headless: ${headless}`);
        browser = await launchBrowser(profileId, headless);
        browsers.push(browser); // Add to array for cleanup
        logTask(taskId, 'SUCCESS', 'Browser launched successfully.');

        // Start monitoring
        logTask(taskId, 'INFO', `Starting monitoring for ${channelUrl}`);
        // Pass the enableRegularMessages value to monitorChannel
        await monitorChannel(browser, channelUrl, targetChannels, taskId, enableRegularMessages, isTestingModule); // <<< Pass argument here

    } catch (error) {
        logTask(taskId || 'MAIN_ERROR', 'ERROR', 'Critical error during browser launch or monitor initiation.', error);
        console.error(`Critical error in main function: ${error.message}`);
        // Attempt cleanup even on critical failure
        for (const b of browsers) {
            if (b && b.isConnected()) {
                try { await b.close(); } catch (e) { console.error('Error closing browser during critical error handling:', e); }
            }
        }
        process.exit(1); // Exit with error code
    }

    // --- Graceful Shutdown Handling ---
    const gracefulShutdown = async (signal) => {
        logTask(taskId || 'SYSTEM', 'INFO', `Received signal: ${signal}. Shutting down gracefully...`);
        console.log(`
Received signal: ${signal}. Shutting down gracefully...`);

        // --- Save Processed Message IDs ---
        const processedIdsFilePath = path.join(__dirname, `processed_ids_${taskId}.json`); // Define path here too
        try {
            const idsToSave = Array.from(processedMessageIds);
            fs.writeJsonSync(processedIdsFilePath, idsToSave, { spaces: 2 });
            logTask(taskId || 'SYSTEM', 'INFO', `Saved ${idsToSave.length} processed message IDs to ${processedIdsFilePath}`);
        } catch (error) {
            logTask(taskId || 'SYSTEM', 'ERROR', `Failed to save processed IDs to ${processedIdsFilePath}`, error);
        }
        // --- End Save ---

        // Close all browsers
        for (const b of browsers) {
            if (b && b.isConnected()) {
                try {
                    logTask(taskId || 'SYSTEM', 'INFO', `Closing browser PID: ${b.process()?.pid}`);
                    await b.close();
                    logTask(taskId || 'SYSTEM', 'INFO', 'Browser closed.');
                } catch (err) {
                    logTask(taskId || 'SYSTEM', 'ERROR', 'Error closing browser during shutdown:', err);
                    console.error('Error closing browser during shutdown:', err);
                }
            }
        }
        logTask(taskId || 'SYSTEM', 'INFO', 'Graceful shutdown complete.');
        console.log('Graceful shutdown complete.');
        process.exit(0); // Exit cleanly
    };

    // Listen for termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Keep the script running (PM2 handles restarts, this is mainly for direct node execution)
    // If monitorChannel exits unexpectedly, the script might end unless kept alive.
    // However, the current structure with awaits means it stays alive until monitorChannel finishes/errors.
    logTask(taskId || 'SYSTEM', 'INFO', 'Main function finished setup. Monitoring process running.');
    // Optional: Add a mechanism here if monitorChannel could exit cleanly and you want the script to stay alive.
    // For now, we assume PM2 handles keeping the process running/restarting.
}

// Start the main execution
main().catch(error => {
    console.error(`Unhandled error in main execution: ${error.message}`);
    logTask('GLOBAL_CATCH', 'ERROR', 'Unhandled error in main execution', error);
    process.exit(1); // Exit with error code for unhandled issues
});

// Add unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log the reason, which might be the 'undefined' error we saw
  logTask('UNHANDLED_REJECTION', 'ERROR', `Unhandled Rejection: ${reason}`, { promise });
  // Optionally exit or let PM2 handle it
  // process.exit(1);
});
// Add uncaught exception handler
process.on('uncaughtException', (error, origin) => {
  console.error('Uncaught Exception:', error, 'Origin:', origin);
  logTask('UNCAUGHT_EXCEPTION', 'ERROR', `Uncaught Exception: ${error.message}`, { origin, error });
  // It's generally recommended to exit after an uncaught exception
  process.exit(1);
});
