require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');

puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin());

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        userDataDir: './my-profile',
    });

    const page = await browser.newPage();

    // await page.setViewport({
    //     width: 1280,
    //     height: 720,
    //     deviceScaleFactor: 1,
    //     hasTouch: true,
    //     isLandscape: true,
    //     isMobile: true,
    // });

    const discordUrl = process.env.DISCORD_URL;
    await page.goto(discordUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(10000);

    while (true) {
        console.log('starting');
        const elementArray = [];
        var newestMessage = await page.$x("//li[contains(@id,'chat-messages')][last()]");
        await newestMessage[0].scrollIntoView(); // Scroll the newestMessage element into view

        if (newestMessage.length > 0) {
            var embedElements = await newestMessage[0].$$('div[class*="embed"]');
            for (const element of embedElements) {
                var textContent;
                var title;
                var classAttribute;
                classAttribute = await element.evaluate(node => node.getAttribute('class'));
                switch (true) {
                    case classAttribute.includes('Author'):
                        textContent = await element.evaluate(node => node.textContent);
                        elementArray.push({ title: 'Author', value: textContent });
                        break;
                    case classAttribute.includes('Footer'):
                        textContent = await element.evaluate(node => node.textContent);
                        elementArray.push({ title: 'Footer', value: textContent });
                        break;
                    case classAttribute.includes('Title'):
                        textContent = await element.evaluate(node => node.textContent);
                        elementArray.push({ title: 'Title', value: textContent });
                        break;
                    case classAttribute.includes('Fields'):
                        var lastMessageEmbedFields = await element.$$('div[class*="embedField-"]')

                        for (var i = 0; i < lastMessageEmbedFields.length; i++) {

                            var embedName = await lastMessageEmbedFields[i].$('div[class*="embedFieldName"] span')
                            var embedValue = await lastMessageEmbedFields[i].$('div[class*="embedFieldValue"]')
                            var embedNameLinks = await lastMessageEmbedFields[i].$$('div[class*="embedFieldName"] a')
                            var embedValueLinks = await lastMessageEmbedFields[i].$$('div[class*="embedFieldValue"] a')
                            textContent = await embedValue.evaluate(node => node.textContent);
                            title = await embedName.evaluate(node => node.textContent);
                            // console.log(`${embedNameLinks.length} -> LENGTH OF NAMELINKS`)
                            // console.log(`${embedValueLinks.length} -> LENGTH OF VALUELINKS`)
                            // console.log(`${title} -> title`)
                            for(i = 0; i < embedValueLinks.length; i++) {
                                var linkTitle = embedValueLinks[i].evaluate(node => node.getAttribute('title'))
                                var linkHREF = embedValueLinks[i].evaluate(node => node.getAttribute('href'))
                                textContent.replace(linkTitle,`[${linkTitle}](${linkHREF})`)
                            }
                            if (title === '') {
                                const lastIndex = elementArray.length - 1;
                                if (lastIndex >= 0) {
                                    elementArray[lastIndex].value += textContent;
                                }
                            } else if (title !== '' || textContent !== '') {
                                elementArray.push({ title: title, value: textContent });
                            }

                        }
                        break;
                }
            }
            console.log(elementArray);
        }
        await page.waitForTimeout(10000); // 5 seconds interval
    }

    await browser.close();
})();
