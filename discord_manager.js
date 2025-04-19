const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { logTask } = require('./utils');

class DiscordManager {
    constructor() {
        this.client = null;
        this.isReady = false;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.rateLimitDelay = 100; // Delay between messages in ms
        this.initializationTime = null;
        this.lastReadyTime = null;
        this.connectionAttempts = 0;
    }

    async initialize(token) {
        this.connectionAttempts++;
        logTask('DISCORD', 'INFO', `Initializing Discord client (Attempt ${this.connectionAttempts})`);
        
        try {
            if (this.client) {
                logTask('DISCORD', 'INFO', 'Destroying existing client before initialization');
                await this.client.destroy();
            }

            this.initializationTime = new Date();
            this.client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                ],
                presence: {
                    status: 'online'
                }
            });

            // Set up event handlers
            this.client.on('ready', () => {
                this.isReady = true;
                this.lastReadyTime = new Date();
                const initTime = (this.lastReadyTime - this.initializationTime) / 1000;
                logTask('DISCORD', 'INFO', `Client ready! Logged in as ${this.client.user.tag} (took ${initTime}s)`);
                logTask('DISCORD', 'INFO', `Queue status: ${this.messageQueue.length} messages waiting`);
                this.processQueue(); // Start processing any queued messages
            });

            this.client.on('disconnect', () => {
                this.isReady = false;
                logTask('DISCORD', 'WARNING', 'Client disconnected from gateway');
                this.reconnect();
            });

            this.client.on('error', (error) => {
                this.isReady = false;
                logTask('DISCORD', 'ERROR', `Discord client error: ${error.message}`, error);
                this.reconnect();
            });

            this.client.on('debug', (info) => {
                // logTask('DISCORD', 'DEBUG', `Discord debug: ${info}`);
            });

            // Handle rate limits
            this.client.rest.on('rateLimited', (info) => {
                logTask('DISCORD', 'WARNING', `Rate limited: ${info.timeToReset}ms remaining`, info);
                this.rateLimitDelay = Math.min(info.timeToReset + 100, 5000); // Add buffer, max 5s
            });

            // Login
            logTask('DISCORD', 'INFO', 'Attempting to login...');
            await this.client.login(token);
            return true;
        } catch (error) {
            logTask('DISCORD', 'ERROR', `Failed to initialize Discord client: ${error.message}`, error);
            return false;
        }
    }

    async reconnect() {
        logTask('DISCORD', 'INFO', `Attempting to reconnect (Attempt ${this.connectionAttempts + 1})`);
        try {
            await this.client.destroy();
            logTask('DISCORD', 'INFO', 'Previous client destroyed, reinitializing...');
            await this.client.login(this.client.token);
        } catch (error) {
            logTask('DISCORD', 'ERROR', `Failed to reconnect: ${error.message}`, error);
            // Try again in 5 seconds
            setTimeout(() => this.reconnect(), 5000);
        }
    }

    async sendMessage(channelId, embedArray, taskId) {
        logTask(taskId, 'INFO', `Queueing message for channel ${channelId}`);
        return new Promise((resolve, reject) => {
            this.messageQueue.push({
                channelId,
                embedArray,
                taskId,
                resolve,
                reject,
                attempts: 0,
                maxAttempts: 3,
                queueTime: new Date()
            });
            
            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;
        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue[0];
            const queueTime = (new Date() - message.queueTime) / 1000;
            
            if (!this.isReady) {
                logTask(message.taskId, 'WARNING', `Discord client not ready, waiting... (Client state: ${this.getClientState()}, Queue time: ${queueTime}s)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            try {
                logTask(message.taskId, 'INFO', `Attempting to fetch channel ${message.channelId}`);
                const channel = await this.client.channels.fetch(message.channelId);
                
                if (!channel) {
                    throw new Error(`Channel ${message.channelId} not found`);
                }

                // Convert the original embed array format to Discord.js format
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTimestamp();

                const fields = [];
                let description = '';

                for (const item of message.embedArray) {
                    switch (item.title) {
                        case 'Title':
                            try {
                                embed.setTitle(item.value);
                                
                                // First check for direct URL from scraping
                                if (item.url) {
                                    embed.setURL(item.url);
                                }
                                // Fallback to markdown parsing if no direct URL
                                else {
                                    const markdownMatch = item.value.match(/(.*)\]\((.*?)\)$/);
                                    if (markdownMatch) {
                                        const [fullMatch, text, url] = markdownMatch;
                                        embed.setTitle(text + ']');
                                        embed.setURL(url);
                                    }
                                }
                            } catch (err) {
                                console.error('Error processing title:', err);
                            }
                            break;
                        case 'Description':
                            description = item.value;
                            break;
                        case 'Image':
                            embed.setImage(item.value);
                            break;
                        case 'Thumbnail':
                            embed.setThumbnail(item.value);
                            break;
                        case 'Footer':
                            embed.setFooter({ text: item.value });
                            break;
                        case 'Author':
                            embed.setAuthor({ name: item.value });
                            break;
                        case 'Fields':
                            try {
                                for (const field of item.value) {
                                    embed.addFields({
                                        name: field.name,
                                        value: field.value
                                    });
                                }
                            } catch (err) {
                                console.error('Error processing fields:', err);
                            }
                            break;
                        default:
                            const fieldName = item.title || '\u200B';
                            let fieldValue = item.value || '\u200B';
                            
                            // Discord has a 256 character limit for field names and 1024 for values
                            const name = fieldName.substring(0, 256);
                            const value = fieldValue.substring(0, 1024);
                            
                            fields.push({ name, value, inline: false });
                    }
                }

                if (description) {
                    // Discord has a 4096 character limit for descriptions
                    embed.setDescription(description.substring(0, 4096));
                }

                if (fields.length > 0) {
                    // Discord allows up to 25 fields
                    embed.addFields(fields.slice(0, 25));
                }

                await channel.send({ embeds: [embed] });
                logTask(message.taskId, 'SUCCESS', 'Message sent successfully');
                message.resolve();
                this.messageQueue.shift();

                // Add delay to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
            } catch (error) {
                logTask(message.taskId, 'ERROR', `Failed to process message: ${error.message}`, error);
                message.attempts++;
                
                if (message.attempts >= message.maxAttempts) {
                    logTask(message.taskId, 'ERROR', `Max retry attempts reached for message, removing from queue`);
                    this.messageQueue.shift();
                    message.reject(error);
                }
            }

            await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
        }

        this.isProcessingQueue = false;
    }

    getClientState() {
        if (!this.client) return 'No client';
        if (!this.client.token) return 'No token';
        if (this.client.destroyed) return 'Destroyed';
        if (!this.isReady) return 'Not ready';
        return 'Ready';
    }

    destroy() {
        logTask('DISCORD', 'INFO', 'Destroying Discord client');
        if (this.client) {
            this.client.destroy();
            this.client = null;
            this.isReady = false;
            this.initializationTime = null;
            this.lastReadyTime = null;
        }
    }
}

module.exports = new DiscordManager(); 