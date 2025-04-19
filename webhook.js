const { Webhook, MessageBuilder } = require('discord-webhook-node');
const fetch = require('node-fetch');

exports.sendRegularMessage = async (message, webhookUrl, isTestingModule = false) => {
    // Skip sending if in testing mode
    if (isTestingModule) {
        console.log('[TESTING MODE] Skipping regular message send.');
        return;
    }
    
    console.log('[1/4] Init regular message send');
    
    if (!message?.content) {
        console.log('[1/4] Abort - Missing content');
        return;
    }

    try {
        console.log('[2/4] Building payload');
        const payload = {
            content: message.content.substring(0, 2000),
            username: message.username?.substring(0, 80) || 'Unknown User',
            avatar_url: message.avatar_url || 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg'
        };

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
            return await hook.send(regularMessage.content);
        }

        let skipNext = false;

        embedArray.forEach((embed, index) => {
            try {
                if (!embed || !embed.title || !embed.value) {
                    console.warn('Skipping embed item due to missing title or value:', embed);
                    return;
                }
                var { title, value, url } = embed;

                switch (title.toLowerCase()) {
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
                            if (skipNext) {
                                skipNext = false;
                                break;
                            }
                            
                            let addInline = false;
                            if (index + 1 < embedArray.length && embedArray[index + 1].title) {
                                if (embedArray[index + 1].title.length < 2) {
                                    addInline = true;
                                }
                            }

                            if(value && value.trim().length > 0) {
                                embedMessage.addField(title, value, addInline);
                                if (addInline) {
                                    skipNext = embedArray[index + 1].title.length < 2;
                                }
                            } else {
                                console.warn('Skipping empty field:', { title });
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
        
        return await hook.send(embedMessage);
    } catch (error) {
        const logFnError = typeof logTask === 'function' ? logTask : (id, lvl, ...args) => console.error(`[${id}] [${lvl}]`, ...args);
        logFnError('WEBHOOK', 'ERROR', `Error in buildWebhook outer catch: ${error?.message}`, error);
        throw error;
    }
};
