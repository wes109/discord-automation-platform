async function ScrapeData(page) {
    const embedArray = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const maxRetries = 3;
    let retries = 0;
  
    while (retries < maxRetries) {
      try {
        var newestMessage = await page.$x("//li[contains(@id,'chat-messages')][last()]");
        if (!newestMessage) {
          await delay(10000);
          newestMessage = await page.$x("//li[contains(@id,'chat-messages')][last()]");
        }
  
        const newestMessageID = await newestMessage[0].evaluate(node => node.getAttribute('id'));
  
        const tabTitle = await page.title();
        const channelTitle = (tabTitle.match(/#([^|]+)/g) || [])[0]?.slice(1).trim();
  
        const mainLoginContainer = await page.$('div[class*="mainLoginContainer"]');
        if (mainLoginContainer) {
          // Call the reportError function with channelTitle as an argument
          logError(`Login screen detected for ${channelTitle}`, channelTitle, 'https://discord.com/api/webhooks/1163849909234061422/OANSCwdexfqTO5nsRKBgusXpTHGkdt1o4xpU8q-odG-Xq4KpFyMWgA1N2_KFWpan-GRP');
        }
  
        if (newestMessage.length > 0) {
          if (newestMessage) { await newestMessage[0].scrollIntoView(); }
          const embedElements = await newestMessage[0].$$('div[class*="embed"]');
          for (const element of embedElements) {
            const classAttribute = await element.evaluate(node => node.getAttribute('class'));
  
            switch (true) {
              case classAttribute.includes('Author'):
                const authorText = await element.evaluate(node => node.textContent);
                embedArray.push({ title: 'Author', value: authorText });
                break;
  
              case classAttribute.includes('Description'):
                const descriptionText = await element.evaluate(node => node.textContent);
                embedArray.push({ title: 'Description', value: descriptionText });
                break;
  
              case classAttribute.includes('embedThumbnail'):
                const thumbnailImageElement = await element.$('img');
                const thumbnailLinkElement = await element.$('a');
                if (thumbnailImageElement) {
                  const thumbnailLink = await thumbnailImageElement.evaluate(node => node.getAttribute('src'))
                  embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
                } else {
                  const thumbnailLink = await thumbnailLinkElement.evaluate(node => node.getAttribute('href'))
                  embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
                }
                break;
  
              case classAttribute.includes('Image'):
                const imageElement = await element.$('img');
                const imageLink = await imageElement.evaluate(node => node.getAttribute('src'))
                embedArray.push({ title: 'Image', value: imageLink });
                break;
  
              case classAttribute.includes('Footer'):
                const currentDate = new Date();
                const options = {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: 'America/New_York',
                  timeZoneName: 'short',
                };
                const formattedTime = currentDate.toLocaleTimeString('en-US', options)
                embedArray.push({ title: 'Footer', value: `DollarShoeClub - ${formattedTime.toString()}` });
                // This code will push the actual footer:
                // const footerText = await element.evaluate(node => node.textContent);
                // embedArray.push({ title: 'Footer', value: footerText });
                break;
  
              case classAttribute.includes('Title'):
                const titleText = await element.evaluate(node => node.textContent);
                const titleLink = await element.$('a')
                if (titleLink) {
                  const titleLinkHref = await titleLink.evaluate(node => node.getAttribute('href'))
                  embedArray.push({ title: 'Title', value: `${titleText} ${titleLinkHref}` });
                } else {
                  embedArray.push({ title: 'Title', value: titleText });
                }
                break;
  
              case classAttribute.includes('Fields'):
                const embedFields = await element.$$('div[class*="embedField_"]');
  
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
                      currentIndex = linkIndex + `[${linkText}](${href})`.length; // Update the current index
                    }
                  }));
                  embedArray.push({ title, value: textContent });
                }
                break;
            }
          }
        }
        return { embedArray, newestMessageID, channelTitle };
      } catch (error) {
        console.error(`Attempt ${retries + 1} failed: ${error.message}`);
        retries += 1;
        if (retries < maxRetries) {
          console.log(`Retrying... (${retries}/${maxRetries})`);
          await delay(5000); // Pause before retrying
        } else {
          console.error(`All ${maxRetries} attempts failed.`);
          reportError(channelTitle);
          throw error;
        }
      }
    }
  }
  
  function reportError(channelTitle) {
    // Your error reporting code here, you can use the channelTitle as needed
    console.log(`Error reported for channel: ${channelTitle}`);
  }
  
  module.exports = {
    ScrapeData
  };
  