async function ScrapeData(page, enableRegularMessages) {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const maxRetries = 3;
    let retries = 0;
    let channelTitle = '';
    const MESSAGE_BUFFER_SIZE = 10; // Define buffer size

    // Helper function to process text with links
    async function processTextWithLinks(element) {
        // Ensure the element itself is valid before proceeding
        if (!element) return '';

        let processedText = '';
        let links = []; // Store handles to dispose
        let elementHandle = element; // Use a new variable to avoid modifying the input param if it's needed later

        try {
            processedText = await elementHandle.evaluate(node => node.textContent);
            links = await elementHandle.$$('a');
            let currentIndex = 0;

            if (links.length > 0) {
                for (const link of links) { // link is an ElementHandle
                    let linkText = '';
                    let href = '';
                    let originalText = '';
                    try {
                        href = await link.evaluate(node => node.getAttribute('href'));
                        linkText = (await link.evaluate(node => node.textContent.trim())).replace(/[\[\]]/g, '');
                        originalText = await link.evaluate(node => node.textContent.trim());

                        const linkIndex = processedText.indexOf(originalText, currentIndex);

                        if (linkIndex !== -1 && href) { // Ensure href is valid
                            const markdownLink = `[${linkText || href}](${href})`; // Use href if linkText is empty
                            const beforeText = processedText.substring(0, linkIndex);
                            const afterText = processedText.substring(linkIndex + originalText.length);
                            processedText = beforeText + markdownLink + afterText;
                            currentIndex = linkIndex + markdownLink.length;
                        }
                    } catch (linkError) {
                         console.error("Error processing a specific link:", linkError);
                         // Continue with the next link
                    } finally {
                         // Dispose the individual link handle regardless of success/failure within the loop
                         // No need to await dispose here if we do it later in the outer finally block
                    }
                }
            }
        } catch (error) {
            console.error("Error processing text or finding links:", error);
            // Return potentially partial text or empty string on error
            processedText = processedText || await elementHandle.evaluate(node => node.textContent) || ''; // Fallback
        } finally {
            // Dispose all link handles obtained with $$
            if (links && links.length > 0) {
                await Promise.all(links.map(l => l.dispose().catch(e => console.error("Error disposing link handle:", e))));
            }
            // Do NOT dispose the 'element' handle here, as it was passed in and might be needed by the caller.
            // The caller (scrapeEmbed, scrapeRegularMessage) is responsible for disposing the handle it passed.
        }

        return processedText;
    }

    async function scrapeRegularMessage(messageHandle) {
        let messageContent = null;
        let usernameElement = null;
        let avatarElement = null;
        let imageContainers = [];
        let regularMessageData = null;

        try {
            // First try to get the message content div
            messageContent = await messageHandle.$('div[class*="messageContent"]');
            if (!messageContent) {
                return null; // Early exit if no content div
            }

            // Get username element
            usernameElement = await messageHandle.$('span[class*="username"]');
            if (!usernameElement) {
                 return null; // Early exit if no username
            }

            // Process message content
            // evaluate runs in browser, no Node-side handles created by processNode logic itself
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


            // Get username text
            const username = await usernameElement.evaluate(node => node.textContent.trim());

            // Get avatar URL (handle might be null)
            let avatar_url = null;
            avatarElement = await messageHandle.$('img[class*="avatar"]');
            if (avatarElement) {
                avatar_url = await avatarElement.evaluate(node => node.src);
            }

            // Get message attachments (images)
            const attachments = [];
            imageContainers = await messageHandle.$$('div[class*="imageContent__0f481"]');
            if (imageContainers.length > 0) {
                for (const container of imageContainers) { // container is a handle
                    let img = null;
                    try {
                        img = await container.$('img');
                        if (img) {
                            const src = await img.evaluate(node => node.src);
                            attachments.push({ type: 'image', url: src });
                        }
                    } catch (imgError) {
                         console.error("Error processing attachment image:", imgError);
                    } finally {
                        if (img) await img.dispose().catch(e => console.error("Error disposing attachment img handle:", e));
                        // container handle disposed below in Promise.all
                    }
                }
            }

            // Construct the result object
             regularMessageData = {
                content: content, // Use the processed content
                username,
                avatar_url,
                attachments: attachments.length > 0 ? attachments : undefined
            };

        } catch (error) {
            console.log('Error in scrapeRegularMessage:', error);
            regularMessageData = null; // Ensure null is returned on error
        } finally {
            // Dispose all handles obtained in this function
            const handlesToDispose = [messageContent, usernameElement, avatarElement].filter(Boolean);
            await Promise.all(handlesToDispose.map(h => h.dispose().catch(e => console.error("Error disposing regular message handle:", e))));
             if (imageContainers && imageContainers.length > 0) {
                await Promise.all(imageContainers.map(h => h.dispose().catch(e => console.error("Error disposing image container handle:", e))));
            }
        }
        return regularMessageData;
    }

    // REFACTOR scrapeEmbed to work on a single message handle
    async function scrapeEmbed(messageHandle) {
        const localEmbedArray = [];
        let embedContainers = []; // Array to hold container handles

        try {
            embedContainers = await messageHandle.$$('article[class*="embed"], div[class*="embedWrapper"]');

            if (embedContainers.length === 0) {
                return null; // No embed container found in this message
            }

            // Helper for processing fields - modified for disposal
            async function processField(fieldElement) { // fieldElement is a handle
                let nameEl = null;
                let valueEl = null;
                try {
                    nameEl = await fieldElement.$('div[class*="embedFieldName"]');
                    valueEl = await fieldElement.$('div[class*="embedFieldValue"]');
                    if (nameEl && valueEl) {
                        const name = await nameEl.evaluate(node => node.textContent.trim());
                        // Call processTextWithLinks, passing the handle. It won't dispose valueEl itself.
                        const value = await processTextWithLinks(valueEl);
                        if (name && value) localEmbedArray.push({ title: name, value: value });
                    }
                } catch(fieldProcError) {
                     console.error("Error processing field content:", fieldProcError);
                } finally {
                    // Dispose handles obtained within this helper
                    if (nameEl) await nameEl.dispose().catch(e => console.error("Error disposing field nameEl:", e));
                    if (valueEl) await valueEl.dispose().catch(e => console.error("Error disposing field valueEl:", e));
                     // fieldElement itself is disposed by the caller loop
                }
            }

            // Iterate through each found embed container
            for (const container of embedContainers) { // container is a handle
                // --- Author ---
                let author = null;
                let authorNameEl = null;
                let authorLinkEl = null;
                try {
                    author = await container.$('div[class*="embedAuthor"]');
                    if (author) {
                        authorNameEl = await author.$('span[class*="embedAuthorName"]');
                        authorLinkEl = await author.$('a[class*="embedAuthorNameLink"]');
                        let value = '', url = null;
                        if (authorLinkEl) {
                            value = await authorLinkEl.evaluate(node => node.textContent.trim());
                            url = await authorLinkEl.evaluate(node => node.href);
                        } else if (authorNameEl) {
                            value = await authorNameEl.evaluate(node => node.textContent.trim());
                        }
                        if (value) localEmbedArray.push({ title: 'Author', value: value, url: url });
                    }
                } catch (e) { console.error("Error processing author:", e); }
                 finally {
                    if (authorLinkEl) await authorLinkEl.dispose().catch(err => console.error("Dispose authorLinkEl err:", err));
                    if (authorNameEl) await authorNameEl.dispose().catch(err => console.error("Dispose authorNameEl err:", err));
                    if (author) await author.dispose().catch(err => console.error("Dispose author err:", err));
                 }

                // --- Title ---
                 let title = null;
                 let titleLink = null;
                 try {
                     title = await container.$('div[class*="embedTitle"]');
                     if (title) {
                         let value = '', url = null;
                         titleLink = await title.$('a');
                         if (titleLink) {
                             value = await titleLink.evaluate(node => node.textContent.trim());
                             url = await titleLink.evaluate(node => node.href);
                         } else {
                             value = await title.evaluate(node => node.textContent.trim());
                         }
                         if (value) localEmbedArray.push({ title: 'Title', value: value, url: url });
                     }
                 } catch (e) { console.error("Error processing title:", e); }
                 finally {
                     if (titleLink) await titleLink.dispose().catch(err => console.error("Dispose titleLink err:", err));
                     if (title) await title.dispose().catch(err => console.error("Dispose title err:", err));
                 }

                // --- Description ---
                 let description = null;
                 try {
                     description = await container.$('div[class*="embedDescription"]');
                     if (description) {
                         // Pass handle, processTextWithLinks won't dispose it
                         const value = await processTextWithLinks(description);
                         if (value) localEmbedArray.push({ title: 'Description', value: value });
                     }
                 } catch (e) { console.error("Error processing description:", e); }
                 finally {
                     if (description) await description.dispose().catch(err => console.error("Dispose description err:", err));
                 }

                // --- Fields ---
                 let fieldsContainer = null;
                 let fields = [];
                 try {
                     fieldsContainer = await container.$('div[class*="embedFields"]');
                     if (fieldsContainer) {
                         fields = await fieldsContainer.$$('div[class*="embedField_"]');
                         for (const field of fields) { // field is a handle
                              // processField is responsible for disposing its internal handles (nameEl, valueEl)
                             await processField(field);
                              // The 'field' handle itself will be disposed in the fields Promise.all below
                         }
                     }
                 } catch (e) { console.error("Error processing fields:", e); }
                 finally {
                      if (fields && fields.length > 0) {
                         await Promise.all(fields.map(f => f.dispose().catch(err => console.error("Dispose field err:", err))));
                      }
                     if (fieldsContainer) await fieldsContainer.dispose().catch(err => console.error("Dispose fieldsContainer err:", err));
                 }

                // --- Thumbnail ---
                 let thumbnailDiv = null;
                 let thumb = null;
                 try {
                     thumbnailDiv = await container.$('div[class*="embedThumbnail"]');
                     if (thumbnailDiv) {
                         thumb = await thumbnailDiv.$('img');
                          if (thumb) {
                              let value = await thumb.evaluate(node => node.src);
                              if (value) localEmbedArray.push({ title: 'Thumbnail', value: value });
                          }
                     }
                 } catch (e) { console.error("Error processing thumbnail:", e); }
                 finally {
                     if (thumb) await thumb.dispose().catch(err => console.error("Dispose thumb err:", err));
                     if (thumbnailDiv) await thumbnailDiv.dispose().catch(err => console.error("Dispose thumbnailDiv err:", err));
                 }

                // --- Image ---
                 let imageLink = null;
                 let imgInside = null;
                 let imageDiv = null;
                 let imgTag = null;
                 try {
                     imageLink = await container.$('a[class*="embedMedia"][href]');
                     if (imageLink) {
                          let url = await imageLink.evaluate(node => node.href);
                           if (url) {
                                imgInside = await imageLink.$('img'); // Confirm it's linking an image
                                if (imgInside) {
                                    localEmbedArray.push({ title: 'Image', value: url });
                                }
                           }
                     } else {
                         imageDiv = await container.$('div[class*="embedImage"], div[class*="embedMedia"]');
                         if (imageDiv) {
                              imgTag = await imageDiv.$('img');
                              if (imgTag) {
                                   let value = await imgTag.evaluate(node => node.src);
                                   if (value) localEmbedArray.push({ title: 'Image', value: value });
                              }
                         }
                     }
                 } catch (e) { console.error("Error processing image section:", e); }
                 finally {
                     // Dispose all potential handles from this block
                     if (imgInside) await imgInside.dispose().catch(err => console.error("Dispose imgInside err:", err));
                     if (imageLink) await imageLink.dispose().catch(err => console.error("Dispose imageLink err:", err));
                     if (imgTag) await imgTag.dispose().catch(err => console.error("Dispose imgTag err:", err));
                     if (imageDiv) await imageDiv.dispose().catch(err => console.error("Dispose imageDiv err:", err));
                 }

                 // --- Footer ---
                  let footer = null;
                  let footerTextEl = null;
                  try {
                      footer = await container.$('div[class*="embedFooter"]');
                      if (footer) {
                          footerTextEl = await footer.$('span[class*="embedFooterText"]');
                          if (footerTextEl) {
                              const value = await footerTextEl.evaluate(node => node.textContent.trim());
                              if (value) localEmbedArray.push({ title: 'Footer', value: value });
                          }
                      }
                  } catch (e) { console.error("Error processing footer:", e); }
                  finally {
                      if (footerTextEl) await footerTextEl.dispose().catch(err => console.error("Dispose footerTextEl err:", err));
                      if (footer) await footer.dispose().catch(err => console.error("Dispose footer err:", err));
                  }
                 // The 'container' handle itself is disposed in the main finally block below
            } // End loop through containers

        } catch (mainEmbedError) {
             console.error("Major error during embed scraping:", mainEmbedError);
             return null; // Return null on significant error
        } finally {
            // Dispose all container handles obtained with $$ at the beginning
            if (embedContainers && embedContainers.length > 0) {
                await Promise.all(embedContainers.map(c => c.dispose().catch(e => console.error("Error disposing embed container handle:", e))));
            }
        }

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
        let mainLoginContainer = null; // Declare handle outside try

        try { // <<< Add try block here
            // Get the channel title once
            const tabTitle = await page.title();
            channelTitle = (tabTitle.match(/#([^|]+)/g) || [])[0]?.slice(1).trim();

            // Check for login screen once
            mainLoginContainer = await page.$('div[class*="mainLoginContainer"]');
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
        } finally { // <<< Add finally block here
             // Dispose of mainLoginContainer handle if it was fetched
             if (mainLoginContainer) {
                await mainLoginContainer.dispose().catch(e => console.error('Error disposing mainLoginContainer handle:', e));
             }
             // Dispose of any message handles we managed to retrieve before the error or at the end
             if (retrievedHandles.length > 0) {
                console.log(`DEBUG: Disposing ${retrievedHandles.length} main message handles...`);
                await Promise.all(retrievedHandles.map(h => h.dispose().catch(e => console.error('Error disposing retrieved message handle:', e))));
                console.log(`DEBUG: Finished disposing main message handles.`);
             }
             // NOTE: We return [] in the catch block, not here.
             // The successful return happens after the try block if no error occurred.
        }

    } // End while retries loop

    // If loop finishes due to max retries
    console.error('ERROR: ScrapeData failed after max retries');
    return []; // Return empty array if max retries are reached
}

module.exports = { ScrapeData };