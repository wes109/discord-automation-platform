const { Webhook, MessageBuilder } = require('discord-webhook-node');
const fetch = require('node-fetch');
const { webhookEmitter } = require('./utils/tweet_processor');

exports.sendRegularMessage = async (message, webhookUrl, isTestingModule = false) => {
    // Skip sending if in testing mode
    if (isTestingModule) {
        console.log('[TESTING MODE] Skipping regular message send.');
        return;
    }
    
    console.log('[1/4] Init regular message send');
    
    if (!message?.content && !message?.attachments) {
        console.log('[1/4] Abort - Missing content and attachments');
        return;
    }

    try {
        console.log('[2/4] Building payload');
        const payload = {
            content: message.content ? message.content.substring(0, 2000) : '',
            username: message.username?.substring(0, 80) || 'Unknown User',
            avatar_url: message.avatar_url || 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg'
        };

        // Add embeds for attachments if they exist
        if (message.attachments && message.attachments.length > 0) {
            payload.embeds = message.attachments.map(attachment => ({
                image: {
                    url: attachment.url
                }
            }));
        }

        console.log('[3/4] Payload:', JSON.stringify(payload));
        console.log('[3/4] Sending to Discord API');
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        console.log('[4/4] Success');
        
        // Fire and forget - emit webhook event
        webhookEmitter.emit('webhook_sent', {
            regularMessage: message,
            messageId: message.id || Date.now().toString()
        });
    } catch (error) {
        console.log(`[4/4] Failed - ${error.message}`);
        throw error;
    }
};

exports.buildWebhook = async (embedArray, webhookUrl, isTestingModule = false) => {
    // Skip sending if in testing mode
    if (isTestingModule) {
        console.log('[TESTING MODE] Skipping embed webhook send.');
        return;
    }

    try {
        if (!embedArray || embedArray.length === 0) return;

        const hook = new Webhook(webhookUrl);
        const embedMessage = new MessageBuilder();
        embedMessage.setColor('#FF5733');

        // Continue with normal embed processing for embed messages
        hook.setAvatar('https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
        hook.setUsername('Dollar Shoe Club');
        // Handle regular messages differently from embeds
        const regularMessage = embedArray.find(item => item.type === 'message');
        if (regularMessage) {
            hook.setUsername(regularMessage.username);
            if (regularMessage.avatar_url) {
                hook.setAvatar(regularMessage.avatar_url);
            }
            await hook.send(regularMessage.content);
            
            // Fire and forget - emit webhook event for regular message
            webhookEmitter.emit('webhook_sent', {
                regularMessage,
                messageId: regularMessage.id || Date.now().toString()
            });
            return;
        }

        let skipNext = false;

        embedArray.forEach((embed, index) => {
            try {
                // Allow empty titles (zero-width space) but require value
                if (!embed || !embed.value) {
                    console.warn('Skipping embed item due to missing value:', embed);
                    return;
                }
                var { title, value, url } = embed;
                // Normalize title - handle empty strings and zero-width spaces
                const normalizedTitle = (title || '').trim() || '\u200B';

                switch (normalizedTitle.toLowerCase()) {
                    case 'author':
                        embedMessage.setAuthor(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                        break;
                    case 'description':
                        embedMessage.setDescription(value);
                        break;
                    case 'footer':
                        // Always use "Dollar Shoe Club Monitoring" as the footer
                        embedMessage.setFooter('Dollar Shoe Club Monitoring', 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                        break;
                    case 'title':
                        try {
                            console.log('\nProcessing Title:', { title, value, url });
                            embedMessage.setTitle(value);
                            if (url) {
                                embedMessage.setURL(url);
                            }
                        } catch (err) {
                            console.error('Error processing title:', err, 'Embed data:', embed);
                            throw err;
                        }
                        break;
                    case 'thumbnail':
                        embedMessage.setThumbnail(value);
                        break;
                    case 'image':
                        embedMessage.setImage(value);
                        break;
                    default:
                        try {
                            let addInline = false;
                            
                            // If skipNext is set, this field was already determined to be inline in previous iteration
                            // Still add it, but don't re-check inline layout
                            if (skipNext) {
                                addInline = true;
                                skipNext = false;
                            } else {
                                // Check if next field exists and has a short/empty title for inline layout
                                if (index + 1 < embedArray.length && embedArray[index + 1]) {
                                    const nextTitle = (embedArray[index + 1].title || '').trim() || '\u200B';
                                    // Zero-width space or titles < 2 chars should be inline
                                    if (nextTitle === '\u200B' || nextTitle.length < 2) {
                                        addInline = true;
                                    }
                                }
                            }

                            if(value && value.trim().length > 0) {
                                embedMessage.addField(normalizedTitle, value, addInline);
                                // Set skipNext for next iteration if this field was inline and next field also has empty/short name
                                if (addInline && index + 1 < embedArray.length && embedArray[index + 1]) {
                                    const nextTitle = (embedArray[index + 1].title || '').trim() || '\u200B';
                                    skipNext = (nextTitle === '\u200B' || nextTitle.length < 2);
                                }
                            } else {
                                console.warn('Skipping empty field:', { title: normalizedTitle });
                            }
                        } catch (err) {
                            console.error('Error processing default field:', err, 'Embed data:', embed, 'Next embed:', embedArray[index + 1]);
                            throw err;
                        }
                        break;
                }
            } catch (err) {
                console.error('Error processing embed item in forEach:', err, 'Embed data:', embed);
                throw err;
            }
        });

        // Always set the footer at the end to ensure it's not overwritten
        embedMessage.setFooter('Dollar Shoe Club Monitoring', 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
        
        // Add a timestamp
        embedMessage.setTimestamp();

        const logFnDebug = typeof logTask === 'function' ? logTask : (id, lvl, ...args) => console.log(`[${id}] [${lvl}]`, ...args);
        logFnDebug('WEBHOOK', 'DEBUG', 'Attempting final hook.send');
        
        await hook.send(embedMessage);
        
        // Fire and forget - emit webhook event for embeds
        webhookEmitter.emit('webhook_sent', {
            embedArray,
            messageId: Date.now().toString()
        });
    } catch (error) {
        const logFnError = typeof logTask === 'function' ? logTask : (id, lvl, ...args) => console.error(`[${id}] [${lvl}]`, ...args);
        logFnError('WEBHOOK', 'ERROR', `Error in buildWebhook outer catch: ${error?.message}`, error);
        throw error;
    }
};
