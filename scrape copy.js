async function ScrapeData(page) {
  const embedArray = [];

  console.log('starting');

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const elementArray = [];
  await delay(10000);
  const newestMessage = await page.$x("//li[contains(@id,'chat-messages')][last()]");
  await newestMessage[0].scrollIntoView();

  if (newestMessage.length > 0) {
    const embedElements = await newestMessage[0].$$('div[class*="embed"]');

    for (const element of embedElements) {
      const classAttribute = await element.evaluate(node => node.getAttribute('class'));

      switch (true) {
        // ... (existing cases)

        case classAttribute.includes('Fields'):
          const embedFields = await element.$$('div[class*="embedField-"]');

          for (const fieldElement of embedFields) {
            const embedName = await fieldElement.$('div[class*="embedFieldName"]');
            const embedValue = await fieldElement.$('div[class*="embedFieldValue"]');
            const embedNameText = await embedName.evaluate(node => node.textContent);
            const embedValueText = await embedValue.evaluate(node => node.textContent);
            const embedLinks = await embedValue.$$('a');
            const title = embedNameText.trim();
            let textContent = embedValueText;
            
            let currentIndex = 0; // Track the current index of instances
            await Promise.all(embedLinks.map(async (link, index) => {
              var href = await link.evaluate(node => node.getAttribute('href'));
              var linkText = await embedLinks[index].evaluate(node => node.textContent.trim());

              // Find the next occurrence of the link text starting from the current index
              const linkIndex = textContent.indexOf(linkText, currentIndex);

              if (linkIndex !== -1) {
                textContent = textContent.substring(0, linkIndex) +
                  `[${linkText}](${href})` +
                  textContent.substring(linkIndex + linkText.length);
                currentIndex = linkIndex + linkText.length; // Update the current index
              }
            }));
            embedArray.push({ title, value: textContent });
          }
          break;
      }
    }
    console.log(embedArray);
  }

  await delay(5000); // Pause for 10 seconds
  return embedArray;
}

module.exports = {
  ScrapeData
};
