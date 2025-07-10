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
let enableRegularMessages = false;
let enableUrlUnshorteningGlobal = false; // For the original processEmbedValue
let enableAffiliateLinksGlobal = false; // For Mavely affiliation

console.log('Command line arguments:', args); // Debug log

// Use yargs for more robust argument parsing
const argv = require('yargs')(args)
    .option('channel', {
        alias: 'c',
        describe: 'Discord channel URL to monitor',
        type: 'string',
        demandOption: true
    })
    .option('targets', {
        alias: 't',
        describe: 'Comma-separated list of target channel names',
        type: 'string',
        demandOption: true
    })
    .option('task-id', {
        describe: 'Unique ID for this monitoring task',
        type: 'string',
        demandOption: true
    })
    .option('profile', {
        alias: 'p',
        describe: 'Profile directory path for the browser instance',
        type: 'string',
        demandOption: true
    })
    .option('headless', {
        describe: 'Run browser in headless mode',
        type: 'boolean',
        default: false
    })
    .option('enable-url-unshortening', {
        describe: 'Enable URL unshortening feature',
        type: 'boolean',
        default: false
    })
    .option('enable-regular-messages', {
        describe: 'Enable processing of regular messages',
        type: 'boolean',
        default: false
    })
    .option('testing-mode', {
        describe: 'Run in testing mode (skip webhook sends)',
        type: 'boolean',
        default: false
    })
    .option('enable-affiliate-links', { 
        describe: 'Enable Mavely affiliate link generation',
        type: 'boolean',
        default: false 
    })
    .option('enable-tweeting', {
        describe: 'Enable tweet integration',
        type: 'boolean',
        default: false
    })
    .option('tweet-keywords', {
        describe: 'Tweet keywords for filtering',
        type: 'string',
        default: ''
    })
    .help()
    .argv;

// Assign parsed arguments to global variables
channelUrlArg = argv.channel;
targetChannelsArg = argv.targets.split(',').map(t => t.trim()).filter(t => t);
isHeadless = argv.headless;
taskId = argv['task-id'];
profileId = argv.profile;
enableRegularMessages = argv.enableRegularMessages;
enableUrlUnshorteningGlobal = argv['enable-url-unshortening'];
enableAffiliateLinksGlobal = argv.enableAffiliateLinks;
const isTestingModuleGlobal = argv.testingMode;
const enableTweetingGlobal = argv.enableTweeting;
const tweetKeywordsGlobal = argv.tweetKeywords;

console.log('Parsed isHeadless value:', isHeadless);
console.log('Parsed enableRegularMessages value:', enableRegularMessages);
console.log('Parsed enableUrlUnshorteningGlobal value:', enableUrlUnshorteningGlobal);
console.log('Parsed enableAffiliateLinksGlobal value:', enableAffiliateLinksGlobal);
console.log('Parsed isTestingModuleGlobal value:', isTestingModuleGlobal);
console.log('Parsed enableTweetingGlobal value:', enableTweetingGlobal);
console.log('Parsed tweetKeywordsGlobal value:', tweetKeywordsGlobal);

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

