const { Webhook, MessageBuilder } = require('discord-webhook-node');

exports.buildWebhook = (embedArray, webhookUrl) => {
    try {
        const hook = new Webhook(webhookUrl); // Replace with your actual webhook URL
        const embedMessage = new MessageBuilder()
        embedMessage.setColor('#FF5733');
        hook.setAvatar('https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
        // hook.setUsername(channelName);
        let skipNext = false;
        embedArray.forEach((embed, index) => {
            var { title, value } = embed;

            // You can set the color according to your preference

            switch (title.toLowerCase()) {
                case 'author':
                    // const authorLinkRegex = /https?:\/\/\S+/gi;
                    // if (value.match(authorLinkRegex)) {
                    //     // embedMessage.setUrl(`${value.match(linkRegex)[0]}`)
                    //     // embedMessage.setURL(`${value.match(authorLinkRegex)[0]}`)
                    //     value = value.replace(authorLinkRegex, '')
                    // }
                    embedMessage.setAuthor(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg')
                    break;
                case 'description':
                    embedMessage.setDescription(value);
                    break;
                case 'footer':
                    embedMessage.setFooter(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                    break;
                case 'title':
                    const titleLinkRegex = /https?:\/\/\S+/gi;
                    if (value.match(titleLinkRegex)) {
                        // embedMessage.setUrl(`${value.match(linkRegex)[0]}`)
                        embedMessage.setURL(`${value.match(titleLinkRegex)[0]}`)
                        value = value.replace(titleLinkRegex, '')
                    }
                    embedMessage.setTitle(value);
                    break;
                case 'thumbnail':
                    embedMessage.setThumbnail(value)
                    break;
                case 'image':
                    embedMessage.setImage(value)
                    break;
                default:
                    if (skipNext) {
                        skipNext = false; // Reset the flag
                        break;
                    } else {
                        if (index + 1 < embedArray.length && embedArray[index + 1].title.length < 2) {
                            embedMessage.addField(title, value, true);

                        } else {
                            if(value.length > 2) {
                                embedMessage.addField(title, value);
                            }
                        }
                        break;
                    }
            }
        });
        // console.log(embedMessage['payload']['embeds'][0])
        hook.send(embedMessage);
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
};
