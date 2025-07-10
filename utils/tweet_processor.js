const EventEmitter = require('events');
const { matchesKeywords } = require('./keyword_filter');
const { logTask } = require('../utils');

// Create a singleton event emitter
const webhookEmitter = new EventEmitter();

/**
 * Process a webhook event for potential tweeting
 * @param {Object} data - The webhook data
 * @param {Object} taskSettings - The task settings containing tweet configuration
 */
async function processWebhookForTweet(data, taskSettings) {
    const { embedArray, regularMessage, messageId } = data;
    
    // Skip if tweeting is not enabled
    if (!taskSettings.enableTweeting || !taskSettings.tweetKeywords) {
        return;
    }

    try {
        // For regular messages, check the content
        if (regularMessage && regularMessage.content) {
            if (matchesKeywords(regularMessage.content, taskSettings.tweetKeywords)) {
                logTask(taskSettings.taskId, 'INFO', `Regular message ${messageId} matches tweet keywords`);
                // TODO: Send to n8n webhook
            }
            return;
        }

        // For embeds, check the title and description
        if (embedArray && embedArray.length > 0) {
            const title = embedArray.find(e => e.title.toLowerCase() === 'title')?.value || '';
            const description = embedArray.find(e => e.title.toLowerCase() === 'description')?.value || '';
            
            // Combine title and description for keyword matching
            const combinedText = `${title} ${description}`;
            
            if (matchesKeywords(combinedText, taskSettings.tweetKeywords)) {
                logTask(taskSettings.taskId, 'INFO', `Embed ${messageId} matches tweet keywords`);
                // TODO: Send to n8n webhook
            }
        }
    } catch (error) {
        // Log error but don't throw - we don't want to affect the main monitor
        logTask(taskSettings.taskId, 'ERROR', `Error processing webhook for tweet: ${error.message}`, error);
    }
}

// Listen for webhook events
webhookEmitter.on('webhook_sent', processWebhookForTweet);

module.exports = {
    webhookEmitter
}; 