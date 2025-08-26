const BestBuyManager = require('./bestbuy_manager');

async function testBestBuyManager() {
    const bestbuyManager = new BestBuyManager();
    
    try {
        console.log('🚀 Starting BestBuy Manager test...');
        
        // Initialize the manager
        const initialized = await bestbuyManager.initialize('TEST_BESTBUY');
        
        if (initialized) {
            console.log('✅ BestBuy Manager initialized successfully');
            console.log('🔍 Login process completed. Check the browser window for manual verification.');
            console.log('💡 Close the browser window when ready to continue with future logic.');
        } else {
            console.log('❌ Failed to initialize BestBuy Manager');
        }
    } catch (error) {
        console.error('❌ Error during BestBuy Manager test:', error.message);
    }
}

// Run the test
testBestBuyManager();
