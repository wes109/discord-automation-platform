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

// Initialize Puppeteer plugins
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

// Configuration
let taskCounter = 0;

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
async function monitorChannel(browser, channelUrl, targetChannels, taskId) {
    logTask(taskId, 'INFO', `Starting monitoring for ${channelUrl}`);
    logTask(taskId, 'INFO', `Target channels: ${targetChannels.join(', ')}`);
    logTask(taskId, 'INFO', `Browser settings: Headless=${isHeadless}`);
    
    try {
        // Initialize Discord client
        logTask(taskId, 'INFO', 'Initializing Discord client...');
        const success = await discordManager.initialize(config.discord.token);
        if (!success) {
            logTask(taskId, 'ERROR', 'Failed to initialize Discord client');
            throw new Error('Failed to initialize Discord client');
        }
        logTask(taskId, 'SUCCESS', 'Discord client initialized successfully');

        // Get the first page instead of creating a new one
        logTask(taskId, 'INFO', 'Getting existing browser page...');
        const pages = await browser.pages();
        const page = pages[0];
        logTask(taskId, 'INFO', 'Using existing browser page, navigating to Discord channel');
        
        logTask(taskId, 'INFO', `Navigating to ${channelUrl}`);
        await page.goto(channelUrl, { waitUntil: 'networkidle0' });
        logTask(taskId, 'INFO', 'Discord channel page loaded');
        
        let lastMessageId = null;
        let cycleCount = 0;
        let lastSuccessfulScrape = null;
        let isFirstMessage = true; // Flag to track first message
        
        while (true) {
            cycleCount++;
            try {
                logTask(taskId, 'DEBUG', `Starting monitoring cycle #${cycleCount}`);
                
                const data = await ScrapeData(page);
                const now = new Date();
                
                // Log detailed scraping results
                logTask(taskId, 'DEBUG', 'Scrape results:', {
                    hasData: !!data,
                    hasRegularMessage: !!data?.regularMessage,
                    hasEmbeds: !!(data?.embedArray && data?.embedArray.length > 0),
                    messageId: data?.newestMessageID,
                    lastMessageId,
                    timeSinceLastSuccess: lastSuccessfulScrape ? 
                        `${(now - lastSuccessfulScrape) / 1000}s ago` : 'never'
                });
                
                if (data && data.newestMessageID !== lastMessageId) {
                    logTask(taskId, 'INFO', '=== NEW MESSAGE DETECTED ===');
                    
                    if (isFirstMessage) {
                        logTask(taskId, 'INFO', 'First message detected - storing but not sending webhook');
                        lastMessageId = data.newestMessageID;
                        lastSuccessfulScrape = now;
                        isFirstMessage = false;
                        continue;
                    }
                    
                    lastMessageId = data.newestMessageID;
                    lastSuccessfulScrape = now;

                    // Handle regular messages
                    if (data.regularMessage) {
                        if (enableRegularMessages) {
                            logTask(taskId, 'INFO', 'Processing regular message:', {
                                username: data.regularMessage.username,
                                contentLength: data.regularMessage.content.length,
                                hasAttachments: !!data.regularMessage.attachments
                            });
                            
                            for (const channelName of targetChannels) {
                                const channelConfig = config.discord.channels.find(c => c.name === channelName);
                                if (channelConfig) {
                                    try {
                                        logTask(taskId, 'INFO', `Sending regular message to channel: ${channelName}`);
                                        await webhook.sendRegularMessage(data.regularMessage, channelConfig.webhook_url);
                                        logTask(taskId, 'SUCCESS', `Message sent to channel: ${channelName}`);
                                    } catch (error) {
                                        logTask(taskId, 'ERROR', `Failed to send to ${channelName}: ${error.message}`, error);
                                    }
                                } else {
                                    logTask(taskId, 'WARNING', `Channel config not found for: ${channelName}`);
                                }
                            }
                        } else {
                            logTask(taskId, 'INFO', 'Regular message detected, but processing is disabled by flag.');
                        }
                    }
                    // Handle embeds
                    else if (data.embedArray && data.embedArray.length > 0) {
                        logTask(taskId, 'INFO', `Processing ${data.embedArray.length} embeds`);
                        
                        for (const channelName of targetChannels) {
                            const channelConfig = config.discord.channels.find(c => c.name === channelName);
                            if (channelConfig) {
                                logTask(taskId, 'INFO', `Sending embeds to channel: ${channelName}`);
                                try {
                                    await webhook.buildWebhook(data.embedArray, channelConfig.webhook_url);
                                    logTask(taskId, 'SUCCESS', `Embeds sent to channel: ${channelName}`);
                                } catch (error) {
                                    logTask(taskId, 'ERROR', `Failed to send embeds to ${channelName}: ${error.message}`, error);
                                }
                            } else {
                                logTask(taskId, 'WARNING', `Channel config not found for: ${channelName}`);
                            }
                        }
                    }
                } else if (!data) {
                    logTask(taskId, 'DEBUG', 'No data returned from scrape');
                } else {
                    logTask(taskId, 'DEBUG', 'Message already processed');
                }
                
                // Add a small delay between cycles
                await delay(1000);
                
            } catch (error) {
                logTask(taskId, 'ERROR', `Error in monitoring cycle: ${error.message}`, error);
                await delay(5000); // Longer delay on error
            }
        }
    } catch (error) {
        logTask(taskId, 'ERROR', `Fatal error in monitorChannel: ${error.message}`, error);
        throw error;
    }
}

