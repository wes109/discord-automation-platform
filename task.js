const puppeteer = require('puppeteer-extra');
const { ScrapeData } = require('./scrape');
const { buildWebhook } = require('./webhook');
const { generateMavelyLink } = require('./mavely');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let isFirstRun = true;

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
        console.error('Error unshortening URL:', error);
        return url; // Return original URL if unshortening fails
    }
}

// Helper function to process links through Mavely with rate limiting
async function processMavelyLinks(embedArray) {
    console.log('\n[DEBUG] ========== Starting Embed Processing ==========');
    console.log(`[DEBUG] Number of embeds received: ${embedArray.length}`);
    console.log('[DEBUG] Original embeds:', JSON.stringify(embedArray, null, 2));
    
    const processedEmbeds = [];
    let currentSizesEmbed = null;
    
    for (let i = 0; i < embedArray.length; i++) {
        const embed = embedArray[i];
        console.log(`\n[DEBUG] Processing embed ${i + 1}/${embedArray.length}`);
        console.log('[DEBUG] Embed details:', {
            title: embed.title,
            value: embed.value,
            type: typeof embed.value
        });

        // Handle Sizes embed specially
        if (embed.title === 'Sizes') {
            currentSizesEmbed = {
                title: 'Sizes',
                value: ''
            };
            continue;
        }

        // If we have a current Sizes embed and this embed has no title, append to Sizes
        if (currentSizesEmbed && !embed.title && embed.value) {
            currentSizesEmbed.value += (currentSizesEmbed.value ? '\n' : '') + embed.value;
            continue;
        }

        // If this isn't part of Sizes anymore, add the current Sizes embed if we have one
        if (currentSizesEmbed && (embed.title || i === embedArray.length - 1)) {
            if (currentSizesEmbed.value) {
                const processedValue = await processEmbedValue(currentSizesEmbed.value);
                if (processedValue !== currentSizesEmbed.value) {
                    currentSizesEmbed.value = processedValue;
                }
                processedEmbeds.push(currentSizesEmbed);
            }
            currentSizesEmbed = null;
        }

        if (!embed.value || typeof embed.value !== 'string') {
            if (!currentSizesEmbed) { // Only add if not part of Sizes processing
                processedEmbeds.push(embed);
            }
            continue;
        }

        const processedValue = await processEmbedValue(embed.value);
        if (processedValue !== embed.value) {
            embed.value = processedValue;
        }
        if (!currentSizesEmbed) { // Only add if not part of Sizes processing
            processedEmbeds.push(embed);
        }
    }

    // Add any remaining Sizes embed
    if (currentSizesEmbed && currentSizesEmbed.value) {
        const processedValue = await processEmbedValue(currentSizesEmbed.value);
        if (processedValue !== currentSizesEmbed.value) {
            currentSizesEmbed.value = processedValue;
        }
        processedEmbeds.push(currentSizesEmbed);
    }
    
    console.log('\n[DEBUG] ========== Final Processed Embeds ==========');
    console.log('[DEBUG] Processed embeds:', JSON.stringify(processedEmbeds, null, 2));
    console.log('[DEBUG] ========== End Embed Processing ==========\n');
    return processedEmbeds;
}

// Helper function to process embed values
async function processEmbedValue(value) {
    const urlRegex = /\[.*?\]\((.*?)\)|(?:https?:\/\/[^\s<>)"']+[^\s.,;!?)<>'"])/g;
    const matches = [...value.matchAll(urlRegex)];
    console.log(`[DEBUG] Found ${matches.length} URLs in embed`);

    let modifiedValue = value;
    for (let j = 0; j < matches.length; j++) {
        const match = matches[j];
        const originalUrl = match[1] || match[0];
        const fullMatch = match[0];
        const isMarkdown = !!match[1];
        
        console.log(`\n[DEBUG] Processing URL ${j + 1}/${matches.length}:`, originalUrl);
        
        try {
            const unshortenedUrl = await unshorten(originalUrl);
            console.log('[DEBUG] Unshortened URL:', unshortenedUrl);
            
            if (unshortenedUrl.includes('/search')) {
                console.log('[DEBUG] Skipping search URL');
                continue;
            }
            
            const mavelyUrl = await generateMavelyLink(unshortenedUrl);
            console.log('[DEBUG] Mavely URL result:', mavelyUrl);
            
            if (mavelyUrl) {
                if (isMarkdown) {
                    const linkText = fullMatch.match(/\[(.*?)\]/)[1];
                    const newLink = `[${linkText}](${mavelyUrl})`;
                    console.log('[DEBUG] Replacing markdown:', {
                        original: fullMatch,
                        new: newLink
                    });
                    modifiedValue = modifiedValue.replace(fullMatch, newLink);
                } else {
                    console.log('[DEBUG] Replacing URL:', {
                        original: fullMatch,
                        new: mavelyUrl
                    });
                    modifiedValue = modifiedValue.replace(fullMatch, mavelyUrl);
                }
                
                if (modifiedValue === value) {
                    console.log('[DEBUG] WARNING: Replacement failed - string unchanged');
                }
            }
        } catch (error) {
            console.error('[DEBUG] Error processing URL:', error);
        }
    }
    return modifiedValue;
}

