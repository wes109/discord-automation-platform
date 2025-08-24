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
    console.log('🔄 [MAVELY] Process exit detected, cleaning up resources');
    try {
        // Save the link cache on exit
        if (global.mavelyInstance && global.mavelyInstance.linkCache) {
            global.mavelyInstance.saveLinkCache();
        }
    } catch (error) {
        console.error(`❌ [MAVELY] Error during exit cleanup: ${error.message}`);
    }
});

// Constants
const MAVELY_LOGIN_URL = 'https://creators.joinmavely.com/auth/login';
const MAVELY_DASHBOARD_URL = 'https://creators.joinmavely.com/dashboard';
const MAVELY_LINK_GENERATOR_URL = 'https://creators.joinmavely.com/dashboard';
const MAVELY_TOKEN_FILE = '.mavely_token';
const MAVELY_RETRY_COUNT = 3;
const MAVELY_RETRY_DELAY = 1000;
// Add credentials constants 
const MAVELY_EMAIL = 'wwchome1@gmail.com';
const MAVELY_PASSWORD = 'Dixiesghost1';
// Add session endpoint and token refresh interval (1 minute)
const MAVELY_SESSION_ENDPOINT = 'https://creators.joinmavely.com/api/auth/session';
const MAVELY_TOKEN_REFRESH_INTERVAL = 60 * 1000; // 1 minute in milliseconds
// Add link cache file path
const MAVELY_LINK_CACHE_FILE = './mavely_link_cache.json';
// Maximum number of cached links (to prevent the file from growing too large)
const MAVELY_MAX_CACHED_LINKS = 5000;

/**
 * MavelyManager class for creating affiliate links
 */
class MavelyManager {
    constructor() {
        console.log('🔍 [MAVELY] Creating Mavely Manager instance');
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
        // Initialize link cache
        this.linkCache = this.loadLinkCache();
        console.log(`🔍 [MAVELY] Loaded link cache with ${Object.keys(this.linkCache).length} entries`);
        
        // Store the instance globally for access during process exit
        global.mavelyInstance = this;
        
        this.validDomains = [
            'target.com',
            'nike.com',
            'adidas.com',
            'amazon.com',
            'bestbuy.com',
            'walmart.com',
            'apple.com',
            'sephora.com',
            'ulta.com',
            'nordstrom.com',
            'macys.com',
            'kohls.com',
            'homedepot.com',
            'lowes.com',
            'wayfair.com',
            'bed-bath-beyond.com',
            'bedbathandbeyond.com',
            'ikea.com',
            'crateandbarrel.com',
            'potterybarn.com',
            'westelm.com',
            'staples.com',
            'officedepot.com',
            'petco.com',
            'petsmart.com',
            'chewy.com',
            'footlocker.com',
            'finishline.com',
            'dickssportinggoods.com',
            'gap.com',
            'oldnavy.com',
            'ae.com',
            'jcpenney.com',
            'lululemon.com',
            'underarmour.com',
            'zappos.com',
            'dsw.com'
        ];
        console.log(`🔍 [MAVELY] Initialized with ${this.validDomains.length} supported domains`);
    }

    /**
     * Load the link cache from disk
     * @returns {Object} - The link cache object
     */
    loadLinkCache() {
        try {
            if (fs.existsSync(MAVELY_LINK_CACHE_FILE)) {
                const cacheData = fs.readFileSync(MAVELY_LINK_CACHE_FILE, 'utf8');
                const cache = JSON.parse(cacheData);
                console.log(`✅ [MAVELY] Successfully loaded link cache from ${MAVELY_LINK_CACHE_FILE}`);
                return cache;
            }
        } catch (error) {
            console.error(`❌ [MAVELY] Error loading link cache: ${error.message}`);
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
            fs.writeFileSync(MAVELY_LINK_CACHE_FILE, cacheData);
            console.log(`✅ [MAVELY] Successfully saved link cache to ${MAVELY_LINK_CACHE_FILE}`);
        } catch (error) {
            console.error(`❌ [MAVELY] Error saving link cache: ${error.message}`);
        }
    }

