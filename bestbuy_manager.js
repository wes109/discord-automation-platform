
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs-extra');
const path = require('path');
const { logTask } = require('./utils');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Puppeteer plugins
puppeteer.use(StealthPlugin());

// Set up process exit handler to ensure cleanup
process.on('exit', () => {
    console.log('🔄 [BESTBUY] Process exit detected, cleaning up resources');
    try {
        // Save the link cache on exit
        if (global.bestbuyInstance && global.bestbuyInstance.linkCache) {
            global.bestbuyInstance.saveLinkCache();
        }
    } catch (error) {
        console.error(`❌ [BESTBUY] Error during exit cleanup: ${error.message}`);
    }
});

// Constants
const BESTBUY_LOGIN_URL = 'https://creators.bestbuy.com/login';
const BESTBUY_DASHBOARD_URL = 'https://creators.bestbuy.com/';
const BESTBUY_LINK_GENERATOR_URL = 'https://creators.bestbuy.com/';
const BESTBUY_TOKEN_FILE = '.bestbuy_token';
const BESTBUY_RETRY_COUNT = 3;
const BESTBUY_RETRY_DELAY = 1000;
// Add credentials constants 
const BESTBUY_EMAIL = 'wwchome1@gmail.com';
const BESTBUY_PASSWORD = 'Dixiesghost1!';
// Add session endpoint and token refresh interval (10 seconds)
const BESTBUY_SESSION_ENDPOINT = 'https://creators.bestbuy.com/api/identity/v1/session';
const BESTBUY_TOKEN_REFRESH_INTERVAL = 60 * 1000; // 60 seconds in milliseconds
// Add link cache file path
const BESTBUY_LINK_CACHE_FILE = './bestbuy_link_cache.json';
// Maximum number of cached links (to prevent the file from growing too large)
const BESTBUY_MAX_CACHED_LINKS = 5000;

/**
 * BestBuyManager class for creating affiliate links
 */
class BestBuyManager {
    constructor() {
        console.log('🔍 [BESTBUY] Creating BestBuy Manager instance');
        this.browser = null;
        this.page = null;
        this.isInitialized = false;
        this.token = null;
        this.lastError = null;
        this.tokenRefreshTimer = null;
        this.tokenLastRefreshed = null;
        // Add fields for the authentication tokens
        this.authToken = null;
        this.idToken = null;
        this.refreshToken = null;
        // Initialize network monitoring for bearer tokens
        this.networkTokens = [];
        this.lastTokenCheck = null;
        // Initialize link cache
        this.linkCache = this.loadLinkCache();
        console.log(`🔍 [BESTBUY] Loaded link cache with ${Object.keys(this.linkCache).length} entries`);
        
        // Store the instance globally for access during process exit
        global.bestbuyInstance = this;
        
        this.validDomains = [
            'bestbuy.com',
            'bestbuy.ca',
            'creators.bestbuy.com'
        ];
        console.log(`🔍 [BESTBUY] Initialized with ${this.validDomains.length} supported domains`);
    }

    /**
     * Load the link cache from disk
     * @returns {Object} - The link cache object
     */
    loadLinkCache() {
        try {
            if (fs.existsSync(BESTBUY_LINK_CACHE_FILE)) {
                const cacheData = fs.readFileSync(BESTBUY_LINK_CACHE_FILE, 'utf8');
                const cache = JSON.parse(cacheData);
                console.log(`✅ [BESTBUY] Successfully loaded link cache from ${BESTBUY_LINK_CACHE_FILE}`);
                return cache;
            }
        } catch (error) {
            console.error(`❌ [BESTBUY] Error loading link cache: ${error.message}`);
        }
        
        // Return empty cache if file doesn't exist or there was an error
        return {};
    }

    /**
     * Save the link cache to disk
     */
    saveLinkCache() {
        try {
            const cacheData = JSON.stringify(this.linkCache, null, 2);
            fs.writeFileSync(BESTBUY_LINK_CACHE_FILE, cacheData);
            console.log(`✅ [BESTBUY] Successfully saved link cache to ${BESTBUY_LINK_CACHE_FILE}`);
        } catch (error) {
            console.error(`❌ [BESTBUY] Error saving link cache: ${error.message}`);
        }
    }

