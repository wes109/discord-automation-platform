const axios = require('axios');
const { chromium } = require('playwright');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class MavelyManager extends EventEmitter {
    constructor() {
        super();
        this.browser = null;
        this.context = null;
        this.page = null;
        this.pendingLinks = [];
        this.brandDomains = this.loadBrands();
        this.initializationPromise = null;
        this.isInitialized = false;
        this.tokenPath = path.join(process.cwd(), '.mavely_token');
    }

    get mavelyToken() {
        try {
            const token = fs.readFileSync(this.tokenPath, 'utf8').trim();
            return token || null;
        } catch {
            return null;
        }
    }

    set mavelyToken(value) {
        if (value) {
            fs.writeFileSync(this.tokenPath, value);
        } else {
            try {
                fs.unlinkSync(this.tokenPath);
            } catch {}
        }
    }

    loadBrands() {
        try {
            const brandsPath = path.join(process.cwd(), 'brands.json');
            const brandsData = JSON.parse(fs.readFileSync(brandsPath, 'utf8'));
            return new Set(brandsData.data.brands2.edges.map(edge => {
                const homepage = edge.node.homepage.toLowerCase();
                return homepage.replace('https://', '').replace('http://', '').replace(/\/$/, '');
            }));
        } catch (error) {
            console.error('Error loading brands:', error);
            return new Set();
        }
    }

    isValidBrandUrl(url) {
        if (!url || url.includes('search')) return false;
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname.toLowerCase();
            return this.brandDomains.has(domain);
        } catch {
            return false;
        }
    }

    async initialize() {
        // If already initialized or initializing, return the existing promise
        if (this.isInitialized || this.initializationPromise) {
            return this.initializationPromise;
        }

        // Create a new initialization promise
        this.initializationPromise = (async () => {
            try {
                if (!this.browser) {
                    this.browser = await chromium.launch({
                        headless: false,
                        args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
                    });

                    this.context = await this.browser.newContext({
                        viewport: { width: 1280, height: 720 },
                        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    });

                    this.page = await this.context.newPage();
                    await this.context.route('**/*', route => route.continue());

                    await this.page.goto('https://creators.joinmavely.com/auth/login', { waitUntil: 'networkidle' });
                    await this.page.fill('#email', 'wwchome1@gmail.com');
                    await this.page.fill('#password', 'Dixiesghost1');
                    await this.page.click('button[type="submit"]');

                    await this.waitForToken();
                    this.startTokenRefresh();
                }
                
                this.isInitialized = true;
                return this;
            } catch (error) {
                this.initializationPromise = null;
                this.isInitialized = false;
                throw error;
            }
        })();

        return this.initializationPromise;
    }

    startTokenRefresh() {
        console.log('Starting token refresh cycle (every 5 seconds)');
        setInterval(() => this.checkToken(), 5000);
    }

    async waitForToken() {
        console.log('Waiting for initial token...');
        let attempts = 0;
        while (!this.mavelyToken && attempts < 12) {
            console.log(`Token attempt ${attempts + 1}/12`);
            await this.checkToken();
            if (!this.mavelyToken) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                attempts++;
            }
        }
        if (!this.mavelyToken) {
            throw new Error('Failed to obtain Mavely token after 1 minute');
        }
        console.log('Initial token obtained successfully');
    }

    async checkToken() {
        if (!this.page) return;
        
        try {
            const response = await this.page.evaluate(async () => {
                const res = await fetch('https://creators.joinmavely.com/api/auth/session', {
                    method: 'GET',
                    headers: {
                        accept: '*/*',
                        'content-type': 'application/json',
                    },
                    credentials: 'include',
                });

                if (!res.ok) {
                    throw new Error('Failed to fetch token');
                }

                return await res.json();
            });

            if (response && response.token) {
                const newToken = `Bearer ${response.token}`;
                const currentToken = this.mavelyToken;
                
                if (newToken !== currentToken) {
                    this.mavelyToken = newToken;
                }
                return newToken;
            }
        } catch (error) {
            console.error('Error fetching Mavely token:', error);
        }
        return null;
    }

    async generateMavelyLink(v1Value) {
        console.log('\n[DEBUG] generateMavelyLink called with URL:', v1Value);
        
        if (!this.isValidBrandUrl(v1Value)) {
            console.log('[DEBUG] URL rejected - not a valid brand URL');
            return null;
        }
        console.log('[DEBUG] URL is valid brand URL');

        try {
            console.log('[DEBUG] Starting link generation process');
            let token = this.mavelyToken;
            console.log('[DEBUG] Token from file:', token ? 'exists' : 'not found');

            if (!token) {
                console.log('[DEBUG] No token available for link generation');
                return null;
            }

            console.log('[DEBUG] Making API call with token');
            const response = await axios({
                method: 'post',
                url: 'https://mavely.live/',
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/json',
                    'authorization': token,
                    'client-name': '@mavely/creator-app',
                    'client-revision': '4fc3d8e3',
                    'client-version': '1.0.3',
                },
                data: {
                    query: `
                        mutation ($v1: String!) {
                            createAffiliateLink(url: $v1) {
                                attributionUrl
                            }
                        }
                    `,
                    variables: { v1: v1Value }
                }
            });

            console.log('[DEBUG] API response:', JSON.stringify(response.data, null, 2));

            if (response.data?.data?.createAffiliateLink?.attributionUrl) {
                const url = response.data.data.createAffiliateLink.attributionUrl;
                console.log('[DEBUG] Successfully generated Mavely link:', url);
                return url;
            } else if (response.data?.errors) {
                console.log('[DEBUG] API returned errors:', JSON.stringify(response.data.errors, null, 2));
            }
        } catch (error) {
            console.log('[DEBUG] Error in link generation:', error.message);
            if (error.response) {
                console.log('[DEBUG] Error response:', JSON.stringify(error.response.data, null, 2));
            }
        }
        console.log('[DEBUG] Link generation failed, returning null');
        return null;
    }

    async cleanup() {
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.mavelyToken = null;
        this.isInitialized = false;
        this.initializationPromise = null;
    }
}

// Create singleton instance
const mavelyManager = new MavelyManager();

// Only initialize in main process (main.js)
if (process.argv[1].endsWith('main.js')) {
    mavelyManager.initialize().catch(console.error);
}

// Export the singleton instance with bound methods
const boundManager = {
    initialize: mavelyManager.initialize.bind(mavelyManager),
    generateMavelyLink: mavelyManager.generateMavelyLink.bind(mavelyManager),
    isValidBrandUrl: mavelyManager.isValidBrandUrl.bind(mavelyManager),
    cleanup: mavelyManager.cleanup.bind(mavelyManager)
};

module.exports = boundManager;
