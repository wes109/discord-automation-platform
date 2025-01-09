async function ScrapeData(page) {
  const embedArray = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const maxRetries = 999;
  let retries = 0;
  let channelTitle = '';

  async function unshorten(url) {
    // List of known URL shorteners
    const shorteners = [
      'bit.ly',
      'mavely.app',
      'tinyurl.com',
      'goo.gl',
      't.co',
      'ow.ly',
      'is.gd',
      'buff.ly',
      'adf.ly',
      'bit.do',
      'mcaf.ee',
      'shorturl.at'
    ];

    // Check if URL contains any known shortener
    const isShortened = shorteners.some(shortener => url.includes(shortener));

    if (!isShortened) {
      return url;
    }

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow'
      });
      return response.url;
    } catch (error) {
      return url;
    }
  }

  while (retries < maxRetries) {
    let newestMessageHandle = null;
    try {
      newestMessageHandle = await page.evaluateHandle(() => {
        return document.evaluate(
          "//li[contains(@id,'chat-messages')][last()]",
          document,
          null,
          XPathResult.ANY_TYPE,
          null
        ).iterateNext();
      });

      if (!newestMessageHandle) {
        await delay(100);
        retries++;
        continue;
      }

      const newestMessageID = await newestMessageHandle.evaluate(node => node.getAttribute('id'));
      const tabTitle = await page.title();
      channelTitle = (tabTitle.match(/#([^|]+)/g) || [])[0]?.slice(1).trim();

      const mainLoginContainer = await page.$('div[class*="mainLoginContainer"]');
      if (mainLoginContainer) {
        reportError(channelTitle);
      }

      await newestMessageHandle.evaluate(node => node.scrollIntoView());

      const embedElements = await newestMessageHandle.$$('div[class*="embed"]');

      for (const element of embedElements) {
        const classAttribute = await element.evaluate(node => node.getAttribute('class'));

        if (classAttribute.includes('Author')) {
          const authorText = await element.evaluate(node => node.textContent);
          embedArray.push({ title: 'Author', value: authorText });
        } else if (classAttribute.includes('Description')) {
          const descriptionText = await element.evaluate(node => node.textContent);
          embedArray.push({ title: 'Description', value: descriptionText });
        } else if (classAttribute.includes('embedThumbnail')) {
          const thumbnailImageElement = await element.$('img');
          const thumbnailLinkElement = await element.$('a');
          if (thumbnailImageElement) {
            let thumbnailLink = await thumbnailImageElement.evaluate(node => node.getAttribute('src'));
            thumbnailLink = await unshorten(thumbnailLink);
            embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
          } else {
            let thumbnailLink = await thumbnailLinkElement.evaluate(node => node.getAttribute('href'));
            thumbnailLink = await unshorten(thumbnailLink);
            embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
          }
        } else if (classAttribute.includes('Image')) {
          const imageElement = await element.$('img');
          let imageLink = await imageElement.evaluate(node => node.getAttribute('src'));
          imageLink = await unshorten(imageLink);
          embedArray.push({ title: 'Image', value: imageLink });
        } else if (classAttribute.includes('Footer')) {
          const currentDate = new Date();
          const options = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'America/New_York',
            timeZoneName: 'short',
          };
          const formattedTime = currentDate.toLocaleTimeString('en-US', options);
          embedArray.push({ title: 'Footer', value: `DollarShoeClub - ${formattedTime.toString()}` });
        } else if (classAttribute.includes('Title')) {
          const titleText = await element.evaluate(node => node.textContent);
          const titleLink = await element.$('a');
          if (titleLink) {
            let titleLinkHref = await titleLink.evaluate(node => node.getAttribute('href'));
            titleLinkHref = await unshorten(titleLinkHref);
            embedArray.push({ title: 'Title', value: `${titleText} ${titleLinkHref}` });
          } else {
            embedArray.push({ title: 'Title', value: titleText });
          }
        } else if (classAttribute.includes('Fields')) {
          const embedFields = await element.$$('div[class*="embedField_"]');
          for (const fieldElement of embedFields) {
            const embedName = await fieldElement.$('div[class*="embedFieldName"]');
            const embedValue = await fieldElement.$('div[class*="embedFieldValue"]');
            const embedNameText = await embedName.evaluate(node => node.textContent);
            const embedValueText = await embedValue.evaluate(node => node.textContent);
            const embedLinks = await embedValue.$$('a');
            const title = embedNameText.trim();
            let textContent = embedValueText;
            let currentIndex = 0;
            await Promise.all(embedLinks.map(async (link, index) => {
              var href = await link.evaluate(node => node.getAttribute('href'));
              href = await unshorten(href);
              var linkText = await embedLinks[index].evaluate(node => node.textContent.trim());
              const linkIndex = textContent.indexOf(linkText, currentIndex);
              if (linkIndex !== -1) {
                textContent = textContent.substring(0, linkIndex) +
                  `[${linkText}](${href})` +
                  textContent.substring(linkIndex + linkText.length);
                currentIndex = linkIndex + `[${linkText}](${href})`.length;
              }
            }));
            embedArray.push({ title, value: textContent });
          }
        }
      }

      return { embedArray, newestMessageID, channelTitle };
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        await delay(100);
      } else {
        reportError(channelTitle);
        throw error;
      }
    } finally {
      if (newestMessageHandle) {
        await newestMessageHandle.dispose();
      }
    }
  }
}

// Export ScrapeData function
module.exports.ScrapeData = ScrapeData;