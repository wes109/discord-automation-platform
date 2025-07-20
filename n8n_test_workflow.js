// n8n Test Workflow - Actually ping the webhook
console.log('=== n8n Test Workflow - Webhook Testing ===');

// Test configuration
const isHealthCheck = true; // Set to true for health check testing, false for normal tweet testing
const webhookUrl = 'http://localhost:5678/webhook-test/tweet';

// Create test data that mimics the output from previous nodes
const testData = {
  // Sample tweet data
  tweetText: "🚨RESTOCK ALERT (Costco)🚨\n\nPokemon Prismatic Evolutions Elite Trainer Box + Booster Bundle, 2-pack\n\nhttps://www.costco.com/.product.1930400.html#blaze\n\n🎮 JOIN OUR DISCORD: https://discord.gg/8u9nWThtyk",
  thumbnailUrl: "https://1000logos.net/wp-content/uploads/2021/04/Costco-logo.png",
  storeName: "Costco",
  productTitle: "Pokemon Prismatic Evolutions Elite Trainer Box + Booster Bundle, 2-pack",
  productUrl: "https://www.costco.com/.product.1930400.html#blaze",
  refererDomain: "https://www.costco.com",
  hasImage: true
};

// Create payload based on test mode
const payload = isHealthCheck ? {
  // Health check payload
  isHealthCheck: true,
  test: true,
  messageId: 'health-check',
  taskId: 'health-check',
  timestamp: new Date().toISOString(),
  source: 'health-check'
} : {
  // Normal tweet payload
  isHealthCheck: false,
  test: true,
  messageId: 'test-tweet',
  taskId: 'test-task',
  timestamp: new Date().toISOString(),
  source: 'test-data',
  ...testData
};

console.log('Sending payload to webhook:');
console.log('- Health check mode:', isHealthCheck);
console.log('- Webhook URL:', webhookUrl);
console.log('- Payload keys:', Object.keys(payload));

// Actually send the request to n8n webhook
async function sendToWebhook() {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Webhook Response:');
    console.log('- Status:', response.status);
    console.log('- Status Text:', response.statusText);
    
    if (response.ok) {
      const responseText = await response.text();
      console.log('- Response Body:', responseText);
      console.log('✅ Webhook request successful!');
    } else {
      console.log('❌ Webhook request failed!');
    }
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      payload: payload,
      isHealthCheck: isHealthCheck
    };
    
  } catch (error) {
    console.error('❌ Error sending webhook request:', error.message);
    return {
      success: false,
      error: error.message,
      payload: payload,
      isHealthCheck: isHealthCheck
    };
  }
}

// Execute the webhook request
return sendToWebhook(); 