// Helper function to send webhook with retries
async function sendWebhookWithRetry(embedArray, webhookUrls, maxRetries = 5, delayBetweenRetries = 1000) {
    console.log('\n[DEBUG] ========== Starting Webhook Send ==========');
    console.log('[DEBUG] Original embeds for webhook:', JSON.stringify(embedArray, null, 2));
    
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const processedEmbeds = await processMavelyLinks(embedArray);
            console.log('[DEBUG] Processed embeds for webhook:', JSON.stringify(processedEmbeds, null, 2));
            
            const randomUrl = getRandomWebhookUrl(webhookUrls);
            console.log('[DEBUG] Selected webhook URL:', randomUrl);
            
            await buildWebhook(processedEmbeds, randomUrl);
            console.log('[DEBUG] Webhook sent successfully');
            console.log('[DEBUG] ========== End Webhook Send ==========\n');
            return;
        } catch (error) {
            attempt++;
            console.error(`[DEBUG] Webhook Error (${attempt}/${maxRetries}):`, error);
            if (attempt < maxRetries) {
                await delay(delayBetweenRetries);
            }
        }
    }
    console.error('[DEBUG] Webhook send failed after all retries');
    console.log('[DEBUG] ========== End Webhook Send ==========\n');
}

// Retry launching the Puppeteer browser
async function retryPuppeteerLaunch(profileNum, maxRetries = 5, delayBetweenRetries = 5000) {
    let attempt = 0;
    let browser = null;
    while (attempt < maxRetries) {
        try {
            browser = await puppeteer.launch({
                headless: false,
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
            return browser;
        } catch (error) {
            attempt++;
            console.error(
                `Browser Launch Error: Failed to launch Puppeteer (Attempt ${attempt}/${maxRetries}) - ${error.message}`
            );
            if (attempt < maxRetries) {
                console.log(`Retrying browser launch in ${delayBetweenRetries / 1000} seconds...`);
                await delay(delayBetweenRetries);
            } else {
                console.error('Browser Launch Error: Maximum retry attempts reached. Exiting...');
                throw new Error('Failed to launch Puppeteer after multiple attempts.');
            }
        }
    }
}

// Main function
async function main() {
    const discordUrl = process.argv[2];
    const webhookUrls = JSON.parse(process.argv[3]);
    const profileNum = process.argv[4];
    console.log(`./my-profile-${profileNum}`);

    let browser;
    try {
        while (true) {
            browser = await retryPuppeteerLaunch(profileNum);
            const mainPage = await browser.newPage();
            await mainPage.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4900.0 Safari/537.36'
            );

            console.log(`Navigating to the target page: ${discordUrl}`);
            await mainPage.goto(discordUrl, { waitUntil: 'domcontentloaded' });
            console.log(`Successfully loaded target page: ${discordUrl}`);

            let channelTitle = '';
            let lastMessageID = null;

            while (true) {
                try {
                    const dataScraped = await ScrapeData(mainPage);
                    const { newestMessageID, embedArray, channelTitle: scrapedTitle } = dataScraped;
                    channelTitle = scrapedTitle;

                    if (!isFirstRun) {
                        if (lastMessageID !== newestMessageID) {
                            console.log(`New message detected: ${newestMessageID}`);
                            await sendWebhookWithRetry(embedArray, webhookUrls);
                            lastMessageID = newestMessageID;
                        }
                    } else {
                        console.log(`Monitoring started for channel: ${channelTitle}`);
                        isFirstRun = false;
                        lastMessageID = newestMessageID;
                    }
                } catch (error) {
                    console.error(`Scraping Error: ${error.message}. Continuing with next iteration.`);
                }
            }
        }
    } catch (error) {
        console.error(`Critical Error: ${error.message}. Exiting script.`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main();
