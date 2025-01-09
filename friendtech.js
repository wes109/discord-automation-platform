const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  await page.setViewport({
    width: 375,
    height: 667,
    isMobile: true,
  });
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  );

  await page.goto('https://www.friend.tech/'); // Replace with your desired website URL

  // Wait for the website to be fully loaded
  await page.waitForSelector('body');

  // Wait for a div element with a class containing "Home_modalCustomContainer"
  await page.waitForSelector('div[class*="Home_modalCustomContainer"]');

  // Remove the div element found in the previous step
  await page.evaluate(() => {
    const element = document.querySelector('div[class*="Home_modalCustomContainer"]');
    if (element) {
      element.remove();
    }
  });

  // Function to check for the element with selector #loginSuccessful every 5 seconds
  const waitForLoginSuccessful = async () => {
    console.log('Waiting for sign in')
    const element = await page.$('#loginSuccessful');
    if (element) {
      clearInterval(interval);
      // Continue with your desired actions once the element is found
      console.log('Login Successful!');
    }
  };

  // Set up an interval to check for #loginSuccessful every 5 seconds
  const interval = setInterval(waitForLoginSuccessful, 5000);

  // Wait for 5 minutes (300,000 milliseconds) before closing the browser
  await page.waitForTimeout(300000);

  await browser.close();
})();
