const { generateMavelyLink } = require('./mavely.js');

// Generate a Mavely Link using the fetched token
(async () => {
  const link = await generateMavelyLink('https://www.example.com/product-page');
  console.log('Generated Mavely Link:', link);
})();