// Helper function to process embed values (original for unshortening)
async function processEmbedValue(value, taskId) {
    // If URL unshortening is disabled by global flag, return the original value
    if (!enableUrlUnshorteningGlobal) {
        logTask(taskId, 'INFO', 'Global URL unshortening is disabled, skipping URL processing in processEmbedValue');
        return value;
    }

    // Corrected Regex for matching markdown and plain URLs
    const urlRegex = /\[(.*?)\]\((.*?)\)|(https?:\/\/[^\s<>)\"\']+[^\s.,;!?)<>\'\"]+)/g;
    const matches = [...value.matchAll(urlRegex)];
    let modifiedValue = value;

    // Collect URLs to potentially unshorten
    const urlsToProcess = [];
    for (const match of matches) {
        const originalUrl = match[2] || match[3]; // URL from markdown OR plain URL
        urlsToProcess.push({ 
            originalUrl,
            fullMatch: match[0],
            isMarkdown: !!match[1] 
        });
    }

    // Process collected URLs (unshorten/clean)
    for (const urlData of urlsToProcess) {
        try {
            const urlToCheck = await unshorten(urlData.originalUrl);
            const cleanedUrlToCheck = urlToCheck.toLowerCase().includes('nike.com') ? cleanNikeUrl(urlToCheck) : urlToCheck;

            // If the URL changed after unshortening/cleaning, replace it in the modifiedValue
            if (cleanedUrlToCheck !== urlData.originalUrl) {
                if (urlData.isMarkdown) {
                    const linkText = urlData.fullMatch.match(/\[(.*?)\]/)[1];
                    const newLink = `[${linkText}](${cleanedUrlToCheck})`;
                    modifiedValue = modifiedValue.replace(urlData.fullMatch, newLink);
                } else {
                    modifiedValue = modifiedValue.replace(urlData.originalUrl, cleanedUrlToCheck);
                }
                logTask(taskId, 'INFO', `Unshortened/Cleaned URL: ${urlData.originalUrl} -> ${cleanedUrlToCheck}`);
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error processing URL ${urlData.originalUrl} for unshortening/cleaning`, error);
        }
    }
    
    return modifiedValue;
}

// New helper function to process embed values with Mavely affiliate links
async function processAffiliateEmbedValue(value, taskId) {
    logTask(taskId, 'INFO', `Attempting to affiliate links in value for task ${taskId}.`);
    // Corrected Regex for matching markdown and plain URLs
    const urlRegex = /\[(.*?)\]\((.*?)\)|(https?:\/\/[^\s<>)\"\']+[^\s.,;!?)<>\'\"]+)/g;
    const matches = [...value.matchAll(urlRegex)];
    let modifiedValue = value;

    for (const match of matches) {
        const markdownLinkText = match[1]; // Text part of a markdown link, e.g., "Click here"
        const originalUrl = match[2] || match[3]; // URL part of markdown OR plain URL
        const fullMatch = match[0]; // The entire matched string, e.g., "[Click here](url)" or "url"

        try {
            logTask(taskId, 'DEBUG', `Calling Mavely API for URL: ${originalUrl}`);
            
            const response = await fetch('http://localhost:3001/api/mavely/generate-link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: originalUrl })
            });

            const result = await response.json(); // Try to parse JSON regardless of status for error messages

            if (response.ok) {
                if (result.generatedLink && result.generatedLink !== originalUrl) {
                    const newAffiliatedUrl = result.generatedLink;
                    if (markdownLinkText !== undefined) { // Markdown link
                        modifiedValue = modifiedValue.replace(fullMatch, `[${markdownLinkText}](${newAffiliatedUrl})`);
                    } else { // Plain URL
                        modifiedValue = modifiedValue.replace(fullMatch, newAffiliatedUrl);
                    }
                    logTask(taskId, 'SUCCESS', `Affiliated ${originalUrl} to ${newAffiliatedUrl}`);
                } else if (result.generatedLink === originalUrl) {
                    logTask(taskId, 'INFO', `Mavely API returned original URL for ${originalUrl}. No affiliation needed or it was a silent failure by Mavely.`);
                } else {
                     logTask(taskId, 'INFO', `Mavely API response for ${originalUrl} did not result in an affiliated link (generatedLink: ${result.generatedLink}). Keeping original.`);
                }
            } else {
                // Handle 400 (validation), 409 (manager not running), 500 (server error)
                logTask(taskId, 'WARNING', `Mavely API call failed for ${originalUrl} (Status: ${response.status}): ${result.message || response.statusText}. Keeping original link.`);
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Network/fetch error while trying to affiliate URL ${originalUrl}: ${error.message}. Keeping original link.`);
        }
    }
    return modifiedValue;
}

// Helper function to process embeds (controller function)
async function processEmbedsForWebhook(embedArray, taskId, shouldAffiliateLinks) {
    const processedEmbeds = [];
    if (!embedArray || embedArray.length === 0) return [];

    logTask(taskId, 'DEBUG', `Processing ${embedArray.length} embeds. Affiliation: ${shouldAffiliateLinks}`);

    for (const embed of embedArray) {
        const processedEmbed = { ...embed }; // Shallow copy
        
        // Check if the embed title is 'author' (case-insensitive)
        const isAuthorEmbed = embed.title && embed.title.toLowerCase() === 'author';

        if (isAuthorEmbed) {
            logTask(taskId, 'INFO', `Skipping link processing for author embed: '${embed.value?.substring(0,50)}...'`);
            // For author embeds, we don't affiliate value or url.
            // Standard unshortening for embed.value might still apply if not affiliating, but let's keep it simple and skip all for author.
        } else {
            // Not an author embed, proceed with normal link processing
            // 1. Process URLs within embed.value (existing logic)
            if (processedEmbed.value) { 
                if (shouldAffiliateLinks) {
                    logTask(taskId, 'DEBUG', `Using AFFILIATE processing for embed field (value): '${embed.title || 'Untitled'}'.`);
                    processedEmbed.value = await processAffiliateEmbedValue(processedEmbed.value, taskId);
                } else if (enableUrlUnshorteningGlobal) { 
                    logTask(taskId, 'DEBUG', `Using STANDARD unshortening for embed field (value): '${embed.title || 'Untitled'}'.`);
                    processedEmbed.value = await processEmbedValue(processedEmbed.value, taskId); 
                } else {
                     logTask(taskId, 'DEBUG', `Skipping URL processing for embed field value (affiliation & unshortening disabled): '${embed.title || 'Untitled'}'.`);
                }
            }

            // 2. Process embed.url directly (new logic for title links, etc.)
            if (processedEmbed.url && shouldAffiliateLinks) {
                logTask(taskId, 'INFO', `Attempting to affiliate direct embed.url for '${embed.title || 'Untitled Embed'}': ${processedEmbed.url}`);
                try {
                    const response = await fetch('http://localhost:3001/api/mavely/generate-link', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url: processedEmbed.url })
                    });
                    const result = await response.json();
                    if (response.ok && result.generatedLink && result.generatedLink !== processedEmbed.url) {
                        logTask(taskId, 'SUCCESS', `Affiliated embed.url ${processedEmbed.url} to ${result.generatedLink}`);
                        processedEmbed.url = result.generatedLink;
                    } else if (response.ok && result.generatedLink === processedEmbed.url) {
                         logTask(taskId, 'INFO', `Mavely API returned original URL for embed.url ${processedEmbed.url}. No affiliation needed or silent failure.`);
                    } else {
                        logTask(taskId, 'WARNING', `Mavely API call failed for embed.url ${processedEmbed.url} (Status: ${response.status}): ${result.message || response.statusText}. Keeping original embed.url.`);
                    }
                } catch (error) {
                    logTask(taskId, 'ERROR', `Network/fetch error while trying to affiliate embed.url ${processedEmbed.url}: ${error.message}. Keeping original embed.url.`);
                }
            } else if (processedEmbed.url && !shouldAffiliateLinks && enableUrlUnshorteningGlobal) {
                // Optional: If not affiliating, but URL unshortening is on, consider unshortening embed.url too
                // logTask(taskId, 'DEBUG', `Standard unshortening for embed.url: ${processedEmbed.url}`)
                // processedEmbed.url = await unshorten(processedEmbed.url); // Requires unshorten to be robust
            }
        }

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
async function monitorChannel(browser, channelUrl, targetChannels, currentTaskId, currentEnableRegularMessages, currentIsTestingModule, currentEnableAffiliateLinks, currentEnableTweeting, currentTweetKeywords) {
    let page;
    let scrollIntervalId = null; // Variable to hold the interval ID
    try {
        logTask(currentTaskId, 'INFO', `Starting monitoring for ${channelUrl}`);
        logTask(currentTaskId, 'INFO', `Regular message processing: ${currentEnableRegularMessages ? 'ENABLED' : 'DISABLED'}`);
        logTask(currentTaskId, 'INFO', `Affiliate link processing: ${currentEnableAffiliateLinks ? 'ENABLED' : 'DISABLED'}`);
        logTask(currentTaskId, 'INFO', `URL unshortening (standard): ${enableUrlUnshorteningGlobal ? 'ENABLED' : 'DISABLED'}`);
        logTask(currentTaskId, 'INFO', `Testing mode (no webhooks): ${currentIsTestingModule ? 'ENABLED' : 'DISABLED'}`);
        logTask(currentTaskId, 'INFO', `Tweet processing: ${currentEnableTweeting ? 'ENABLED' : 'DISABLED'}`);
        if (currentEnableTweeting && currentTweetKeywords) {
            logTask(currentTaskId, 'INFO', `Tweet keywords: ${currentTweetKeywords}`);
        }

        // Get existing pages (usually just the initial blank tab)
        const pages = await browser.pages();
        if (pages.length > 0) {
            page = pages[0]; // Use the first page
            logTask(currentTaskId, 'DEBUG', 'Using the initial browser tab.');
        } else {
            // Fallback: Create a new page if none exist (shouldn't normally happen)
            logTask(currentTaskId, 'WARNING', 'No initial pages found, creating a new one.');
            page = await browser.newPage();
        }
        
        await page.setViewport({ width: 1920, height: 1080 }); // Use a common desktop resolution

        logTask(currentTaskId, 'INFO', `Navigating to ${channelUrl}`);
        await page.goto(channelUrl, { waitUntil: ['load', 'domcontentloaded', 'networkidle0'], timeout: 60000 });
        logTask(currentTaskId, 'SUCCESS', `Navigation complete for ${channelUrl}`);

        // --- Focus on message list before scrolling ---
        try {
            const messageListSelector = 'ol[aria-label*="Messages in"]';
            logTask(currentTaskId, 'INFO', `Waiting for message list element: ${messageListSelector}`);
            await page.waitForSelector(messageListSelector, { timeout: 15000 }); // Wait up to 15s
            logTask(currentTaskId, 'INFO', `Found message list element, attempting to focus.`);
            await page.focus(messageListSelector);
            logTask(currentTaskId, 'SUCCESS', 'Successfully focused on the message list.');
        } catch (error) {
            logTask(currentTaskId, 'WARNING', `Could not find or focus message list element: ${error.message}. Scrolling might not work as expected.`);
            // Continue even if focus fails, scrolling might still work
        }
        // --- End focus logic ---

        // --- Start periodic scrolling ---
        scrollIntervalId = setInterval(async () => {
            if (page && !page.isClosed()) {
                try {
                    logTask(currentTaskId, 'DEBUG', 'Pressing "End" key to scroll down.');
                    await page.keyboard.press('End');
                } catch (error) {
                    logTask(currentTaskId, 'WARNING', `Error pressing "End" key: ${error.message}`);
                    // Optional: Clear interval if key press consistently fails?
                    // if (scrollIntervalId) clearInterval(scrollIntervalId);
                }
            } else {
                logTask(currentTaskId, 'DEBUG', 'Page closed or not available, stopping scroll interval.');
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
                logTask(currentTaskId, 'DEBUG', `Starting monitoring cycle #${cycleCount}`);

                const scrapedMessages = await ScrapeData(page, currentEnableRegularMessages);
                const now = new Date();

                // Scroll logic (keep as is)
                // ... existing code ...

                 // Log basic scrape results
                 logTask(currentTaskId, 'DEBUG', 'Scrape results:', {
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
                    logTask(currentTaskId, 'INFO', 'First run: Populating initial message IDs without sending webhooks.');
                    for (const messageData of scrapedMessages) {
                        if (messageData.messageId) {
                            processedMessageIds.add(messageData.messageId);
                        }
                    }
                    logTask(currentTaskId, 'INFO', `First run complete. Initial processed ID count: ${processedMessageIds.size}`);
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
                        logTask(currentTaskId, 'WARNING', 'Scraped message data is missing messageId. Skipping.', messageData);
                        continue;
                    }

                    // Check if already processed
                    if (processedMessageIds.has(messageId)) {
                        logTask(currentTaskId, 'DEBUG', `Message ${messageId} already processed. Skipping.`);
                        continue; // Skip this message
                    }

                    // --- Check for "Jump to Present" bar (example placeholder) ---
                    // if (messageIsJumpToPresentBar) { ... continue; }

                    // --- Process New Message (if not processed and not first run) ---
                    logTask(currentTaskId, 'INFO', `Processing new message ${messageId}`);
                    newMessagesProcessedThisCycle++;

                    // Handle regular messages (this logic correctly uses the passed enableRegularMessages)
                    if (regularMessage) {
                        if (currentEnableRegularMessages) {
                            logTask(currentTaskId, 'INFO', `Processing regular message ${messageId}:`, {
                                username: regularMessage.username,
                                contentLength: regularMessage.content.length,
                                hasAttachments: !!regularMessage.attachments
                            });
                            // Loop through target channels for regular messages
                            for (const channelName of targetChannels) {
                                const channelConfig = config.discord.channels.find(c => c.name === channelName);
                                if (channelConfig) {
                                    logTask(currentTaskId, 'INFO', `Sending regular message ${messageId} to channel: ${channelName}`);
                                    try {
                                        await webhook.sendRegularMessage(regularMessage, channelConfig.webhook_url, currentIsTestingModule); // Pass flag
                                        logTask(currentTaskId, 'SUCCESS', `Regular message ${messageId} sent to channel: ${channelName}`);
                                    } catch (error) {
                                        logTask(currentTaskId, 'ERROR', `Error sending regular message ${messageId} to ${channelName}: ${error?.message}`, error);
                                    }
                                } else {
                                    logTask(currentTaskId, 'WARNING', `Channel config not found for regular message target: ${channelName}`);
                                }
                            }
                        } else {
                            logTask(currentTaskId, 'INFO', `Regular message ${messageId} detected, but processing is disabled by flag.`);
                        }
                    }
                    // Handle embeds
                    else if (embedArray && embedArray.length > 0) {
                        logTask(currentTaskId, 'INFO', `Processing ${embedArray.length} embeds for message ${messageId}`);

                        // Loop through target channels
                        for (const channelName of targetChannels) {
                            logTask(currentTaskId, 'DEBUG', `Looping target channel: ${channelName}`);
                            
                            logTask(currentTaskId, 'DEBUG', `Searching config for channel: ${channelName}`);
                            const channelConfig = config.discord.channels.find(c => c.name === channelName);
                            logTask(currentTaskId, 'DEBUG', `Found config for ${channelName}: ${!!channelConfig}`);
                            
                            if (channelConfig) {
                                logTask(currentTaskId, 'INFO', `Sending embeds for ${messageId} to channel: ${channelName}`); 
                                try {
                                    logTask(currentTaskId, 'DEBUG', `Preparing embeds for ${channelName}. Affiliation enabled: ${currentEnableAffiliateLinks}`);
                                    
                                    const finalEmbedArray = await processEmbedsForWebhook(embedArray, currentTaskId, currentEnableAffiliateLinks);
                                    
                                    await webhook.buildWebhook(finalEmbedArray, channelConfig.webhook_url, currentIsTestingModule);
                                    logTask(currentTaskId, 'DEBUG', `Completed webhook.buildWebhook for ${channelName}`);
                                    logTask(currentTaskId, 'SUCCESS', `Embeds for ${messageId} sent to channel: ${channelName}`);
                                } catch (error) {
                                    // This catch block in main.js should now catch errors re-thrown from buildWebhook
                                    logTask(currentTaskId, 'ERROR', `Error sending embeds for ${messageId} to ${channelName}: ${error?.message}`, error);
                                }
                            } else {
                                logTask(currentTaskId, 'WARNING', `Channel config not found for: ${channelName}`);
                            }
                            logTask(currentTaskId, 'DEBUG', `Finished processing target channel: ${channelName}`);
                        } // End for loop targetChannels
                        logTask(currentTaskId, 'DEBUG', `Finished looping through all target channels for message ${messageId}`);
                    }
                    else {
                        logTask(currentTaskId, 'WARNING', `Message ${messageId} has neither regular content nor embeds.`);
                    }

                    // Process tweet if enabled
                    if (currentEnableTweeting && (regularMessage || (embedArray && embedArray.length > 0))) {
                        try {
                            logTask(currentTaskId, 'INFO', `Processing tweet for message ${messageId}`);
                            
                            // Import tweet processor dynamically to avoid circular dependencies
                            const { processMessageForTweet } = require('./utils/tweet_processor');
                            
                            const taskSettings = {
                                enableTweeting: currentEnableTweeting,
                                tweetKeywords: currentTweetKeywords
                            };
                            
                            if (regularMessage) {
                                await processMessageForTweet(regularMessage, taskSettings, currentTaskId);
                            } else if (embedArray && embedArray.length > 0) {
                                // For embeds, we need to extract the content
                                const embedContent = embedArray.map(embed => ({
                                    title: embed.title || '',
                                    description: embed.description || '',
                                    fields: embed.fields || []
                                }));
                                await processMessageForTweet({ content: embedContent }, taskSettings, currentTaskId);
                            }
                            
                            logTask(currentTaskId, 'SUCCESS', `Tweet processing completed for message ${messageId}`);
                        } catch (error) {
                            logTask(currentTaskId, 'ERROR', `Error processing tweet for message ${messageId}: ${error.message}`, error);
                        }
                    }

                    // Add to processed set
                    processedMessageIds.add(messageId);
                    // Maintain the size of the processed set
                    // ... existing code ...
                    // --- End Process New Message ---
                } // End for loop scrapedMessages

                if (newMessagesProcessedThisCycle === 0) {
                    logTask(currentTaskId, 'DEBUG', 'No new messages found in the scraped batch this cycle.');
                }

                // Add a small delay between cycles
                await delay(1000);

            } catch (error) {
                logTask(currentTaskId, 'ERROR', `Error in monitoring cycle #${cycleCount}: ${error.message}`, error);
                 // Log page state on error for debugging
                if (page && !page.isClosed()) {
                    try {
                        const pageUrl = page.url();
                        const pageTitle = await page.title();
                        const pageContent = await page.content(); // Get HTML content
                        logTask(currentTaskId, 'DEBUG', 'Page state during error:', { url: pageUrl, title: pageTitle });
                        // Avoid logging potentially huge HTML content unless necessary and truncated
                        // logTask(currentTaskId, 'DEBUG', `Page HTML (first 1000 chars): ${pageContent.substring(0, 1000)}`);
                    } catch (debugError) {
                        logTask(currentTaskId, 'ERROR', 'Failed to get page state during error handling.', debugError);
                    }
                }
                await delay(5000); // Longer delay on error
            }
        }
    } catch (error) {
        logTask(currentTaskId, 'ERROR', `Fatal error in monitorChannel: ${error.message}`, error);
        // Ensure browser is closed even on fatal error before throwing
        if (browser && browser.isConnected()) {
             try { await browser.close(); } catch (e) { logTask(currentTaskId, 'ERROR', 'Error closing browser on fatal error.', e); }
        }
        throw error; // Re-throw to allow PM2 to handle restart if configured
    } finally {
         // --- Clear scroll interval ---
         if (scrollIntervalId) {
             clearInterval(scrollIntervalId);
             logTask(currentTaskId, 'INFO', 'Cleared scroll interval.');
         }
         // --- End clear scroll interval ---

         // Ensure page is closed if it exists and isn't already closed
         if (page && !page.isClosed()) {
             try { await page.close(); } catch(e) { logTask(currentTaskId, 'WARNING', 'Error closing page in finally block.', e); }
         }
         logTask(currentTaskId, 'INFO', 'Monitor channel function finally block reached.');
         // Don't close the browser here if the error is outside the main loop, let the main() function handle it
    }
}

// Main function
async function main() {
    // Store all browser instances launched
    const browsers = [];

    // Arguments are already parsed by yargs at the top and assigned to global vars
    // So, we use channelUrlArg, targetChannelsArg, taskId, profileId, isHeadless, 
    // enableUrlUnshorteningGlobal, enableRegularMessages, isTestingModuleGlobal, enableAffiliateLinksGlobal directly.

    // Always start with an empty set for each run/restart
    processedMessageIds = new Set();
    logTask(taskId, 'INFO', 'Initialized with an empty processed message ID set for this run.');

     logTask(taskId, 'INFO', `Received task arguments via yargs:`, {
         channelUrl: channelUrlArg,
         targets: targetChannelsArg,
         taskId: taskId,
         profile: profileId,
         headless: isHeadless,
         enableUrlUnshortening: enableUrlUnshorteningGlobal,
         enableRegularMessages: enableRegularMessages,
         isTestingModule: isTestingModuleGlobal,
         enableAffiliateLinks: enableAffiliateLinksGlobal,
         enableTweeting: enableTweetingGlobal,
         tweetKeywords: tweetKeywordsGlobal
     });

    let browser;
    try {
        // Launch browser with specified profile and headless mode
        logTask(taskId, 'INFO', `Launching browser with profile: ${profileId}, Headless: ${isHeadless}`);
        browser = await launchBrowser(profileId, isHeadless);
        browsers.push(browser); // Add to array for cleanup
        logTask(taskId, 'SUCCESS', 'Browser launched successfully.');

        // Start monitoring
        logTask(taskId, 'INFO', `Starting monitoring for ${channelUrlArg}`);
        await monitorChannel(browser, channelUrlArg, targetChannelsArg, taskId, enableRegularMessages, isTestingModuleGlobal, enableAffiliateLinksGlobal, enableTweetingGlobal, tweetKeywordsGlobal);

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
    // Args would have been parsed by yargs already if main() was reached.
    // taskId might be available if parsing was successful before the error.
    logTask(taskId || 'GLOBAL_CATCH', 'ERROR', 'Unhandled error in main execution', error);
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
