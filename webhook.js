const { Webhook, MessageBuilder } = require('discord-webhook-node');

exports.buildWebhook = async (embedArray, webhookUrl) => {
    try {
        if (!embedArray || embedArray.length === 0) {
            console.log('No embeds to send, skipping webhook');
            return;
        }

        const hook = new Webhook(webhookUrl);
        const embedMessage = new MessageBuilder();
        embedMessage.setColor('#FF5733');
        hook.setAvatar('https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
        hook.setUsername('Dollar Shoe Club');
        let skipNext = false;

        embedArray.forEach((embed, index) => {
            try {
                if (!embed || !embed.title || !embed.value) return;
                var { title, value } = embed;

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
                            const titleLinkRegex = /https?:\/\/\S+/gi;
                            if (value.match(titleLinkRegex)) {
                                embedMessage.setURL(`${value.match(titleLinkRegex)[0]}`)
                                value = value.replace(titleLinkRegex, '')
                            }
                            embedMessage.setTitle(value);
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

        try {
            await hook.send(embedMessage);
        } catch (err) {
            console.error('Error sending webhook message:', err);
            throw err; // Re-throw to be caught by the retry mechanism
        }
    } catch (error) {
        console.error('Error building webhook:', error);
        throw error; // Re-throw to be caught by the retry mechanism
    }
};
