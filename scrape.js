async function ScrapeData(page) {
    const embedArray = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const maxRetries = 3;
    let retries = 0;
    let channelTitle = '';
    let lastProcessedId = null;
    let processedMessageCount = 0;

    // Helper function to process text with links
    async function processTextWithLinks(element) {
        const text = await element.evaluate(node => node.textContent);
        const links = await element.$$('a');
        let processedText = text;
        let currentIndex = 0;

        if (links.length > 0) {
            for (const link of links) {
                const href = await link.evaluate(node => node.getAttribute('href'));
                let linkText = await link.evaluate(node => node.textContent.trim());
                linkText = linkText.replace(/[\[\]]/g, '');
                
                const originalText = await link.evaluate(node => node.textContent.trim());
                const linkIndex = processedText.indexOf(originalText, currentIndex);
                
                if (linkIndex !== -1) {
                    const markdownLink = `[${linkText}](${href})`;
                    const beforeText = processedText.substring(0, linkIndex);
                    const afterText = processedText.substring(linkIndex + originalText.length);
                    processedText = beforeText + markdownLink + afterText;
                    currentIndex = linkIndex + markdownLink.length;
                }
            }
        }
        
        return processedText;
    }

    async function unshorten(url) {
        // Extract the base URL and query parameters
        const urlObj = new URL(url);
        const baseUrl = urlObj.origin + urlObj.pathname;
        const queryParams = urlObj.search;

        // Check both base URL and query parameters for 'affiliate' or 'eldenmonitors'
        if (baseUrl.toLowerCase().includes('affiliate') || 
            baseUrl.toLowerCase().includes('eldenmonitors') ||
            queryParams.toLowerCase().includes('affiliate') ||
            url.toLowerCase().includes('eldenmonitors.com/api/affiliate')) {
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

    async function scrapeRegularMessage(messageHandle) {
        try {
            // First try to get the message content div
            const messageContent = await messageHandle.$('div[class*="messageContent"]');
            if (!messageContent) {
                return null;
            }

            // Get username
            const usernameElement = await messageHandle.$('span[class*="username"]');
            if (!usernameElement) {
                return null;
            }

            // Process message content with all possible elements
            const content = await messageContent.evaluate(node => {
                function processNode(element) {
                    let result = '';
                    
                    // Process each child node
                    for (const child of element.childNodes) {
                        if (child.nodeType === Node.TEXT_NODE) {
                            // Handle text nodes
                            result += child.textContent;
                        } else if (child.nodeType === Node.ELEMENT_NODE) {
                            // Handle different element types
                            if (child.tagName === 'STRONG') {
                                result += `**${processNode(child)}**`;
                            } else if (child.tagName === 'CODE') {
                                result += `\`${child.textContent}\``;
                            } else if (child.classList.contains('channelMention')) {
                                // Extract channel name from the mention
                                const channelName = child.querySelector('.name_b75563')?.textContent || '#channel';
                                result += `#${channelName}`;
                            } else if (child.classList.contains('emojiContainer__75abc')) {
                                // Handle custom emoji
                                const emojiImg = child.querySelector('img');
                                if (emojiImg) {
                                    result += emojiImg.alt || ':emoji:';
                                }
                            } else if (child.tagName === 'A') {
                                // Handle links
                                const title = child.title || child.textContent;
                                const href = child.href;
                                result += `[${title}](${href})`;
                            } else if (child.classList.contains('blockquoteContainer__75297')) {
                                // Handle blockquotes
                                const quote = processNode(child);
                                result += `\n> ${quote}\n`;
                            } else if (child.classList.contains('roleMention__75297')) {
                                // Handle role mentions
                                result += `@${child.textContent}`;
                            } else if (child.tagName === 'SPAN') {
                                // Process spans normally
                                result += processNode(child);
                            } else if (child.tagName === 'DIV') {
                                // Add newlines for div breaks
                                const processed = processNode(child);
                                result += processed ? `\n${processed}\n` : '\n';
                            }
                        }
                    }
                    return result.trim();
                }
                
                return processNode(node);
            });

            // Get username
            const username = await usernameElement.evaluate(node => node.textContent.trim());

            // Get avatar URL
            const avatarElement = await messageHandle.$('img[class*="avatar"]');
            const avatar_url = avatarElement ? 
                await avatarElement.evaluate(node => node.src) : 
                null;

            // Get message attachments (images)
            const attachments = [];
            const imageContainers = await messageHandle.$$('div[class*="imageContent__0f481"]');
            for (const container of imageContainers) {
                const img = await container.$('img');
                if (img) {
                    const src = await img.evaluate(node => node.src);
                    attachments.push({ type: 'image', url: src });
                }
            }

            return { 
                content: content.trim(), 
                username, 
                avatar_url,
                attachments: attachments.length > 0 ? attachments : undefined
            };
        } catch (error) {
            console.log('Error in scrapeRegularMessage:', error);
            return null;
        }
    }

    async function scrapeEmbed(element) {
        const classAttribute = await element.evaluate(node => node.getAttribute('class'));

        if (classAttribute.includes('Author')) {
            const authorText = await element.evaluate(node => node.textContent);
            embedArray.push({ title: 'Author', value: authorText });
        } else if (classAttribute.includes('Description')) {
            const processedText = await processTextWithLinks(element);
            embedArray.push({ title: 'Description', value: processedText });
        } else if (classAttribute.includes('embedThumbnail')) {
            const thumbnailImageElement = await element.$('img');
            const thumbnailLinkElement = await element.$('a');
            if (thumbnailImageElement) {
                let thumbnailLink = await thumbnailImageElement.evaluate(node => node.getAttribute('src'));
                thumbnailLink = await unshorten(thumbnailLink);
                embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
            } else if (thumbnailLinkElement) {
                let thumbnailLink = await thumbnailLinkElement.evaluate(node => node.getAttribute('href'));
                thumbnailLink = await unshorten(thumbnailLink);
                embedArray.push({ title: 'Thumbnail', value: thumbnailLink });
            }
        } else if (classAttribute.includes('Image')) {
            const imageElement = await element.$('img');
            if (imageElement) {
                let imageLink = await imageElement.evaluate(node => node.getAttribute('src'));
                imageLink = await unshorten(imageLink);
                embedArray.push({ title: 'Image', value: imageLink });
            }
        } else if (classAttribute.includes('Title')) {
            const rawText = await element.evaluate(node => node.textContent.trim());
            const cleanText = rawText.replace(/[\[\]\(\)]/g, '');
            
            const titleLink = await element.$('a');
            if (titleLink) {
                let titleLinkHref = await titleLink.evaluate(node => node.href);
                titleLinkHref = await unshorten(titleLinkHref);
                embedArray.push({ title: 'Title', value: cleanText, url: titleLinkHref });
            } else {
                embedArray.push({ title: 'Title', value: cleanText });
            }
        } else if (classAttribute.includes('Fields')) {
            const embedFields = await element.$$('div[class*="embedField_"]');
            for (const fieldElement of embedFields) {
                const embedName = await fieldElement.$('div[class*="embedFieldName"]');
                const embedValue = await fieldElement.$('div[class*="embedFieldValue"]');
                const embedNameText = await embedName.evaluate(node => node.textContent);
                const processedValue = await processTextWithLinks(embedValue);
                embedArray.push({ title: embedNameText.trim(), value: processedValue });
            }
        }
    }

    async function logPageState() {
        try {
            const url = page.url();
            const title = await page.title();
            const readyState = await page.evaluate(() => document.readyState);
            const isVisible = await page.evaluate(() => !document.hidden);
            
            console.log('Page state:', {
                url,
                title,
                readyState,
                isVisible,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error logging page state:', error);
        }
    }

    while (retries < maxRetries) {
        console.log('\nDEBUG: Starting new scrape cycle');
        await logPageState();
        
        // Check if we're still on the Discord page
        const currentUrl = page.url();
        if (!currentUrl.includes('discord.com/channels')) {
            console.log('DEBUG: Not on Discord channel page:', currentUrl);
            await delay(5000);
            continue;
        }

        const newestMessageHandle = await page.evaluateHandle(() => {
            return document.evaluate(
                "//li[contains(@id,'chat-messages')][last()]",
                document,
                null,
                XPathResult.ANY_TYPE,
                null
            ).iterateNext();
        });

        if (!(await newestMessageHandle.evaluate(node => node !== null))) {
            console.log('DEBUG: No message element found');
            console.log('DEBUG: Current DOM state:', await page.evaluate(() => ({
                hasMessages: !!document.querySelector('li[id*="chat-messages"]'),
                totalMessages: document.querySelectorAll('li[id*="chat-messages"]').length,
                hasMainContent: !!document.querySelector('main[class*="chatContent"]'),
                hasChannelHeader: !!document.querySelector('h3[class*="title"]'),
                isLoading: !!document.querySelector('div[class*="loading"]')
            })));
            await delay(5000);
            continue;
        }

        try {
            const newestMessageID = await newestMessageHandle.evaluate(node => node.getAttribute('id'));
            console.log('DEBUG: Found message with ID:', newestMessageID);

            const tabTitle = await page.title();
            channelTitle = (tabTitle.match(/#([^|]+)/g) || [])[0]?.slice(1).trim();

            // Check for login screen
            const mainLoginContainer = await page.$('div[class*="mainLoginContainer"]');
            if (mainLoginContainer) {
                console.log('DEBUG: Login screen detected');
                throw new Error('Login required');
            }

            // Check if message is visible
            const isMessageVisible = await newestMessageHandle.evaluate(node => {
                const rect = node.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= window.innerHeight;
            });

            if (!isMessageVisible) {
                console.log('DEBUG: Message not in viewport, scrolling...');
                await newestMessageHandle.evaluate(node => node.scrollIntoView());
                await delay(500); // Wait for scroll to complete
            }

            // First check for embeds
            const embedElements = await newestMessageHandle.$$('div[class*="embed"]');
            console.log('DEBUG: Embed elements found:', embedElements.length);
            
            if (embedElements.length > 0) {
                // Process embeds if they exist
                console.log('DEBUG: Processing embeds');
                for (const element of embedElements) {
                    await scrapeEmbed(element);
                }
                return { embedArray, newestMessageID, channelTitle };
            } else {
                // If no embeds, process as regular message
                console.log('DEBUG: Processing as regular message');
                const regularMessage = await scrapeRegularMessage(newestMessageHandle);
                if (regularMessage) {
                    console.log('DEBUG: Regular message processed successfully');
                    return { regularMessage, newestMessageID, channelTitle };
                } else {
                    console.log('DEBUG: Failed to process regular message');
                }
            }
            
            console.log('DEBUG: No content found in message');
        } catch (error) {
            console.log('DEBUG: Error in scrape cycle:', error);
            console.log('DEBUG: Page URL at error:', page.url());
            console.log('DEBUG: Page title at error:', await page.title());
            
            retries++;
            if (retries < maxRetries) {
                await delay(1000);
            } else {
                throw error;
            }
        } finally {
            if (newestMessageHandle) {
                await newestMessageHandle.dispose();
            }
        }
    }
    
    return null;
}

module.exports = { ScrapeData };