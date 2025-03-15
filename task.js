const puppeteer = require('puppeteer-extra');
const { ScrapeData } = require('./scrape');
const { buildWebhook, sendRegularMessage } = require('./webhook');
const { generateMavelyLink } = require('./mavely');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let isFirstRun = true;
let taskCounter = 0;

// Helper function to generate task ID
function generateTaskId() {
    taskCounter++;
    return `TASK_${taskCounter.toString().padStart(4, '0')}`;
}

// Helper function for consistent logging
function logTask(taskId, status, message, error = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${taskId}] [${status}] ${message}`;
    if (error) {
        console.error(logMessage, error);
    } else {
        console.log(logMessage);
    }
}

// Helper function to pick a random URL from an array
function getRandomWebhookUrl(webhookUrls) {
    return webhookUrls[Math.floor(Math.random() * webhookUrls.length)];
}

// Helper function to unshorten URL
async function unshorten(url) {
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

// Helper function to process embed values
async function processEmbedValue(value, taskId) {
    try {
        const urlRegex = /\[.*?\]\((.*?)\)|(?:https?:\/\/[^\s<>)"']+[^\s.,;!?)<>'"])/g;
        const matches = [...value.matchAll(urlRegex)];
        let modifiedValue = value;

        // First, validate all URLs and collect only valid brand URLs
        const validUrls = [];
        for (const match of matches) {
            const originalUrl = match[1] || match[0];
            try {
                const urlToCheck = await unshorten(originalUrl);
                if (await generateMavelyLink(urlToCheck)) {  // Check if URL can generate Mavely link
                    validUrls.push({
                        originalUrl,
                        unshortenedUrl: urlToCheck,
                        fullMatch: match[0],
                        isMarkdown: !!match[1]
                    });
                }
            } catch (error) {
                console.log(`Error processing URL ${originalUrl}:`, error);
            }
        }

        // Then, process only valid URLs with Mavely
        for (const urlData of validUrls) {
            let retryCount = 0;
            let mavelyUrl = null;
            
            while (retryCount < 5) {  // Max 5 retries
                try {
                    console.log(`Attempt ${retryCount + 1}/5 to generate Mavely link for: ${urlData.unshortenedUrl}`);
                    mavelyUrl = await generateMavelyLink(urlData.unshortenedUrl);
                    if (mavelyUrl) {
                        console.log(`Generated Mavely link on attempt ${retryCount + 1}`);
                        break;
                    }
                    
                    retryCount++;
                    if (retryCount < 5) {
                        await delay(100);  // Wait 100ms between retries
                        continue;
                    }
                } catch (error) {
                    console.log(`Error on attempt ${retryCount + 1}:`, error);
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
            }
        }

        return modifiedValue;
    } catch (error) {
        console.error('Error in processEmbedValue:', error);
        return value;  // Return original value if processing fails
    }
}

// Helper function to process links with Mavely
async function processMavelyLinks(embedArray, taskId) {
    try {
        const processedEmbeds = [];
        
        for (const embed of embedArray) {
            const processedEmbed = { ...embed };
            if (embed.value) {
                processedEmbed.value = await processEmbedValue(embed.value, taskId);
            }
            if (embed.url) {
                const mavelyUrl = await generateMavelyLink(embed.url);
                if (mavelyUrl) {
                    processedEmbed.url = mavelyUrl;
                }
            }
            processedEmbeds.push(processedEmbed);
        }
        
        return processedEmbeds;
    } catch (error) {
        console.error('Error in processMavelyLinks:', error);
        return embedArray;  // Return original array if processing fails
    }
}

// Helper function to send webhook with retries
async function sendWebhookWithRetry(embedArray, webhookUrls, maxRetries = 5, delayBetweenRetries = 1000) {
    const taskId = generateTaskId();
    logTask(taskId, 'INFO', 'Starting webhook process');
    
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const processedEmbeds = await processMavelyLinks(embedArray, taskId);
            const randomUrl = getRandomWebhookUrl(webhookUrls);
            
            await buildWebhook(processedEmbeds, randomUrl);
            logTask(taskId, 'SUCCESS', 'Webhook sent successfully');
            return;
        } catch (error) {
            attempt++;
            logTask(taskId, 'ERROR', `Webhook attempt ${attempt}/${maxRetries} failed`, error);
            if (attempt < maxRetries) {
                await delay(delayBetweenRetries);
            }
        }
    }
    logTask(taskId, 'ERROR', 'Webhook send failed after all retries');
}

// Retry launching the Puppeteer browser
async function retryPuppeteerLaunch(profileNum, maxRetries = 5, delayBetweenRetries = 5000) {
    const taskId = generateTaskId();
    let attempt = 0;
    let browser = null;

    while (attempt < maxRetries) {
        try {
            logTask(taskId, 'INFO', `Launching browser (Profile ${profileNum})`);
            browser = await puppeteer.launch({
                headless: "false",
                defaultViewport: null,
                userDataDir: `./my-profile-${profileNum}`,
                args: [
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disk-cache-size=0',
                ],
            });
            logTask(taskId, 'SUCCESS', 'Browser launched successfully');
            return browser;
        } catch (error) {
            attempt++;
            logTask(taskId, 'ERROR', `Browser launch attempt ${attempt}/${maxRetries} failed`, error);
            if (attempt < maxRetries) {
                await delay(delayBetweenRetries);
            } else {
                throw new Error('Failed to launch browser after multiple attempts');
            }
        }
    }
}

// Main function
async function main() {
    const discordUrl = process.argv[2];
    const webhookUrls = JSON.parse(process.argv[3]);
    const profileNum = process.argv[4];
    
    // CHECKPOINT 1: Verify script startup and webhook URLs
    console.log('=== STARTUP CHECKPOINT ===');
    console.log('Discord URL:', discordUrl);
    console.log('Webhook URLs received:', webhookUrls);
    console.log('Profile:', profileNum);
    console.log('========================');

    const taskId = generateTaskId();
    
    // Verify webhook functions are imported
    console.log('Webhook functions available:', {
        sendRegularMessage: typeof sendRegularMessage === 'function',
        sendWebhookWithRetry: typeof sendWebhookWithRetry === 'function'
    });

    logTask(taskId, 'INFO', `Initializing with profile ${profileNum}`);

    let browser;
    try {
        while (true) {
            browser = await retryPuppeteerLaunch(profileNum);
            const pages = await browser.pages();
            const mainPage = pages[0];
            
            await mainPage.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4900.0 Safari/537.36'
            );

            logTask(taskId, 'INFO', `Navigating to target page: ${discordUrl}`);
            await mainPage.goto(discordUrl, { waitUntil: 'domcontentloaded' });
            logTask(taskId, 'SUCCESS', 'Target page loaded successfully');

            let channelTitle = '';
            let lastMessageID = null;

            while (true) {
                try {
                    // CHECKPOINT 2: Before scraping
                    console.log('\n=== STARTING SCRAPE CYCLE ===');
                    
                    const dataScraped = await ScrapeData(mainPage);
                    
                    // CHECKPOINT 3: After scraping
                    console.log('=== SCRAPE RESULTS ===');
                    console.log('Has data:', !!dataScraped);
                    console.log('Has regular message:', !!dataScraped?.regularMessage);
                    console.log('Message ID:', dataScraped?.newestMessageID);
                    console.log('Last message ID:', lastMessageID);
                    console.log('=====================');

                    if (!dataScraped) {
                        console.log('[Task] No data scraped, continuing...');
                        await delay(3000);
                        continue;
                    }

                    if (dataScraped.newestMessageID && dataScraped.newestMessageID !== lastMessageID) {
                        // CHECKPOINT 4: New message detected
                        console.log('\n=== NEW MESSAGE DETECTED ===');
                        console.log('Current ID:', dataScraped.newestMessageID);
                        console.log('Previous ID:', lastMessageID);
                        
                        if (dataScraped.regularMessage) {
                            // CHECKPOINT 5: About to send webhook
                            console.log('\n!!! ATTEMPTING WEBHOOK SEND !!!');
                            console.log('Message:', dataScraped.regularMessage);
                            console.log('Available webhook URLs:', webhookUrls.length);
                            
                            if (!webhookUrls || webhookUrls.length === 0) {
                                console.error('No webhook URLs available!');
                                continue;
                            }

                            const randomWebhookUrl = webhookUrls[Math.floor(Math.random() * webhookUrls.length)];

                            try {
                                await sendRegularMessage(dataScraped.regularMessage, randomWebhookUrl);
                                console.log('!!! WEBHOOK SEND COMPLETED !!!');
                                lastMessageID = dataScraped.newestMessageID;
                            } catch (error) {
                                console.error('!!! WEBHOOK SEND FAILED !!!', error);
                            }
                        } else if (dataScraped.embedArray && dataScraped.embedArray.length > 0) {
                            logTask(taskId, 'INFO', `Preparing to send embed message with ${dataScraped.embedArray.length} embeds`);
                            try {
                                await sendWebhookWithRetry(dataScraped.embedArray, webhookUrls);
                                logTask(taskId, 'SUCCESS', 'Embed message sent successfully');
                                lastMessageID = dataScraped.newestMessageID;
                            } catch (error) {
                                logTask(taskId, 'ERROR', `Failed to send embed message: ${error.message}`);
                                console.error('[Task] Full error:', error);
                            }
                        } else {
                            logTask(taskId, 'WARNING', 'Message detected but no content to send');
                        }
                    } else {
                        logTask(taskId, 'DEBUG', `No new message (current: ${dataScraped?.newestMessageID}, last: ${lastMessageID})`);
                    }
                    
                    await delay(3000);
                } catch (error) {
                    console.error('!!! MAIN LOOP ERROR !!!', error);
                    lastMessageID = null;
                    await delay(5000);
                }
            }
        }
    } catch (error) {
        console.error('!!! FATAL ERROR !!!', error);
    } finally {
        if (browser) {
            await browser.close();
            logTask(taskId, 'INFO', 'Browser closed');
        }
    }
}

main();

module.exports = {
    processEmbedValue,
    processMavelyLinks
};
