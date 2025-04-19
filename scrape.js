async function ScrapeData(page, enableRegularMessages) {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const maxRetries = 3;
    let retries = 0;
    let channelTitle = '';
    const MESSAGE_BUFFER_SIZE = 10; // Define buffer size

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
                    let lastCharWasWhitespace = true; // Start assuming whitespace

                    for (const child of element.childNodes) {
                        let currentContent = '';
                        let isBlockElement = false; // Flag for elements that typically cause line breaks

                        if (child.nodeType === Node.TEXT_NODE) {
                            currentContent = child.textContent;
                        } else if (child.nodeType === Node.ELEMENT_NODE) {
                            const tagName = child.tagName;

                            // --- Block-level elements ---
                            if (tagName === 'BR') {
                                currentContent = '\\n';
                                isBlockElement = true; // Treat BR as causing a break
                            } else if (tagName === 'DIV' || tagName === 'P') { // Treat DIV/P as block, process content then add newline
                                currentContent = processNode(child);
                                if (currentContent && !currentContent.endsWith('\\n')) {
                                     currentContent += '\\n';
                                }
                                isBlockElement = true;
                            } else if (tagName === 'PRE') { // Code blocks
                                const codeContent = child.textContent;
                                const langMatch = child.querySelector('code')?.className.match(/language-(\\S+)/);
                                const lang = langMatch ? langMatch[1] : '';
                                currentContent = `\\n\`\`\`${lang}\\n${codeContent}\\n\`\`\`\\n`;
                                isBlockElement = true;
                            } else if (child.classList.contains('blockquoteContainer__75297') || tagName === 'BLOCKQUOTE') {
                                // Ensure newline *before* quote if necessary
                                if (result.length > 0 && !result.endsWith('\\n') && !result.endsWith(' ')) {
                                     result += '\\n';
                                }
                                // Process inner content and add '>' prefix per line
                                const quoteContent = processNode(child.querySelector('.markup__75297') || child); // Process relevant inner container or the blockquote itself
                                const quote = quoteContent.split('\\n').map(line => `> ${line}`).join('\\n');
                                currentContent = quote;
                                // Ensure newline *after* quote
                                if (!currentContent.endsWith('\\n')) {
                                     currentContent += '\\n';
                                }
                                isBlockElement = true;
                            }

                            // --- Inline elements ---
                            else if (tagName === 'STRONG' || tagName === 'B') { // Bold
                                currentContent = `**${processNode(child)}**`;
                            } else if (tagName === 'EM' || tagName === 'I') { // Italics
                                currentContent = `*${processNode(child)}*`;
                            } else if (tagName === 'U') { // Underline
                                currentContent = `__${processNode(child)}__`;
                            } else if (tagName === 'S' || tagName === 'STRIKE') { // Strikethrough
                                currentContent = `~~${processNode(child)}~~`;
                            } else if (tagName === 'CODE') { // Inline code
                                currentContent = `\`${child.textContent}\``; // Use textContent directly for inline code
                            } else if (child.classList.contains('channelMention')) { // Channel Mention
                                currentContent = child.textContent;
                            } else if (child.classList.contains('emojiContainer__75abc') || (tagName === 'IMG' && child.classList.contains('emoji'))) { // Custom/Unicode Emoji
                                const emojiImg = child.querySelector('img') || child;
                                if (emojiImg) {
                                    currentContent = emojiImg.alt || ':emoji:';
                                }
                            } else if (tagName === 'A') { // Links
                                const linkText = processNode(child);
                                const href = child.href;
                                currentContent = (linkText === href || !linkText) ? href : `[${linkText}](${href})`; // Handle autolinks or use markdown
                            } else if (child.classList.contains('roleMention__75297') || (child.classList.contains('mention') && tagName === 'SPAN')) { // Role/User Mention
                                currentContent = child.textContent;
                            }

                            // --- Default handling for other elements (like SPAN) ---
                             else if (child.childNodes.length > 0) {
                                currentContent = processNode(child);
                             }

                            // --- Ignored elements ---
                             else if (child.classList.contains('timestamp_c19a55')) {
                                continue; // Skip timestamps
                             }
                        }

                        // --- Append content with spacing logic ---

                        // 1. Add leading space if needed:
                        //    - Not the start of the result
                        //    - Last char wasn't whitespace
                        //    - Current content isn't empty and doesn't start with whitespace/newline
                        if (result.length > 0 && !lastCharWasWhitespace && currentContent && currentContent.length > 0 && !/^\\s/.test(currentContent)) {
                             result += ' ';
                        }

                        // 2. Append current content
                        result += currentContent;

                        // 3. Update lastCharWasWhitespace flag
                         if (currentContent && currentContent.length > 0) {
                            lastCharWasWhitespace = /\\s$/.test(currentContent);
                         } else if (!currentContent && result.length > 0) {
                             // If currentContent was empty, retain the previous state
                             lastCharWasWhitespace = /\\s$/.test(result);
                         } else {
                             // If currentContent was empty and result is empty, reset
                             lastCharWasWhitespace = true;
                         }
                    }
                    // Return without internal trimming
                    return result;
                }
                
                const rawContent = processNode(node);
                // Trim only the final result to remove leading/trailing whitespace from the whole message
                return rawContent.trim();
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

    // REFACTOR scrapeEmbed to work on a single message handle
    async function scrapeEmbed(messageHandle) {
        const localEmbedArray = [];

        // Find the main embed container(s) within the message first
        // Try common patterns: article with embed class, or div with embedWrapper class
        const embedContainers = await messageHandle.$$('article[class*="embed"], div[class*="embedWrapper"]');

        if (embedContainers.length === 0) {
            // console.log('DEBUG: No article[class*=embed] or div[class*=embedWrapper] found.');
            return null; // No embed container found in this message
        }

        // Helper for processing fields remains the same
        async function processField(fieldElement) {
            const nameEl = await fieldElement.$('div[class*="embedFieldName"]');
            const valueEl = await fieldElement.$('div[class*="embedFieldValue"]');
            if (nameEl && valueEl) {
                const name = await nameEl.evaluate(node => node.textContent.trim());
                const value = await processTextWithLinks(valueEl);
                if (name && value) localEmbedArray.push({ title: name, value: value });
            }
        }

        // Iterate through each found embed container (usually just one per message, but handles multiple)
        for (const container of embedContainers) {
            // --- Find and process parts within THIS container ---
            // Author
            const author = await container.$('div[class*="embedAuthor"]');
            if (author) {
                try {
                    const authorNameEl = await author.$('span[class*="embedAuthorName"]');
                    const authorLinkEl = await author.$('a[class*="embedAuthorNameLink"]');
                    let value = '', url = null;
                    if (authorLinkEl) {
                        value = await authorLinkEl.evaluate(node => node.textContent.trim());
                        url = await authorLinkEl.evaluate(node => node.href);
                        url = await unshorten(url);
                    } else if (authorNameEl) {
                        value = await authorNameEl.evaluate(node => node.textContent.trim());
                    }
                    if (value) localEmbedArray.push({ title: 'Author', value: value, url: url });
                } catch (e) { console.error("Error processing author:", e); }
            }

            // Title
            const title = await container.$('div[class*="embedTitle"]');
            if (title) {
                 try {
                     let value = '', url = null;
                     const titleLink = await title.$('a');
                     if (titleLink) {
                         value = await titleLink.evaluate(node => node.textContent.trim());
                         url = await titleLink.evaluate(node => node.href);
                         url = await unshorten(url);
                     } else {
                         value = await title.evaluate(node => node.textContent.trim());
                     }
                     if (value) localEmbedArray.push({ title: 'Title', value: value, url: url });
                 } catch (e) { console.error("Error processing title:", e); }
            }

            // Description
            const description = await container.$('div[class*="embedDescription"]');
            if (description) {
                try {
                    const value = await processTextWithLinks(description);
                    if (value) localEmbedArray.push({ title: 'Description', value: value });
                } catch (e) { console.error("Error processing description:", e); }
            }

            // Fields (Find the container for fields within the main container)
            const fieldsContainer = await container.$('div[class*="embedFields"]');
            if (fieldsContainer) {
                const fields = await fieldsContainer.$$('div[class*="embedField_"]');
                for (const field of fields) {
                    try {
                        await processField(field);
                    } catch (e) { console.error("Error processing field:", e); }
                }
            }


            // Thumbnail (Look for img inside thumbnail div)
            const thumbnailDiv = await container.$('div[class*="embedThumbnail"]');
            if (thumbnailDiv) {
                const thumb = await thumbnailDiv.$('img');
                 if (thumb) {
                     try {
                         let value = await thumb.evaluate(node => node.src);
                         value = await unshorten(value);
                         if (value) localEmbedArray.push({ title: 'Thumbnail', value: value });
                     } catch (e) { console.error("Error processing thumbnail:", e); }
                 }
            }


            // Image - Look for linked image first within the container
            const imageLink = await container.$('a[class*="embedMedia"][href]'); // Link specifically containing media class
            if (imageLink) {
                try {
                    let url = await imageLink.evaluate(node => node.href);
                    url = await unshorten(url);
                     if (url) {
                          const imgInside = await imageLink.$('img'); // Confirm it's linking an image
                          if (imgInside) {
                              localEmbedArray.push({ title: 'Image', value: url });
                          }
                     }
                } catch (e) { console.error("Error processing linked image:", e); }
            } else {
                 // Fallback to image tags within an image container if no link found
                const imageDiv = await container.$('div[class*="embedImage"], div[class*="embedMedia"]');
                if (imageDiv) {
                     const imgTag = await imageDiv.$('img');
                     if (imgTag) {
                          try {
                               let value = await imgTag.evaluate(node => node.src);
                               value = await unshorten(value);
                               if (value) localEmbedArray.push({ title: 'Image', value: value });
                          } catch (e) { console.error("Error processing image tag:", e); }
                     }
                }
            }


             // Footer
             const footer = await container.$('div[class*="embedFooter"]');
             if (footer) {
                 try {
                     const footerTextEl = await footer.$('span[class*="embedFooterText"]');
                     if (footerTextEl) {
                         const value = await footerTextEl.evaluate(node => node.textContent.trim());
                         if (value) localEmbedArray.push({ title: 'Footer', value: value });
                     }
                 } catch (e) { console.error("Error processing footer:", e); }
             }
        } // End loop through containers

        // Return the combined array
        console.log(`DEBUG: scrapeEmbed finished for message. Found ${localEmbedArray.length} embed parts.`);
        return localEmbedArray.length > 0 ? localEmbedArray : null;
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
        retries++; // Increment retry counter at the start of the loop
        console.log('\nDEBUG: Starting new scrape cycle');
        await logPageState();
        
        // Check if we're still on the Discord page
        const currentUrl = page.url();
        if (!currentUrl.includes('discord.com/channels')) {
            console.log('DEBUG: Not on Discord channel page:', currentUrl);
            await delay(5000);
            continue;
        }

        // --- Fetch last N message handles ---
        const messageHandlesData = await page.$$eval(`li[id*="chat-messages-"]:not([class*="systemMessage-"])`, (messages, bufferSize) => {
             // Get the last 'bufferSize' messages, convert node list to array
             return Array.from(messages)
                 .slice(-bufferSize) // Take the last N
                 .map(msg => ({ // Extract ID immediately in browser context
                      id: msg.id,
                      // We can't pass the element itself back, so we just use the ID
                 }));
         }, MESSAGE_BUFFER_SIZE);


        if (!messageHandlesData || messageHandlesData.length === 0) {
            console.log('DEBUG: No message elements found');
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

        const scrapedMessages = [];
        let retrievedHandles = []; // Store handles we successfully get

        try { // <<< Add try block here
            // Get the channel title once
            const tabTitle = await page.title();
            channelTitle = (tabTitle.match(/#([^|]+)/g) || [])[0]?.slice(1).trim();

            // Check for login screen once
            const mainLoginContainer = await page.$('div[class*="mainLoginContainer"]');
            if (mainLoginContainer) {
                console.log('DEBUG: Login screen detected');
                throw new Error('Login required');
            }

            // --- Process each message handle ---
            for (const msgData of messageHandlesData) {
                 const messageId = msgData.id;
                 console.log(`DEBUG: Processing message handle for ID: ${messageId}`);
                 // Get the actual element handle using the ID
                 const handle = await page.$(`#${messageId}`);

                 if (!handle) {
                      console.warn(`DEBUG: Could not retrieve handle for message ${messageId}`);
                      continue; // Skip if handle is somehow lost
                 }
                 retrievedHandles.push(handle); // Keep track for disposal

                // 1. Try scraping embeds first
                const embedArrayResult = await scrapeEmbed(handle);

                if (embedArrayResult && embedArrayResult.length > 0) {
                    console.log(`DEBUG: Found ${embedArrayResult.length} embeds in message ${messageId}`);
                    scrapedMessages.push({
                        messageId,
                        embedArray: embedArrayResult,
                        regularMessage: null // Ensure only one type is present
                    });
                    continue; // Skip regular message check if embed found
                }

                // 2. If no embeds AND regular messages enabled, try scraping regular message
                let regularMessageResult = null; // Initialize to null
                if (enableRegularMessages) {
                    console.log(`DEBUG: Attempting scrapeRegularMessage for ${messageId} (enabled: true)`);
                    regularMessageResult = await scrapeRegularMessage(handle); // Only call if enabled
                } else {
                    console.log(`DEBUG: Skipping scrapeRegularMessage for ${messageId} (enabled: false)`);
                }

                if (regularMessageResult) {
                     console.log(`DEBUG: Found regular message ${messageId}`);
                     scrapedMessages.push({
                         messageId,
                         embedArray: null,
                         regularMessage: regularMessageResult
                     });
                     continue;
                }
                
                // 3. If neither found (and regular scraping wasn't attempted or failed)
                console.log(`DEBUG: Message ${messageId} had neither embed nor recognized/enabled regular content.`);

            } // --- End loop through message handles ---

            // Dispose of handles after processing
            await Promise.all(retrievedHandles.map(h => h.dispose()));
            console.log(`DEBUG: Disposed ${retrievedHandles.length} message handles.`);

            console.log(`DEBUG: Scrape cycle finished, returning ${scrapedMessages.length} processed messages.`);
            return scrapedMessages; // Return successfully scraped messages

        } catch (error) { // <<< Add catch block here
            console.error('ERROR caught within ScrapeData message processing loop:', error);
            // Dispose of any handles we managed to retrieve before the error
             if (retrievedHandles.length > 0) {
                console.log(`DEBUG: Disposing ${retrievedHandles.length} handles after error.`);
                await Promise.all(retrievedHandles.map(h => h.dispose().catch(e => console.error('Error disposing handle after error:', e))));
             }
            return []; // Return empty array on error
        }

    } // End while retries loop

    // If loop finishes due to max retries
    console.error('ERROR: ScrapeData failed after max retries');
    return []; // Return empty array if max retries are reached
}

module.exports = { ScrapeData };