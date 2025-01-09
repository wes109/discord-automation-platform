const { Webhook, MessageBuilder } = require('discord-webhook-node');

exports.logError = (error, channel, webhookUrl) => {
    try {
        const hook = new Webhook(webhookUrl);
        const embedMessage = new MessageBuilder()
            .setColor('#FF5733')
            .setTitle(channel) // Use the channel as the title
            .setDescription(error)
            .setThumbnail('https://cdn3.emoji.gg/emojis/5316_Error_512x512_by_DW.png');

        hook.setAvatar('https://cdn3.emoji.gg/emojis/5316_Error_512x512_by_DW.png');
        hook.setUsername('Dollar Shoe Club');

        hook.send(embedMessage);
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
};
