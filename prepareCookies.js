const dotenv = require('dotenv');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const fs = require('fs-extra');
const path = require('path');

// Initialize plugins
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin());

// Parse command line arguments
const args = process.argv.slice(2);
const numberOfCopies = parseInt(args[0]) || 1;

(async () => {
    try {
        // Load environment variables
        dotenv.config();
        
        console.log(`Will generate ${numberOfCopies} profile(s)`);

        // Clean up existing profiles
        const baseDir = process.cwd();
        const existingProfiles = await fs.readdir(baseDir);
        for (const profile of existingProfiles) {
            if (profile.startsWith('my-profile')) {
                const profilePath = path.join(baseDir, profile);
                console.log(`Cleaning up: ${profilePath}`);
                await fs.remove(profilePath);
            }
        }

        // Create and set up main profile
        const mainProfilePath = path.join(baseDir, 'my-profile');
        console.log('Setting up main profile at:', mainProfilePath);
        await fs.ensureDir(mainProfilePath);

        const browser = await puppeteer.launch({
            headless: false,
            userDataDir: mainProfilePath,
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--start-maximized',
            ],
        });

        const page = await browser.newPage();
        
        // Enable request interception to capture auth token
        await page.setRequestInterception(true);
        let authToken = null;
        
        page.on('request', request => {
            const headers = request.headers();
            if (headers.authorization) {
                authToken = headers.authorization;
            }
            request.continue();
        });

        console.log('Navigating to Discord...');
        await page.goto('https://discord.com/channels/@me', { 
            waitUntil: ['domcontentloaded', 'networkidle0'],
            timeout: 600000 
        });

        console.log('Waiting for login...');
        await Promise.race([
            page.waitForSelector('div[aria-label="Servers"]', { timeout: 600000 }),
            page.waitForSelector('button[type="submit"]', { timeout: 600000 })
        ]);

        const loginButton = await page.$('button[type="submit"]');
        if (loginButton) {
            console.log('Login required. Please log in manually...');
            await page.waitForSelector('div[aria-label="Servers"]', { timeout: 600000 });
        }

        // Wait for auth token with timeout
        console.log('Waiting for authentication token...');
        let tokenTimeout = 60000; // 1 minute timeout
        let startTime = Date.now();
        
        while (!authToken && Date.now() - startTime < tokenTimeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!authToken) {
            throw new Error('Failed to capture authentication token');
        }

        // Save auth token and cookies
        await fs.writeFile(path.join(mainProfilePath, 'auth-token.txt'), authToken);
        console.log('Authentication token saved!');

        const cookies = await page.cookies();
        await fs.writeFile(
            path.join(mainProfilePath, 'cookies.json'), 
            JSON.stringify(cookies, null, 2)
        );
        console.log('Cookies saved!');

        await browser.close();
        
        // Create profile copies
        console.log('Creating profile copies...');
        for (let i = 1; i <= numberOfCopies; i++) {
            const copyPath = path.join(baseDir, `my-profile-${i}`);
            await fs.copy(mainProfilePath, copyPath);
            console.log(`Created profile: my-profile-${i}`);
        }

        // Verify profiles were created
        const finalCheck = await fs.readdir(baseDir);
        const profileCount = finalCheck.filter(f => f.startsWith('my-profile-')).length;
        
        if (profileCount !== numberOfCopies) {
            throw new Error(`Profile creation failed. Expected ${numberOfCopies} profiles but found ${profileCount}`);
        }

        console.log('✅ Profile setup completed successfully!');
        console.log(`Created ${profileCount} profiles`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Error during profile setup:', error.message);
        process.exit(1);
    }
})();
