const { Webhook, MessageBuilder } = require('discord-webhook-node');

exports.logError = (error, channel, webhookUrl) => {
    try {
        const hook = new Webhook(webhookUrl);
        const embedMessage = new MessageBuilder()
            .setColor('#FF5733')
            .setTitle(channel) // Use the channel as the title
            .setDescription(error)
            .setThumbnail('https://i.imgur.com/DiPKO6Z.png');

        hook.setAvatar('https://i.imgur.com/DiPKO6Z.png');
        hook.setUsername('Monitor');

        hook.send(embedMessage);
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
};
