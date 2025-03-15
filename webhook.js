const { Webhook, MessageBuilder } = require('discord-webhook-node');
const fetch = require('node-fetch');

exports.sendRegularMessage = async (message, webhookUrl) => {
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

exports.buildWebhook = async (embedArray, webhookUrl) => {
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
                if (!embed || !embed.title || !embed.value) return;
                var { title, value, url } = embed;

                switch (title.toLowerCase()) {
                    case 'author':
                        embedMessage.setAuthor(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg')
                        break;
                    case 'description':
                        embedMessage.setDescription(value);
                        break;
                    case 'footer':
                        embedMessage.setFooter(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                        break;
                    case 'title':
                        try {
                            const { title, value, url } = embed;
                            console.log('\nTitle embedArray:', embedArray);
                            
                            embedMessage.setTitle(value);
                            if (url) {
                                embedMessage.setURL(url);
                            }
                        } catch (err) {
                            console.error('Error processing title:', err);
                        }
                        break;
                    case 'thumbnail':
                        embedMessage.setThumbnail(value)
                        break;
                    case 'image':
                        embedMessage.setImage(value)
                        break;
                    default:
                        try {
                            if (skipNext) {
                                skipNext = false;
                                break;
                            }
                            
                            if (index + 1 < embedArray.length && embedArray[index + 1].title && embedArray[index + 1].title.length < 2) {
                                embedMessage.addField(title, value, true);
                            } else {
                                if(value.length > 2) {
                                    embedMessage.addField(title, value);
                                }
                            }
                        } catch (err) {
                            console.error('Error processing field:', err);
                        }
                }
            } catch (err) {
                console.error('Error processing embed:', err);
            }
        });

        return await hook.send(embedMessage);
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
};
