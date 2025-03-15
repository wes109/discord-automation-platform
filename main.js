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

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--channel' && i + 1 < args.length) {
    channelUrlArg = args[i + 1];
    i++;
  } else if (args[i] === '--targets' && i + 1 < args.length) {
    targetChannelsArg = args[i + 1].split(',');
    i++;
  } else if (args[i] === '--headless') {
    isHeadless = true;
  } else if (args[i] === '--task-id' && i + 1 < args.length) {
    taskId = args[i + 1];
    i++;
  } else if (args[i] === '--profile' && i + 1 < args.length) {
    profileId = args[i + 1];
    i++;
  }
}

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
    logTask(taskId, 'INFO', `Launching browser (Profile: ${profileId}, Headless: ${headless})`);
    
    try {
        const browser = await puppeteer.launch({
            headless: headless ? 'new' : false,
            defaultViewport: null,
            userDataDir: `./${profileId}`,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
        });
        
        logTask(taskId, 'SUCCESS', 'Browser launched successfully');
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

        logTask(taskId, 'INFO', 'Creating new browser page...');
        const page = await browser.newPage();
        logTask(taskId, 'INFO', 'Browser page created, navigating to Discord channel');
        
        logTask(taskId, 'INFO', `Navigating to ${channelUrl}`);
        await page.goto(channelUrl, { waitUntil: 'networkidle0' });
        logTask(taskId, 'INFO', 'Discord channel page loaded');
        
        let lastMessageId = null;
        let cycleCount = 0;
        let lastSuccessfulScrape = null;
        
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
                    lastMessageId = data.newestMessageID;
                    lastSuccessfulScrape = now;

                    // Handle regular messages
                    if (data.regularMessage) {
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
    let browser = null;
    
    try {
        // Set up process termination handlers
        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM signal, shutting down...');
            if (browser) {
                try {
                    await browser.close();
                    console.log('Browser closed successfully');
                } catch (error) {
                    console.error('Error closing browser:', error);
                }
            }
            process.exit(0);
        });
        
        process.on('SIGINT', async () => {
            console.log('Received SIGINT signal, shutting down...');
            if (browser) {
                try {
                    await browser.close();
                    console.log('Browser closed successfully');
                } catch (error) {
                    console.error('Error closing browser:', error);
                }
            }
            process.exit(0);
        });
        
        // If command line arguments are provided, use them
        if (channelUrlArg && targetChannelsArg.length > 0) {
            const taskId = generateTaskId();
            logTask(taskId, 'INFO', `Starting monitoring task for channel: ${channelUrlArg}`);
            logTask(taskId, 'INFO', `Target channels: ${targetChannelsArg.join(', ')}`);
            logTask(taskId, 'INFO', `Headless mode: ${isHeadless}`);
            
            if (!profileId) {
                throw new Error('No profile ID provided');
            }
            
            // Launch browser with headless option and profile
            browser = await launchBrowser(profileId, isHeadless);
            
            // Monitor the specified channel
            await monitorChannel(browser, channelUrlArg, targetChannelsArg, taskId);
        } else {
            // Use configuration from config.json
            const monitoringChannels = config.monitoring.channels;
            
            if (!monitoringChannels || monitoringChannels.length === 0) {
                console.log('No monitoring channels configured. Exiting...');
                process.exit(0);
            }
            
            // Launch browsers for each monitoring channel
            for (let i = 0; i < monitoringChannels.length; i++) {
                const channel = monitoringChannels[i];
                const taskId = generateTaskId();
                
                logTask(taskId, 'INFO', `Starting monitoring task for channel: ${channel.url}`);
                logTask(taskId, 'INFO', `Target channels: ${channel.targetChannels.join(', ')}`);
                logTask(taskId, 'INFO', `Headless mode: ${channel.headless || isHeadless}`);
                
                // Launch browser with a unique profile for each task and headless option
                browser = await launchBrowser(i + 1, channel.headless || isHeadless);
                
                // Monitor the channel
                monitorChannel(browser, channel.url, channel.targetChannels, taskId);
            }
        }
    } catch (error) {
        console.error('Error in main function:', error);
        // Try to close browser if it exists
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser during error handling:', closeError);
            }
        }
        process.exit(1);
    }
}

// Start the application
main();