    /**
     * Add a link to the cache and save the cache to disk
     * @param {string} originalUrl - The original URL
     * @param {string} bestbuyLink - The generated BestBuy link
     */
    addToLinkCache(originalUrl, bestbuyLink) {
        // Normalize the URL to ensure consistent keys
        const normalizedUrl = this.normalizeUrl(originalUrl);
        
        // Add to cache
        this.linkCache[normalizedUrl] = {
            original: originalUrl,
            bestbuy: bestbuyLink,
            timestamp: new Date().toISOString()
        };
        
        // Limit cache size if it grows too large
        const keys = Object.keys(this.linkCache);
        if (keys.length > BESTBUY_MAX_CACHED_LINKS) {
            // Sort by timestamp (oldest first)
            keys.sort((a, b) => {
                const dateA = new Date(this.linkCache[a].timestamp);
                const dateB = new Date(this.linkCache[b].timestamp);
                return dateA - dateB;
            });
            
            // Remove oldest entries to get back to max size
            const removeCount = keys.length - BESTBUY_MAX_CACHED_LINKS;
            for (let i = 0; i < removeCount; i++) {
                delete this.linkCache[keys[i]];
            }
            
            console.log(`🔍 [BESTBUY] Pruned ${removeCount} old entries from link cache`);
        }
        
        // Save the updated cache
        this.saveLinkCache();
    }

    /**
     * Check if a URL is in the link cache
     * @param {string} url - The URL to check
     * @returns {string|null} - The cached BestBuy link or null if not in cache
     */
    getFromLinkCache(url) {
        const normalizedUrl = this.normalizeUrl(url);
        const cached = this.linkCache[normalizedUrl];
        
        if (cached && cached.bestbuy) {
            return cached.bestbuy;
        }
        
        return null;
    }

    /**
     * Normalize a URL to create a consistent cache key
     * @param {string} url - The URL to normalize
     * @returns {string} - The normalized URL
     */
    normalizeUrl(url) {
        try {
            // Parse the URL
            const urlObj = new URL(url);
            
            // Convert hostname to lowercase
            urlObj.hostname = urlObj.hostname.toLowerCase();
            
            // Special handling for BestBuy URLs
            if (urlObj.hostname.includes('bestbuy.com')) {
                // For BestBuy, extract the product ID (skuId)
                const pathMatch = urlObj.pathname.match(/\/p\/([^\/]+)/);
                if (pathMatch) {
                    return `bestbuy.com/p/${pathMatch[1]}`;
                }
            }
            
            // Default: use full hostname and pathname
            return `${urlObj.hostname}${urlObj.pathname}`;
        } catch (error) {
            console.error(`❌ [BESTBUY] Error normalizing URL: ${error.message}`);
            // If URL parsing fails, just return the original URL
            return url;
        }
    }

    /**
     * Check if a URL is valid for BestBuy affiliate links
     * @param {string} url - The URL to check
     * @returns {boolean} - Whether the URL is valid
     */
    isValidUrl(url) {
        return this.validateUrl(url);
    }

    /**
     * Check if a URL is likely to be compatible with BestBuy
     * @param {string} url - The URL to check
     * @returns {boolean} - Whether the URL is likely to be compatible with BestBuy
     */
    isLikelyCompatibleWithBestBuy(url) {
        return this.validateUrl(url);
    }

