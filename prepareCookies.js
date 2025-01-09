const dotenv = require('dotenv');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const fs = require('fs-extra'); // Import the fs-extra library for file operations
const { ScrapeData } = require('./scrape'); // Import the ScrapeData function
const { buildWebhook } = require('./webhook'); // Import the buildWebhook function

(async () => {
    dotenv.config();
    const args = process.argv.slice(2);

    // Delete any folder containing the name 'my-profile' if it exists
    const existingProfiles = await fs.readdir('.');
    for (const profile of existingProfiles) {
        if (profile.includes('my-profile')) {
            console.log(`Deleting folder: ${profile}`);
            await fs.remove(profile);
        }
    }

    // Create a new 'my-profile' folder with the same userDataDir

    // Launch Puppeteer with the userDataDir pointing to 'my-profile'
    const browser = await puppeteer.launch({
        headless: false, // Run Chrome in headless mode to save resources
        userDataDir: './my-profile',
        args: [
            '--no-sandbox', // Disable sandboxing for less resource usage
            '--disable-gpu', // Disable GPU for less resource usage
            '--disable-dev-shm-usage', // Disable /dev/shm usage for less memory usage
            '--start-maximized', // Start the browser in full-screen mode
        ],
        defaultViewport: null, // Ensure Puppeteer does not override the full-screen setting
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4900.0 Safari/537.36');

    var discordUrl = process.env.CHANNEL_URL;
    const discordUrlIndex = args.indexOf('--discordUrl');
    if (discordUrlIndex !== -1) {
        // If the flag is provided, update discordUrl with the following argument
        discordUrl = args[discordUrlIndex + 1];
    }

    var webhookUrl = process.env.WEBHOOK_URL;
    
    // Set default timeout for all operations
    page.setDefaultTimeout(600000); // 10 minutes
    page.setDefaultNavigationTimeout(600000); // 10 minutes

    console.log('Navigating to Discord...');
    await page.goto('https://discord.com/channels/@me', { 
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 600000 
    });

    console.log('Waiting for element to appear...');

    try {
        // Wait for an element with the selector you want to wait for
        await page.waitForSelector('div[aria-label="Servers"]', { timeout: 600000 });

        console.log('Element found! Saving Cookies...');
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        await delay(3000);

        // Close the browser
        await browser.close();
        
        // Now, copy 'my-profile' folder multiple times based on the length of config.json array
        const config = require('./config.json'); // Load configuration from config.json
        const numberOfCopies = config.length;

        for (let i = 1; i <= numberOfCopies; i++) {
            await fs.copy('./my-profile', `./my-profile-${i}`);
            console.log(`Copied 'my-profile' to 'my-profile-${i}'`);
        }

    } catch (error) {
        console.error('Element not found:', error);
        await browser.close();
    }
})();