    /**
     * Add a link to the cache and save the cache to disk
     * @param {string} originalUrl - The original URL
     * @param {string} mavelyLink - The generated Mavely link
     */
    addToLinkCache(originalUrl, mavelyLink) {
        // Normalize the URL to ensure consistent keys
        const normalizedUrl = this.normalizeUrl(originalUrl);
        
        // Add to cache
        this.linkCache[normalizedUrl] = {
            original: originalUrl,
            mavely: mavelyLink,
            timestamp: new Date().toISOString()
        };
        
        // Limit cache size if it grows too large
        const keys = Object.keys(this.linkCache);
        if (keys.length > MAVELY_MAX_CACHED_LINKS) {
            // Sort by timestamp (oldest first)
            keys.sort((a, b) => {
                const dateA = new Date(this.linkCache[a].timestamp);
                const dateB = new Date(this.linkCache[b].timestamp);
                return dateA - dateB;
            });
            
            // Remove oldest entries to get back to max size
            const removeCount = keys.length - MAVELY_MAX_CACHED_LINKS;
            for (let i = 0; i < removeCount; i++) {
                delete this.linkCache[keys[i]];
            }
            
            console.log(`🔍 [MAVELY] Pruned ${removeCount} old entries from link cache`);
        }
        
        // Save the updated cache
        this.saveLinkCache();
    }