    /**
     * Validate a URL for BestBuy compatibility
     * @param {string} url - The URL to validate
     * @returns {boolean} - Whether the URL is valid for BestBuy
     */
    validateUrl(url) {
        try {
            if (!url) {
                return false;
            }

            // Ensure URL is a string
            const urlString = String(url);
            
            // Try to create a URL object to validate format
            let urlObj;
            try {
                urlObj = new URL(urlString);
            } catch (error) {
                // If the URL is not properly formatted, try adding https://
                try {
                    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
                        urlObj = new URL(`https://${urlString}`);
                    } else {
                        return false;
                    }
                } catch (innerError) {
                    return false;
                }
            }

            // Extract the hostname
            const hostname = urlObj.hostname.toLowerCase();
            
            // Check if the hostname is in our list of valid domains
            const isValid = this.validDomains.some(domain => {
                return hostname.includes(domain) || hostname.endsWith(domain);
            });

            return isValid;
        } catch (error) {
            return false;
        }
    }

    /**
     * Initialize the BestBuy Manager
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether initialization was successful
     */
    async initialize(taskId = 'BESTBUY') {
        try {
            logTask(taskId, 'INFO', 'Initializing BestBuy Manager');
            
            // Check for saved bearer token
            if (fs.existsSync(BESTBUY_TOKEN_FILE)) {
                try {
                    const savedToken = fs.readFileSync(BESTBUY_TOKEN_FILE, 'utf8');
                    this.token = savedToken;
                    this.idToken = savedToken;
                    logTask(taskId, 'INFO', 'Found saved BestBuy bearer token');
                } catch (error) {
                    logTask(taskId, 'WARNING', 'Error reading saved bearer token');
                }
            }
            
            // Launch browser
            logTask(taskId, 'INFO', 'Launching BestBuy browser');
            this.browser = await puppeteer.launch({
                headless: false, // Set to boolean false for headed mode
                defaultViewport: {
                    width: 1280,
                    height: 800
                },
                args: [
                    '--no-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials',
                    '--disable-setuid-sandbox',
                    '--disable-accelerated-2d-canvas',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--disable-extensions'
                ],
                timeout: 60000 // Increase browser launch timeout to 60 seconds
            });
            
            // Add browser disconnection handler to detect when browser is manually closed
            this.browser.on('disconnected', async () => {
                console.log('💤 [BESTBUY] Browser was disconnected (possibly closed manually)');
                
                // Save the link cache
                this.saveLinkCache();
                
                // Clear any running timers
                if (this.tokenRefreshTimer) {
                    clearInterval(this.tokenRefreshTimer);
                    this.tokenRefreshTimer = null;
                }
                
                // Reset all the state
                this.browser = null;
                this.page = null;
                this.isInitialized = false;
                
                // Force the Node.js process to exit if running as part of the BestBuy service
                if (process.env.BESTBUY_SERVICE_PROCESS) {
                    console.log('💤 [BESTBUY] Shutting down service due to browser disconnection');
                    process.exit(0);
                }
            });
            
            // Use the first page instead of creating a new one
            const pages = await this.browser.pages();
            this.page = pages[0];
            
            // Set a user agent to mimic a real browser
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
            
            // No need to restore cookies for bearer token authentication
            
            // Set viewport
            await this.page.setViewport({ width: 1280, height: 800 });
            
            // Set default timeout for all navigations
            this.page.setDefaultNavigationTimeout(60000);
            
            // Set default timeout for waitFor functions
            this.page.setDefaultTimeout(30000);
            
            // Set up network monitoring to capture bearer tokens
            await this.setupNetworkMonitoring();
            
            // Login to BestBuy
            logTask(taskId, 'INFO', 'Navigating to BestBuy login page');
            await this.login(taskId);
            
            // Check if login was successful
            if (await this.isLoggedIn()) {
                logTask(taskId, 'SUCCESS', 'Successfully logged into BestBuy');
                
                // Fetch the initial session cookies
                logTask(taskId, 'INFO', 'Fetching initial session cookies');
                await this.refreshAuthToken(taskId);
                
                // Start the session refresh timer
                this.startTokenRefreshTimer(taskId);
                
                this.isInitialized = true;
                return true;
            } else {
                logTask(taskId, 'ERROR', 'Failed to log into BestBuy');
                return false;
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error initializing BestBuy Manager: ${error.message}`, error);
            this.lastError = error.message;
            return false;
        }
    }

    /**
     * Check if user is logged into BestBuy
     * @returns {Promise<boolean>} - Whether user is logged in
     */
    async isLoggedIn() {
        try {
            // Get current URL without navigating
            const currentUrl = this.page.url();
            
            // If we're on the login page, we're not logged in
            if (currentUrl.includes('/login')) {
                return false;
            }
            
            // If we're on a different page, check if we get redirected to login
            if (!currentUrl.includes('creators.bestbuy') || currentUrl === 'about:blank') {
                await this.page.goto(BESTBUY_DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 60000 });
                const newUrl = this.page.url();
                return !newUrl.includes('/login');
            }
            
            // Already on a BestBuy creators page and not on login page
            return true;
        } catch (error) {
            console.error('Error checking login status:', error);
            return false;
        }
    }

    /**
     * Login to BestBuy
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether login was successful
     */
    async login(taskId) {
        try {
            // Navigate to the login page
            logTask(taskId, 'INFO', `Navigating to BestBuy login page: ${BESTBUY_LOGIN_URL}`);
            await this.page.goto(BESTBUY_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Check if we need to log in or are already logged in
            if (!await this.isLoggedIn()) {
                logTask(taskId, 'INFO', 'On BestBuy login page - attempting automated login');
                
                try {
                    // Step 1: Wait for page DOM to load, then fill email field
                    logTask(taskId, 'INFO', 'Waiting for page DOM to load...');
                    await this.page.waitForSelector('#email', { timeout: 30000 });
                    
                    // Fill email field
                    logTask(taskId, 'INFO', 'Filling in email field');
                    await this.page.type('#email', BESTBUY_EMAIL);
                    
                    // Click the submit button for email
                    logTask(taskId, 'INFO', 'Clicking email submit button');
                    await this.page.click('.onboarding-user-input-submit');
                    
                    // Step 2: Wait for DOM content to load again
                    logTask(taskId, 'INFO', 'Waiting for DOM content to load after email submission...');
                    await this.page.waitForSelector('input[type="password"]', { timeout: 30000 });
                    
                    // Step 3: Fill password field
                    logTask(taskId, 'INFO', 'Filling in password field');
                    await this.page.type('input[type="password"]', BESTBUY_PASSWORD);
                    
                    // Step 4: Click the password submit button
                    logTask(taskId, 'INFO', 'Clicking password submit button');
                    await this.page.click('div[class="impact-auth-password"] button');
                    
                                // Step 5: Wait for the login to complete and check for proper authentication
            logTask(taskId, 'INFO', 'Login steps completed. Waiting for authentication to finalize...');
            
            // Wait longer for the login to fully complete
            await delay(5000);
            
            // Check if login was successful
            const currentUrl = this.page.url();
            const isLoginPage = currentUrl.includes('/login');
            
            if (!isLoginPage) {
                logTask(taskId, 'SUCCESS', `Successfully logged into BestBuy (now at: ${currentUrl})`);
                
                // Wait a bit more for all cookies to be set
                await delay(2000);
                
                // Extract bearer token from the page
                logTask(taskId, 'INFO', 'Extracting bearer token from page...');
                const bearerToken = await this.extractBearerToken();
                
                if (bearerToken) {
                    this.idToken = bearerToken;
                    this.token = bearerToken;
                    fs.writeFileSync(BESTBUY_TOKEN_FILE, bearerToken);
                    logTask(taskId, 'SUCCESS', 'Successfully extracted and saved BestBuy bearer token');
                } else {
                    logTask(taskId, 'WARNING', 'Could not extract bearer token, falling back to cookies');
                    // Fallback to cookies if token extraction fails
                    const cookies = await this.page.cookies();
                    if (cookies.length > 0) {
                        this.token = JSON.stringify(cookies);
                        fs.writeFileSync(BESTBUY_TOKEN_FILE, this.token);
                        logTask(taskId, 'SUCCESS', 'Saved BestBuy session cookies as fallback');
                    }
                }
                
                return true;
            } else {
                logTask(taskId, 'WARNING', 'Still on login page after attempting to login');
                return false;
            }
                    
                } catch (loginError) {
                    logTask(taskId, 'ERROR', `Error during automated login: ${loginError.message}`);
                    throw loginError;
                }
            } else {
                logTask(taskId, 'INFO', 'Already logged into BestBuy');
                return true;
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error logging into BestBuy: ${error.message}`, error);
            return false;
        }
    }

    /**
     * Generate a BestBuy affiliate link for a given URL
     * @param {string} url - The URL to generate a BestBuy link for
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<string>} - The generated BestBuy link or the original URL if unsuccessful
     */
    async generateBestBuyLink(url, taskId = 'BESTBUY') {
        try {
            console.log(`🔄 [BESTBUY] Generating BestBuy link for URL: ${url}`);
            
            // Validate initialization
            if (!this.isInitialized || !this.browser || !this.page) {
                console.log(`❌ [BESTBUY] BestBuy Manager not initialized`);
                throw new Error('BestBuy Manager not initialized');
            }
            
            // Validate URL
            if (!this.validateUrl(url)) {
                console.log(`❌ [BESTBUY] URL not valid for BestBuy: ${url}`);
                return url;
            }
            
            // Step 1: Check if URL is already in the *in-memory* cache
            const cachedLink = this.getFromLinkCache(url);
            if (cachedLink) {
                console.log(`✅ [BESTBUY] Using cached BestBuy link: ${cachedLink}`);
                return cachedLink;
            }

            // Step 3: If still not found, proceed with login check, token refresh, API call
            console.log(`🔄 [BESTBUY] Link not found in cache. Proceeding to generate...`);
            
            // Make sure we're logged in
            if (!await this.isLoggedIn()) {
                console.log(`🔄 [BESTBUY] Need to log in to BestBuy first`);
                const loginSuccess = await this.login(taskId);
                if (!loginSuccess) {
                    console.log(`❌ [BESTBUY] Failed to log in to BestBuy`);
                    throw new Error('Failed to log in to BestBuy');
                }
                // Refresh token after login
                await this.refreshAuthToken(taskId);
            }
            
            // Check if session is expired or missing, and refresh if needed
            const now = new Date();
            const sessionAge = this.tokenLastRefreshed ? now - this.tokenLastRefreshed : Infinity;
            
            // Use a longer expiration window (5 minutes) since we refresh every 10 seconds
            if (!this.token || sessionAge > 5 * 60 * 1000) {
                console.log(`🔄 [BESTBUY] Session is expired or missing, refreshing...`);
                const refreshSuccess = await this.refreshAuthToken(taskId);
                if (!refreshSuccess) {
                    console.log(`❌ [BESTBUY] Failed to refresh session`);
                    throw new Error('Failed to refresh session');
                }
            }
            
            if (!this.token) {
                console.log(`❌ [BESTBUY] No bearer token available after refresh`);
                throw new Error('No bearer token available after refresh');
            }
            
            // Generate BestBuy affiliate link using the API
            console.log(`🔄 [BESTBUY] Making API call to generate affiliate link`);
            
            // Debug: Check what cookies we have
            const cookies = await this.page.cookies();
            console.log(`🔍 [BESTBUY] Available cookies:`, cookies.map(c => ({ name: c.name, domain: c.domain })));
            
            // Ensure we're on the creators.bestbuy.com domain for the API call
            const currentUrl = this.page.url();
            if (!currentUrl.includes('creators.bestbuy.com')) {
                console.log(`🔄 [BESTBUY] Navigating to creators.bestbuy.com for API call`);
                await this.page.goto(BESTBUY_DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 30000 });
            }
            
            const apiResponse = await this.page.evaluate(async (url, bearerToken) => {
                try {
                    const headers = {
                        "accept": "application/json, text/plain, */*",
                        "content-type": "application/json",
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-site": "same-origin"
                    };
                    
                    // Add bearer token if available
                    if (bearerToken) {
                        headers["authorization"] = `Bearer ${bearerToken}`;
                    }
                    
                    const response = await fetch("https://creators.bestbuy.com/privatemarketplace-api/tracking_link/create", {
                        method: "POST",
                        headers: headers,
                        credentials: "include", // Keep cookies as backup
                        body: JSON.stringify({
                            "vanity_link": "",
                            "shared_id": "",
                            "media_property_id": "",
                            "influencer_organization_id": 500594530,
                            "deep_link": url
                        })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`API request failed with status ${response.status}`);
                    }
                    
                    return await response.json();
                } catch (error) {
                    return { error: error.message };
                }
            }, url, this.idToken);
            
            console.log(`🔍 [BESTBUY] API response:`, apiResponse);
            
            // Check if the API call was successful
            if (apiResponse.error) {
                console.log(`❌ [BESTBUY] API error: ${apiResponse.error}`);
                throw new Error(`API error: ${apiResponse.error}`);
            }
            
            if (!apiResponse.trackingLinkUrl) {
                console.log(`❌ [BESTBUY] API did not return a tracking link URL`);
                throw new Error('API did not return a tracking link URL');
            }
            
            const generatedLink = apiResponse.trackingLinkUrl;
            console.log(`✅ [BESTBUY] Successfully generated BestBuy link: ${generatedLink}`);
            
            // Add the successful link to the cache
            this.addToLinkCache(url, generatedLink);
            
            return generatedLink;
        } catch (error) {
            console.error(`❌ [BESTBUY] Error in generateBestBuyLink: ${error.message}`);
            
            return url;
        }
    }

    /**
     * Close the BestBuy browser
     * @returns {Promise<boolean>} - Whether closure was successful
     */
    async close() {
        try {
            // Save the link cache before closing
            this.saveLinkCache();
            
            // Clear the bearer token refresh timer
            if (this.tokenRefreshTimer) {
                clearInterval(this.tokenRefreshTimer);
                this.tokenRefreshTimer = null;
            }
            
            if (this.browser) {
                // Set a timeout to force cleanup if browser doesn't close cleanly
                const forceShutdownTimer = setTimeout(() => {
                    console.log('⚠️ [BESTBUY] Browser close timed out, forcing cleanup');
                    this.browser = null;
                    this.page = null;
                    this.isInitialized = false;
                    
                    // Force process exit if running as a service
                    if (process.env.BESTBUY_SERVICE_PROCESS === 'true') {
                        console.log('💤 [BESTBUY] Forcing service shutdown due to browser close timeout');
                        process.exit(1);
                    }
                }, 60000);
            
                const pages = await this.browser.pages();
                
                // Close all pages first
                for (const page of pages) {
                    try {
                        await page.close();
                    } catch (error) {
                        console.error(`Error closing page: ${error.message}`);
                    }
                }
                
                // Then close the browser
                await this.browser.close();
                
                // Clear the force shutdown timer since we closed successfully
                clearTimeout(forceShutdownTimer);
                
                this.browser = null;
                this.page = null;
                this.isInitialized = false;
                return true;
            }
            return true; // Already closed
        } catch (error) {
            console.error(`Error closing BestBuy browser: ${error.message}`);
            // Force set to null even if there was an error
            this.browser = null;
            this.page = null;
            this.isInitialized = false;
            this.tokenRefreshTimer = null;
            
            // Force process exit if running as a service and there was an error closing
            if (process.env.BESTBUY_SERVICE_PROCESS === 'true') {
                console.log('💤 [BESTBUY] Forcing service shutdown due to browser close error');
                process.exit(1);
            }
            
            return false;
        }
    }

    /**
     * Start the bearer token refresh timer
     * @param {string} taskId - The task ID for logging
     */
    startTokenRefreshTimer(taskId = 'BESTBUY') {
        logTask(taskId, 'INFO', `Starting bearer token refresh timer (interval: ${BESTBUY_TOKEN_REFRESH_INTERVAL}ms)`);
        
        // Clear any existing timer
        if (this.tokenRefreshTimer) {
            clearInterval(this.tokenRefreshTimer);
        }
        
        // Set up the timer to refresh the bearer token periodically
        this.tokenRefreshTimer = setInterval(async () => {
            try {
                logTask(taskId, 'INFO', 'Bearer token refresh timer triggered');
                await this.refreshAuthToken(taskId);
            } catch (error) {
                logTask(taskId, 'ERROR', `Error in bearer token refresh: ${error.message}`);
            }
        }, BESTBUY_TOKEN_REFRESH_INTERVAL);
    }

    /**
     * Set up network monitoring to capture bearer tokens from API calls
     */
    async setupNetworkMonitoring() {
        try {
            // Listen for all network requests
            await this.page.setRequestInterception(true);
            
            this.page.on('request', request => {
                // Check if this is a BestBuy API call
                if (request.url().includes('bestbuy') && request.url().includes('api')) {
                    const headers = request.headers();
                    const authHeader = headers['authorization'] || headers['Authorization'];
                    
                    if (authHeader && authHeader.startsWith('Bearer ')) {
                        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
                        
                        // Store the token with timestamp
                        this.networkTokens.push({
                            token: token,
                            timestamp: new Date(),
                            url: request.url()
                        });
                        
                        // Keep only the last 10 tokens
                        if (this.networkTokens.length > 10) {
                            this.networkTokens.shift();
                        }
                        
                        // Update the current token
                        this.idToken = token;
                        this.token = token;
                    }
                }
                
                request.continue();
            });
            
            console.log(`✅ [BESTBUY] Network monitoring set up successfully`);
        } catch (error) {
            console.error(`❌ [BESTBUY] Error setting up network monitoring: ${error.message}`);
        }
    }

    /**
     * Extract bearer token from captured network calls
     * @returns {Promise<string|null>} - The bearer token or null if not found
     */
    async extractBearerToken() {
        try {
            // Check if we have any captured tokens
            if (this.networkTokens.length > 0) {
                // Get the most recent token
                const latestToken = this.networkTokens[this.networkTokens.length - 1];
                const tokenAge = Date.now() - latestToken.timestamp.getTime();
                
                // If token is less than 5 minutes old, use it
                if (tokenAge < 5 * 60 * 1000) {
                    console.log(`🔍 [BESTBUY] Found bearer token: ${latestToken.token.substring(0, 20)}...`);
                    return latestToken.token;
                }
            }
            
            console.log(`🔍 [BESTBUY] No recent bearer token found in network calls`);
            return null;
        } catch (error) {
            console.error(`❌ [BESTBUY] Error extracting bearer token: ${error.message}`);
            return null;
        }
    }

    /**
     * Refresh the auth token by calling the session endpoint
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether the refresh was successful
     */
    async refreshAuthToken(taskId = 'BESTBUY') {
        try {
            logTask(taskId, 'INFO', 'Refreshing BestBuy bearer token');
            
            if (!this.page || !this.isLoggedIn()) {
                logTask(taskId, 'ERROR', 'Cannot refresh token: not logged in or page not available');
                return false;
            }
            
            // Navigate to the dashboard to refresh the session
            await this.page.goto(BESTBUY_DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 30000 });
            
            // Wait for page load complete and additional time for API calls
            logTask(taskId, 'INFO', 'Waiting for page load complete...');
            await delay(5000); // Wait for page to fully load and any API calls to complete
            
            // Check for any recent network calls that might have captured tokens
            logTask(taskId, 'INFO', 'Checking for recent bearer tokens from network calls...');
            const freshToken = await this.extractBearerToken();
            
            if (freshToken) {
                this.idToken = freshToken;
                this.token = freshToken;
                fs.writeFileSync(BESTBUY_TOKEN_FILE, freshToken);
                this.tokenLastRefreshed = new Date();
                logTask(taskId, 'SUCCESS', 'Successfully refreshed BestBuy bearer token');
                return true;
            } else {
                logTask(taskId, 'WARNING', 'Could not extract fresh bearer token, trying fallback');
                // Fallback to cookies if token extraction fails
                const cookies = await this.page.cookies();
                if (cookies.length > 0) {
                    this.token = JSON.stringify(cookies);
                    fs.writeFileSync(BESTBUY_TOKEN_FILE, this.token);
                    this.tokenLastRefreshed = new Date();
                    logTask(taskId, 'SUCCESS', 'Successfully refreshed BestBuy session cookies as fallback');
                    return true;
                } else {
                    logTask(taskId, 'ERROR', 'No authentication method available after refresh');
                    return false;
                }
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error refreshing token: ${error.message}`);
            return false;
        }
    }
}

module.exports = BestBuyManager;