// Main function
async function main() {
    // Store all browser instances launched
    const browsers = []; // <-- Use an array

    try {
        // Helper function for graceful shutdown
        const shutdown = async (signal) => {
            console.log(`Received ${signal} signal, shutting down...`);
            logTask('SYSTEM', 'INFO', `Received ${signal} signal, shutting down...`); // Use logTask if available globally
            // Close all tracked browsers
            for (const browserInstance of browsers) {
                if (browserInstance && browserInstance.isConnected()) { // Check if browser exists and is connected
                    try {
                        await browserInstance.close();
                        console.log('Browser instance closed successfully.');
                        logTask('SYSTEM', 'INFO', 'Browser instance closed successfully.');
                    } catch (error) {
                        console.error('Error closing a browser instance:', error);
                        logTask('SYSTEM', 'ERROR', 'Error closing a browser instance:', error);
                    }
                }
            }
            process.exit(0);
        };

        // Set up process termination handlers
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

        // If command line arguments are provided, use them
        if (channelUrlArg && targetChannelsArg.length > 0) {
            const taskId = generateTaskId();
            logTask(taskId, 'INFO', `Starting monitoring task for channel: ${channelUrlArg}`);
            logTask(taskId, 'INFO', `Target channels: ${targetChannelsArg.join(', ')}`);
            logTask(taskId, 'INFO', `Headless mode: ${isHeadless}`);
            
            if (!profileId) {
                throw new Error('No profile ID provided');
            }
            
            console.log('Launching browser with headless:', isHeadless);
            const singleBrowser = await launchBrowser(profileId, isHeadless); // <-- Store locally
            browsers.push(singleBrowser); // <-- Add to array

            // Monitor the specified channel
            // If monitorChannel throws, the main catch block will handle cleanup
            await monitorChannel(singleBrowser, channelUrlArg, targetChannelsArg, taskId);

        } else {
            // Use configuration from config.json
            const monitoringChannels = config.monitoring.channels;
            
            if (!monitoringChannels || monitoringChannels.length === 0) {
                console.log('No monitoring channels configured. Exiting...');
                process.exit(0);
            }

            // Store promises for concurrent monitoring
            const monitorPromises = [];

            // Launch browsers and start monitoring for each channel
            for (let i = 0; i < monitoringChannels.length; i++) {
                const channel = monitoringChannels[i];
                const taskId = generateTaskId(); // Generate task ID for this specific monitor
                const taskProfileId = `profile_${i + 1}`; // Generate a unique profile ID

                logTask(taskId, 'INFO', `Preparing monitoring task for channel: ${channel.url}`);
                logTask(taskId, 'INFO', `Target channels: ${channel.targetChannels.join(', ')}`);
                logTask(taskId, 'INFO', `Headless mode: ${isHeadless}`);
                logTask(taskId, 'INFO', `Profile directory: ./${taskProfileId}`);

                try {
                    // Launch browser with a unique profile for each task and headless option
                    const taskBrowser = await launchBrowser(taskProfileId, isHeadless); // <-- Store locally
                    browsers.push(taskBrowser); // <-- Add to array

                    // Start monitoring asynchronously and store the promise
                    logTask(taskId, 'INFO', `Starting monitoring for ${channel.url}`);
                    // Don't await here, let them run concurrently
                    // Wrap monitorChannel call in an async IIFE to handle its errors separately if needed
                    const monitorPromise = (async () => {
                       try {
                           await monitorChannel(taskBrowser, channel.url, channel.targetChannels, taskId);
                       } catch(monitorError) {
                           logTask(taskId, 'ERROR', `FATAL error in monitorChannel for ${channel.url}. Monitor stopped.`, monitorError);
                           // Optionally try to close this specific browser here, though main cleanup should handle it
                           try {
                               if (taskBrowser && taskBrowser.isConnected()) await taskBrowser.close();
                           } catch (closeErr) {
                               logTask(taskId, 'ERROR', 'Error closing browser after monitor failure.', closeErr);
                           }
                       }
                    })();
                    monitorPromises.push(monitorPromise);


                } catch (launchError) {
                    logTask(taskId, 'ERROR', `Failed to launch browser or start monitoring for ${channel.url}`, launchError);
                    // Decide if failure to launch one monitor should stop others
                    // For now, we just log and continue to the next channel
                }
            }

            // Keep the main process alive while monitors are running
            // This could be more robust, e.g., using Promise.allSettled if you need to react when monitors finish/fail
            logTask('SYSTEM', 'INFO', `Launched ${browsers.length} monitoring tasks.`);
            // Wait indefinitely or until a signal terminates the process
            // This simple approach relies on signal handlers for cleanup.
            await new Promise(() => {}); // Keeps the script running

        }
    } catch (error) {
        console.error('Critical error in main function:', error);
        logTask('SYSTEM', 'CRITICAL', 'Critical error in main function:', error);
        // Attempt to close any browsers that were successfully added to the array
        for (const browserInstance of browsers) {
             if (browserInstance && browserInstance.isConnected()) {
                try {
                    await browserInstance.close();
                } catch (closeError) {
                    console.error('Error closing browser during error handling:', closeError);
                    logTask('SYSTEM', 'ERROR', 'Error closing browser during error handling:', closeError);
                }
            }
        }
        process.exit(1);
    }
}

// Start the application
main();