    /**
     * Check if a URL is in the link cache
     * @param {string} url - The URL to check
     * @returns {string|null} - The cached Mavely link or null if not in cache
     */
    getFromLinkCache(url) {
        const normalizedUrl = this.normalizeUrl(url);
        const cached = this.linkCache[normalizedUrl];
        
        if (cached && cached.mavely) {
            console.log(`✅ [MAVELY] Found URL in cache: ${url} → ${cached.mavely}`);
            return cached.mavely;
        }
        
        console.log(`🔍 [MAVELY] URL not found in cache: ${url}`);
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
            
            // Special handling for different retailers
            if (urlObj.hostname.includes('target.com')) {
                // For Target, keep the path with product ID (A-12345678)
                const pathMatch = urlObj.pathname.match(/\/p\/.*?\/(-\/A-\d+)/);
                if (pathMatch) {
                    return `target.com${pathMatch[1]}`;
                }
            } else if (urlObj.hostname.includes('amazon.com')) {
                // For Amazon, extract the product ID (dp/XXXXXX)
                const pathMatch = urlObj.pathname.match(/\/(dp|gp\/product)\/([A-Z0-9]{10})/i);
                if (pathMatch) {
                    return `amazon.com/dp/${pathMatch[2]}`;
                }
            } else if (urlObj.hostname.includes('walmart.com')) {
                // For Walmart, extract the product ID (ip/XXXXX/YYYYY)
                const pathMatch = urlObj.pathname.match(/\/ip\/(?:.*?)\/(\d+)/);
                if (pathMatch) {
                    return `walmart.com/ip/${pathMatch[1]}`;
                }
            }
            
            // Default: use full hostname and pathname
            return `${urlObj.hostname}${urlObj.pathname}`;
        } catch (error) {
            console.error(`❌ [MAVELY] Error normalizing URL: ${error.message}`);
            // If URL parsing fails, just return the original URL
            return url;
        }
    }

    /**
     * Check if a URL is valid for Mavely affiliate links
     * @param {string} url - The URL to check
     * @returns {boolean} - Whether the URL is valid
     */
    isValidUrl(url) {
        console.log(`🔍 [MAVELY] Checking URL validity: ${url}`);
        const result = this.validateUrl(url);
        console.log(`🔍 [MAVELY] URL validity result: ${result}`);
        return result;
    }

    /**
     * Check if a URL is likely to be compatible with Mavely
     * @param {string} url - The URL to check
     * @returns {boolean} - Whether the URL is likely to be compatible with Mavely
     */
    isLikelyCompatibleWithMavely(url) {
        console.log(`🔍 [MAVELY] Checking compatibility: ${url}`);
        const result = this.validateUrl(url);
        console.log(`🔍 [MAVELY] Compatibility result: ${result}`);
        return result;
    }

    /**
     * Validate a URL for Mavely compatibility
     * @param {string} url - The URL to validate
     * @returns {boolean} - Whether the URL is valid for Mavely
     */
    validateUrl(url) {
        try {
            console.log(`🔍 [MAVELY] Validating URL: ${url}`);
            if (!url) {
                console.log('❌ [MAVELY] URL is empty or undefined');
                return false;
            }

            // Ensure URL is a string
            const urlString = String(url);
            
            // Try to create a URL object to validate format
            let urlObj;
            try {
                urlObj = new URL(urlString);
                console.log(`🔍 [MAVELY] URL parsed successfully: ${urlObj.hostname}`);
            } catch (error) {
                // If the URL is not properly formatted, try adding https://
                try {
                    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
                        urlObj = new URL(`https://${urlString}`);
                        console.log(`🔍 [MAVELY] URL fixed by adding https://: ${urlObj.hostname}`);
                    } else {
                        console.log(`❌ [MAVELY] Invalid URL format: ${urlString}`);
                        return false;
                    }
                } catch (innerError) {
                    console.log(`❌ [MAVELY] Could not parse URL: ${urlString}`);
                    return false;
                }
            }

            // Extract the hostname
            const hostname = urlObj.hostname.toLowerCase();
            
            // Special handling for common retailers with different URL patterns
            if (hostname.includes('target.com') || hostname.endsWith('target.com')) {
                console.log(`✅ [MAVELY] Detected Target URL: ${urlString}`);
                return true;
            }

            // Check if the hostname is in our list of valid domains
            const isValid = this.validDomains.some(domain => {
                const isDomainValid = hostname.includes(domain) || hostname.endsWith(domain);
                if (isDomainValid) {
                    console.log(`✅ [MAVELY] URL is valid: ${urlString} matches domain ${domain}`);
                }
                return isDomainValid;
            });

            if (!isValid) {
                console.log(`❌ [MAVELY] URL domain not in valid domains list: ${hostname}`);
            }

            return isValid;
        } catch (error) {
            console.error(`❌ [MAVELY] Error validating URL: ${error.message}`);
            return false;
        }
    }

    /**
     * Initialize the Mavely Manager
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether initialization was successful
     */
    async initialize(taskId = 'MAVELY') {
        try {
            logTask(taskId, 'INFO', 'Initializing Mavely Manager');
            
            // Check for saved token
            if (fs.existsSync(MAVELY_TOKEN_FILE)) {
                this.token = fs.readFileSync(MAVELY_TOKEN_FILE, 'utf8').trim();
                if (this.token) {
                    logTask(taskId, 'INFO', 'Found saved Mavely token');
                }
            }
            
            // Launch browser
            logTask(taskId, 'INFO', 'Launching Mavely browser');
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
                console.log('💤 [MAVELY] Browser was disconnected (possibly closed manually)');
                
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
                
                // Force the Node.js process to exit if running as part of the Mavely service
                if (process.env.MAVELY_SERVICE_PROCESS) {
                    console.log('💤 [MAVELY] Shutting down service due to browser disconnection');
                    process.exit(0);
                }
            });
            
            // Use the first page instead of creating a new one
            const pages = await this.browser.pages();
            this.page = pages[0];
            
            // Set a user agent to mimic a real browser
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
            
            // Set viewport
            await this.page.setViewport({ width: 1280, height: 800 });
            
            // Set default timeout for all navigations
            this.page.setDefaultNavigationTimeout(60000);
            
            // Set default timeout for waitFor functions
            this.page.setDefaultTimeout(30000);
            
            // Login to Mavely
            logTask(taskId, 'INFO', 'Navigating to Mavely login page');
            await this.login(taskId);
            
            // Check if login was successful
            if (await this.isLoggedIn()) {
                logTask(taskId, 'SUCCESS', 'Successfully logged into Mavely');
                
                // Fetch the initial token from the session endpoint
                logTask(taskId, 'INFO', 'Fetching initial auth token from session endpoint');
                await this.refreshAuthToken(taskId);
                
                // Start the token refresh timer
                this.startTokenRefreshTimer(taskId);
                
                this.isInitialized = true;
                return true;
            } else {
                logTask(taskId, 'ERROR', 'Failed to log into Mavely');
                return false;
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error initializing Mavely Manager: ${error.message}`, error);
            this.lastError = error.message;
            return false;
        }
    }

    /**
     * Check if user is logged into Mavely
     * @returns {Promise<boolean>} - Whether user is logged in
     */
    async isLoggedIn() {
        try {
            // Get current URL without navigating
            const currentUrl = this.page.url();
            
            // If we're on the login page, we're not logged in
            if (currentUrl.includes('/login') || currentUrl.includes('/auth/login')) {
                return false;
            }
            
            // If we're on a different page, check if we get redirected to login
            if (!currentUrl.includes('mavely') || currentUrl === 'about:blank') {
                await this.page.goto(MAVELY_DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 60000 });
                const newUrl = this.page.url();
                return !newUrl.includes('/login') && !newUrl.includes('/auth/login');
            }
            
            // Already on a Mavely page and not on login page
            return true;
        } catch (error) {
            console.error('Error checking login status:', error);
            return false;
        }
    }

    /**
     * Login to Mavely
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether login was successful
     */
    async login(taskId) {
        try {
            // Navigate to the login page
            logTask(taskId, 'INFO', `Navigating to Mavely login page: ${MAVELY_LOGIN_URL}`);
            await this.page.goto(MAVELY_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Check if we need to log in or are already logged in
            if (!await this.isLoggedIn()) {
                logTask(taskId, 'INFO', 'On Mavely login page - attempting automated login');
                
                try {
                    // Look for email/username input field
                    const emailSelectors = ['input[id="email"]', 'input[id="email"]', 'input[placeholder*="email"]', 'input[id*="email"]'];
                    let emailInput = null;
                    
                    for (const selector of emailSelectors) {
                        emailInput = await this.page.$(selector);
                        if (emailInput) {
                            logTask(taskId, 'INFO', `Found email input field with selector: ${selector}`);
                            break;
                        }
                    }
                    
                    if (!emailInput) {
                        logTask(taskId, 'WARNING', 'Could not find email input field, attempting to find by XPath');
                        emailInput = await this.page.$x('//input[contains(@placeholder, "Email") or contains(@placeholder, "email")]');
                        if (emailInput && emailInput.length > 0) {
                            emailInput = emailInput[0];
                        } else {
                            throw new Error('Could not find email input field');
                        }
                    }
                    
                    // Look for password input field
                    const passwordSelectors = ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="password"]', 'input[id*="password"]'];
                    let passwordInput = null;
                    
                    for (const selector of passwordSelectors) {
                        passwordInput = await this.page.$(selector);
                        if (passwordInput) {
                            logTask(taskId, 'INFO', `Found password input field with selector: ${selector}`);
                            break;
                        }
                    }
                    
                    if (!passwordInput) {
                        logTask(taskId, 'WARNING', 'Could not find password input field, attempting to find by XPath');
                        passwordInput = await this.page.$x('//input[@type="password"]');
                        if (passwordInput && passwordInput.length > 0) {
                            passwordInput = passwordInput[0];
                        } else {
                            throw new Error('Could not find password input field');
                        }
                    }
                    
                    // Fill in the credentials
                    logTask(taskId, 'INFO', 'Filling in email and password');
                    if (typeof emailInput.type === 'function') {
                        await emailInput.type(MAVELY_EMAIL);
                    } else {
                        await this.page.evaluate((el, value) => { el.value = value; }, emailInput, MAVELY_EMAIL);
                    }
                    
                    if (typeof passwordInput.type === 'function') {
                        await passwordInput.type(MAVELY_PASSWORD);
                    } else {
                        await this.page.evaluate((el, value) => { el.value = value; }, passwordInput, MAVELY_PASSWORD);
                    }
                    
                    // Find and click the login button
                    const loginButtonSelectors = [
                        'button[type="submit"]',
                        'input[type="submit"]',
                        'button:has-text("Log in")',
                        'button:has-text("Login")',
                        'button:has-text("Sign in")',
                        'button.login-button',
                        'button.signin-button'
                    ];
                    
                    let loginButton = null;
                    for (const selector of loginButtonSelectors) {
                        loginButton = await this.page.$(selector);
                        if (loginButton) {
                            logTask(taskId, 'INFO', `Found login button with selector: ${selector}`);
                            break;
                        }
                    }
                    
                    if (!loginButton) {
                        logTask(taskId, 'WARNING', 'Could not find login button, attempting to find by XPath');
                        loginButton = await this.page.$x('//button[contains(text(), "Log in") or contains(text(), "Login") or contains(text(), "Sign in")]');
                        if (loginButton && loginButton.length > 0) {
                            loginButton = loginButton[0];
                        } else {
                            throw new Error('Could not find login button');
                        }
                    }
                    
                    // Click the login button and wait for navigation
                    logTask(taskId, 'INFO', 'Clicking login button');
                    if (typeof loginButton.click === 'function') {
                        await Promise.all([
                            this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                            loginButton.click()
                        ]);
                    } else {
                        await Promise.all([
                            this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                            loginButton.click()
                        ]);
                    }
                    
                    // Check if login was successful
                    const currentUrl = this.page.url();
                    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth/login');
                    
                    if (!isLoginPage) {
                        logTask(taskId, 'SUCCESS', `Successfully logged into Mavely (now at: ${currentUrl})`);
                        
                        // Save token if available
                        logTask(taskId, 'INFO', 'Saving Mavely token');
                        const cookies = await this.page.cookies();
                        const token = cookies.find(cookie => cookie.name === 'token' || cookie.name.includes('auth'));
                        if (token) {
                            this.token = token.value;
                            fs.writeFileSync(MAVELY_TOKEN_FILE, this.token);
                            logTask(taskId, 'SUCCESS', 'Saved Mavely authentication token');
                        } else {
                            logTask(taskId, 'WARNING', 'Could not find Mavely authentication token in cookies');
                        }
                        
                        // Wait a moment to let the page settle after login
                        logTask(taskId, 'INFO', 'Waiting for page to settle after login...');
                        await delay(5000);
                        
                        return true;
                    } else {
                        // If we're still on the login page, check for error messages
                        logTask(taskId, 'WARNING', 'Still on login page after attempting to login');
                        
                        // Try to check for error messages
                        const errorMessages = await this.page.evaluate(() => {
                            const errorElements = Array.from(document.querySelectorAll('.error, .error-message, .alert, .alert-danger, [role="alert"]'));
                            return errorElements.map(el => el.textContent.trim());
                        });
                        
                        if (errorMessages.length > 0) {
                            logTask(taskId, 'ERROR', `Login failed with errors: ${errorMessages.join(', ')}`);
                        }
                        
                        // Fall back to manual login if automated login fails
                        logTask(taskId, 'INFO', 'Automated login failed, waiting for manual login...');
                        
                        // Wait maximum of 3 minutes for user to login manually
                        const loginTimeout = 10000;
                        const startTime = Date.now();
                        
                        while (Date.now() - startTime < loginTimeout) {
                            logTask(taskId, 'INFO', `Waiting for manual login... (${Math.round((Date.now() - startTime) / 1000)}s elapsed, max ${loginTimeout / 1000}s)`);
                            
                            // Stay on the login page and wait for user to complete login
                            await delay(3000); // Check every 3 seconds
                            
                            // Check if we're still on the login page
                            const currentUrl = this.page.url();
                            const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth/login');
                            
                            if (!isLoginPage) {
                                // We're no longer on the login page, so login succeeded
                                logTask(taskId, 'SUCCESS', `User successfully logged into Mavely (now at: ${currentUrl})`);
                                
                                // Save token if available
                                logTask(taskId, 'INFO', 'Saving Mavely token');
                                const cookies = await this.page.cookies();
                                const token = cookies.find(cookie => cookie.name === 'token' || cookie.name.includes('auth'));
                                if (token) {
                                    this.token = token.value;
                                    fs.writeFileSync(MAVELY_TOKEN_FILE, this.token);
                                    logTask(taskId, 'SUCCESS', 'Saved Mavely authentication token');
                                } else {
                                    logTask(taskId, 'WARNING', 'Could not find Mavely authentication token in cookies');
                                }
                                
                                // Wait a moment to let the page settle after login
                                logTask(taskId, 'INFO', 'Waiting for page to settle after login...');
                                await delay(5000);
                                
                                return true;
                            }
                        }
                        
                        logTask(taskId, 'ERROR', 'Timed out waiting for manual login');
                        return false;
                    }
                } catch (loginError) {
                    logTask(taskId, 'ERROR', `Error during automated login: ${loginError.message}`);
                    
                    // Fall back to manual login if automated login fails
                    logTask(taskId, 'INFO', 'Falling back to manual login...');
                    
                    // Wait maximum of 3 minutes for user to login manually
                    const loginTimeout = 10000;
                    const startTime = Date.now();
                    
                    while (Date.now() - startTime < loginTimeout) {
                        logTask(taskId, 'INFO', `Waiting for manual login... (${Math.round((Date.now() - startTime) / 1000)}s elapsed, max ${loginTimeout / 1000}s)`);
                        
                        // Stay on the login page and wait for user to complete login
                        await delay(3000); // Check every 3 seconds
                        
                        // Check if we're still on the login page
                        const currentUrl = this.page.url();
                        const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth/login');
                        
                        if (!isLoginPage) {
                            // We're no longer on the login page, so login succeeded
                            logTask(taskId, 'SUCCESS', `User successfully logged into Mavely (now at: ${currentUrl})`);
                            
                            // Save token if available
                            logTask(taskId, 'INFO', 'Saving Mavely token');
                            const cookies = await this.page.cookies();
                            const token = cookies.find(cookie => cookie.name === 'token' || cookie.name.includes('auth'));
                            if (token) {
                                this.token = token.value;
                                fs.writeFileSync(MAVELY_TOKEN_FILE, this.token);
                                logTask(taskId, 'SUCCESS', 'Saved Mavely authentication token');
                            } else {
                                logTask(taskId, 'WARNING', 'Could not find Mavely authentication token in cookies');
                            }
                            
                            // Wait a moment to let the page settle after login
                            logTask(taskId, 'INFO', 'Waiting for page to settle after login...');
                            await delay(5000);
                            
                            return true;
                        }
                    }
                    
                    logTask(taskId, 'ERROR', 'Timed out waiting for manual login');
                    return false;
                }
            } else {
                logTask(taskId, 'INFO', 'Already logged into Mavely');
                return true;
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error logging into Mavely: ${error.message}`, error);
            return false;
        }
    }

    /**
     * Generate a Mavely affiliate link for a given URL
     * @param {string} url - The URL to generate a Mavely link for
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<string>} - The generated Mavely link or the original URL if unsuccessful
     */
    async generateMavelyLink(url, taskId = 'MAVELY') {
        try {
            console.log(`🔄 [MAVELY] Generating Mavely link for URL: ${url}`);
            
            // Validate initialization
            if (!this.isInitialized || !this.browser || !this.page) {
                console.log(`❌ [MAVELY] Mavely Manager not initialized`);
                throw new Error('Mavely Manager not initialized');
            }
            
            // Validate URL
            if (!this.validateUrl(url)) {
                console.log(`❌ [MAVELY] URL not valid for Mavely: ${url}`);
                return url;
            }
            
            // Step 1: Check if URL is already in the *in-memory* cache
            const cachedLink = this.getFromLinkCache(url);
            if (cachedLink) {
                console.log(`✅ [MAVELY] Using cached Mavely link: ${cachedLink}`);
                return cachedLink;
            }

            // Step 3: If still not found, proceed with login check, token refresh, API call
            console.log(`🔄 [MAVELY] Link not found in cache. Proceeding to generate...`);
            
            // Make sure we're logged in
            if (!await this.isLoggedIn()) {
                console.log(`🔄 [MAVELY] Need to log in to Mavely first`);
                const loginSuccess = await this.login(taskId);
                if (!loginSuccess) {
                    console.log(`❌ [MAVELY] Failed to log in to Mavely`);
                    throw new Error('Failed to log in to Mavely');
                }
                // Refresh token after login
                await this.refreshAuthToken(taskId);
            }
            
            // Check if token is expired or missing, and refresh if needed
            const now = new Date();
            const tokenAge = this.tokenLastRefreshed ? now - this.tokenLastRefreshed : Infinity;
            
            if (!this.idToken || tokenAge > MAVELY_TOKEN_REFRESH_INTERVAL) {
                console.log(`🔄 [MAVELY] Token is expired or missing, refreshing...`);
                const refreshSuccess = await this.refreshAuthToken(taskId);
                if (!refreshSuccess) {
                    console.log(`❌ [MAVELY] Failed to refresh auth token`);
                    throw new Error('Failed to refresh auth token');
                }
            }
            
            if (!this.idToken) {
                console.log(`❌ [MAVELY] No idToken available after refresh`);
                throw new Error('No idToken available after refresh');
            }
            
            // Use the idToken from the session endpoint for API authorization
            console.log(`🔄 [MAVELY] Making API call to generate affiliate link with refreshed token`);
            
            const apiResponse = await this.page.evaluate(async (url, token) => {
                try {
                    const response = await fetch("https://mavely.live/", {
                        method: "POST",
                        headers: {
                            "accept": "*/*",
                            "accept-language": "en-US,en;q=0.9",
                            "authorization": `Bearer ${token}`,
                            "client-name": "@mavely/creator-app",
                            "client-revision": "5d44ed42",
                            "client-version": "1.0.3",
                            "content-type": "application/json",
                            "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"130\"",
                            "sec-fetch-dest": "empty",
                            "sec-fetch-mode": "cors",
                            "sec-fetch-site": "cross-site"
                        },
                        body: JSON.stringify({
                            query: "mutation ($v1:String!){createAffiliateLink(url:$v1){id,link,metaDescription,metaTitle,metaImage,metaUrl,metaLogo,metaSiteName,metaVideo,brand{id,name,slug},originalUrl,canonicalLink,attributionUrl}}",
                            variables: { v1: url }
                        }),
                        referrer: "https://creators.joinmavely.com/",
                        referrerPolicy: "strict-origin-when-cross-origin",
                        mode: "cors",
                        credentials: "include"
                    });
                    
                    if (!response.ok) {
                        throw new Error(`API request failed with status ${response.status}`);
                    }
                    
                    return await response.json();
                } catch (error) {
                    return { error: error.message };
                }
            }, url, this.idToken); // Use the idToken here
            
            console.log(`🔍 [MAVELY] API response:`, apiResponse);
            
            // Check if the API call was successful
            if (apiResponse.error) {
                console.log(`❌ [MAVELY] API error: ${apiResponse.error}`);
                throw new Error(`API error: ${apiResponse.error}`);
            }
            
            if (!apiResponse.data || !apiResponse.data.createAffiliateLink) {
                console.log(`❌ [MAVELY] Invalid API response, missing data.createAffiliateLink`);
                throw new Error('Invalid API response');
            }
            
            // Extract the generated link
            const generatedLink = apiResponse.data.createAffiliateLink.link;
            
            if (!generatedLink) {
                console.log(`❌ [MAVELY] API did not return a generated link`);
                throw new Error('API did not return a generated link');
            }
            
            console.log(`✅ [MAVELY] Successfully generated Mavely link: ${generatedLink}`);
            
            // Add the successful link to the cache
            this.addToLinkCache(url, generatedLink);
            
            return generatedLink;
        } catch (error) {
            console.error(`❌ [MAVELY] Error in generateMavelyLink: ${error.message}`);
            
            return url;
        }
    }

    /**
     * Close the Mavely browser
     * @returns {Promise<boolean>} - Whether closure was successful
     */
    async close() {
        try {
            // Save the link cache before closing
            this.saveLinkCache();
            
            // Clear the token refresh timer
            if (this.tokenRefreshTimer) {
                clearInterval(this.tokenRefreshTimer);
                this.tokenRefreshTimer = null;
            }
            
            if (this.browser) {
                // Set a timeout to force cleanup if browser doesn't close cleanly
                const forceShutdownTimer = setTimeout(() => {
                    console.log('⚠️ [MAVELY] Browser close timed out, forcing cleanup');
                    this.browser = null;
                    this.page = null;
                    this.isInitialized = false;
                    
                    // Force process exit if running as a service
                    if (process.env.MAVELY_SERVICE_PROCESS === 'true') {
                        console.log('💤 [MAVELY] Forcing service shutdown due to browser close timeout');
                        process.exit(1);
                    }
                }, 10000);
            
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
            console.error(`Error closing Mavely browser: ${error.message}`);
            // Force set to null even if there was an error
            this.browser = null;
            this.page = null;
            this.isInitialized = false;
            this.tokenRefreshTimer = null;
            
            // Force process exit if running as a service and there was an error closing
            if (process.env.MAVELY_SERVICE_PROCESS === 'true') {
                console.log('💤 [MAVELY] Forcing service shutdown due to browser close error');
                process.exit(1);
            }
            
            return false;
        }
    }

    /**
     * Debug function specifically for Target URLs
     * @param {string} url - The Target URL to debug
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<object>} - Debug information
     */
    async debugTargetUrl(url, taskId = 'MAVELY') {
        try {
            if (!url.toLowerCase().includes('target.com')) {
                logTask(taskId, 'WARNING', 'Not a Target URL, skipping specific debug');
                return { isTarget: false, url };
            }

            logTask(taskId, 'INFO', `Beginning Target URL debug for: ${url}`);

            // Check if initialized
            if (!this.isInitialized || !this.browser || !this.page) {
                logTask(taskId, 'ERROR', 'Mavely Manager not initialized for Target URL debug');
                return { 
                    isTarget: true, 
                    url, 
                    isInitialized: this.isInitialized,
                    hasBrowser: !!this.browser,
                    hasPage: !!this.page,
                    error: 'Mavely Manager not initialized'
                };
            }

            // Log all diagnostics
            logTask(taskId, 'INFO', `Target URL validation:
- URL: ${url}
- Is initialized: ${this.isInitialized}
- Has browser: ${!!this.browser}
- Has page: ${!!this.page}
- Has token: ${!!this.token}
- Is in validDomains: ${this.validDomains.includes('target.com')}
- Passes validateUrl: ${this.validateUrl(url)}
            `);

            // Try to navigate to dashboard to check general functionality
            try {
                logTask(taskId, 'INFO', 'Attempting to navigate to Mavely dashboard for Target URL test');
                await this.page.goto(MAVELY_DASHBOARD_URL, { waitUntil: 'networkidle0', timeout: 30000 });
                
                // Check login status
                const isLoggedIn = await this.isLoggedIn();
                logTask(taskId, 'INFO', `Login status for Target URL test: ${isLoggedIn ? 'Logged in' : 'Not logged in'}`);
                
                return {
                    isTarget: true,
                    url,
                    isInitialized: this.isInitialized,
                    hasBrowser: true,
                    hasPage: true,
                    isLoggedIn,
                    validateUrlResult: this.validateUrl(url),
                    status: 'Completed Target URL diagnostic checks'
                };
            } catch (navError) {
                logTask(taskId, 'ERROR', `Navigation error during Target URL debug: ${navError.message}`);
                return {
                    isTarget: true,
                    url,
                    error: navError.message,
                    status: 'Failed navigation during Target URL debug'
                };
            }
        } catch (error) {
            logTask(taskId, 'ERROR', `Error in debugTargetUrl: ${error.message}`);
            return {
                isTarget: url.toLowerCase().includes('target.com'),
                url,
                error: error.message,
                status: 'Exception in debugTargetUrl'
            };
        }
    }

    /**
     * Start the token refresh timer
     * @param {string} taskId - The task ID for logging
     */
    startTokenRefreshTimer(taskId = 'MAVELY') {
        logTask(taskId, 'INFO', `Starting token refresh timer (interval: ${MAVELY_TOKEN_REFRESH_INTERVAL}ms)`);
        
        // Clear any existing timer
        if (this.tokenRefreshTimer) {
            clearInterval(this.tokenRefreshTimer);
        }
        
        // Set up the timer to refresh the token periodically
        this.tokenRefreshTimer = setInterval(async () => {
            try {
                logTask(taskId, 'INFO', 'Token refresh timer triggered');
                await this.refreshAuthToken(taskId);
            } catch (error) {
                logTask(taskId, 'ERROR', `Error in token refresh: ${error.message}`);
            }
        }, MAVELY_TOKEN_REFRESH_INTERVAL);
    }

    /**
     * Refresh the auth token by calling the session endpoint
     * @param {string} taskId - The task ID for logging
     * @returns {Promise<boolean>} - Whether the refresh was successful
     */
    async refreshAuthToken(taskId = 'MAVELY') {
        try {
            logTask(taskId, 'INFO', 'Refreshing Mavely auth token');
            
            if (!this.page || !this.isLoggedIn()) {
                logTask(taskId, 'ERROR', 'Cannot refresh token: not logged in or page not available');
                return false;
            }
            
            // Call the session endpoint to get a fresh token
            const sessionData = await this.page.evaluate(async (sessionEndpoint) => {
                try {
                    const response = await fetch(sessionEndpoint, {
                        method: "GET",
                        headers: {
                            "accept": "*/*",
                            "accept-language": "en-US,en;q=0.9",
                            "content-type": "application/json",
                            "sec-fetch-dest": "empty",
                            "sec-fetch-mode": "cors",
                            "sec-fetch-site": "same-origin"
                        },
                        referrer: "https://creators.joinmavely.com/home",
                        referrerPolicy: "strict-origin-when-cross-origin",
                        body: null,
                        mode: "cors",
                        credentials: "include"
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Session request failed with status ${response.status}`);
                    }
                    
                    return await response.json();
                } catch (error) {
                    return { error: error.message };
                }
            }, MAVELY_SESSION_ENDPOINT);
            
            if (sessionData.error) {
                logTask(taskId, 'ERROR', `Error fetching session data: ${sessionData.error}`);
                return false;
            }
            
            if (!sessionData.idToken) {
                logTask(taskId, 'ERROR', 'Session data does not contain idToken');
                return false;
            }
            
            // Store the tokens
            this.idToken = sessionData.idToken;
            this.token = sessionData.idToken; // Keep backward compatibility
            this.refreshToken = sessionData.refreshToken || null;
            this.authToken = sessionData.token || null;
            this.tokenLastRefreshed = new Date();
            
            // Save to file for persistence
            fs.writeFileSync(MAVELY_TOKEN_FILE, this.idToken);
            
            logTask(taskId, 'SUCCESS', `Successfully refreshed auth token (expires: ${sessionData.expires || 'unknown'})`);
            return true;
        } catch (error) {
            logTask(taskId, 'ERROR', `Error refreshing auth token: ${error.message}`);
            return false;
        }
    }
}

module.exports = MavelyManager;