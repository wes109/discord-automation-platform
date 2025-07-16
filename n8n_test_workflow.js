// n8n Test Workflow - Simple Test Data
console.log('=== n8n Test Workflow ===');

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

// Create a simple test image (1x1 pixel PNG)
const testImageBuffer = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // Color type, compression, filter, interlace
  0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, // IDAT data
  0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // IDAT data
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
  0xAE, 0x42, 0x60, 0x82  // IEND data
]);

// Simulate the binary data structure that n8n would provide
const mockBinaryData = {
  imageData: {
    mimeType: 'image/png',
    fileType: 'png',
    fileExtension: 'png',
    directory: '/tmp',
    fileName: 'test-image.png',
    fileSize: testImageBuffer.length
  }
};

console.log('Test data created:');
console.log('- Tweet text length:', testData.tweetText.length);
console.log('- Image buffer size:', testImageBuffer.length);
console.log('- Binary data keys:', Object.keys(mockBinaryData));

// Return test data
return {
  // JSON data
  ...testData,
  
  // Test status
  testMode: true,
  imageSize: testImageBuffer.length,
  method: 'test-data',
  uploadError: null,
  
  // Debug info
  debug: {
    foundIn: 'test-data',
    testMode: true,
    bufferLength: testImageBuffer.length
  },
  
  bufferLength: testImageBuffer.length,
  bufferType: 'object',
  isBuffer: true,
  
  // Raw data for inspection
  jsonKeys: Object.keys(testData),
  binaryKeys: Object.keys(mockBinaryData)
}; 