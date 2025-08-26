const BestBuyManager = require('./bestbuy_manager');

async function testBestBuyLinkGeneration() {
    const bestbuyManager = new BestBuyManager();
    
    try {
        console.log('🚀 Starting BestBuy Manager link generation test...');
        
        // Initialize the manager
        const initialized = await bestbuyManager.initialize('TEST_BESTBUY');
        
        if (initialized) {
            console.log('✅ BestBuy Manager initialized successfully');
            
            // Test generating a BestBuy affiliate link
            const testUrl = 'https://www.bestbuy.com/product/fujifilm-x-series-x100vi-40-2mp-digital-camera-silver/6574272';
            console.log(`🔗 Testing affiliate link generation for: ${testUrl}`);
            
            const affiliateLink = await bestbuyManager.generateBestBuyLink(testUrl, 'TEST_BESTBUY');
            
            if (affiliateLink && affiliateLink !== testUrl) {
                console.log(`✅ Successfully generated BestBuy affiliate link:`);
                console.log(`   Original: ${testUrl}`);
                console.log(`   Affiliate: ${affiliateLink}`);
            } else {
                console.log(`❌ Failed to generate affiliate link, returned original URL`);
            }
        } else {
            console.log('❌ Failed to initialize BestBuy Manager');
        }
        
        // Close the manager
        await bestbuyManager.close();
        
    } catch (error) {
        console.error('❌ Error during BestBuy Manager link generation test:', error.message);
    }
}

// Run the test
testBestBuyLinkGeneration();
