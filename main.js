const { fork } = require('child_process');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const config = require('./config.json');
const mavelyManager = require('./mavely');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    try {
        // Initialize Mavely manager first
        console.log('Initializing Mavely manager...');
        await mavelyManager.initialize();
        console.log('Mavely manager initialized successfully.');

        for (let i = 0; i < config.length; i++) {
            const { discordUrl, webhookUrls } = config[i];
            const webhookUrlsString = JSON.stringify(webhookUrls);

            const childProcess = fork('./task.js', [discordUrl, webhookUrlsString, i + 1], {
                stdio: 'inherit',
            });

            childProcess.on('close', (code) => {
                console.log(`Puppeteer instance for ${discordUrl} exited with code ${code}`);
            });

            await delay(10000);
        }
    } catch (error) {
        console.error('Error initializing Mavely:', error);
        process.exit(1);
    }
})();
