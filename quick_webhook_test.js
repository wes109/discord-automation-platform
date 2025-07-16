const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { buildWebhook } = require('./webhook.js');
const { ScrapeData } = require('./scrape.js');

// Load task settings
function loadTaskSettings() {
    try {
        const taskSettingsPath = path.join(__dirname, 'task_settings.json');
        if (!fs.existsSync(taskSettingsPath)) {
            console.log('❌ task_settings.json not found!');
            return null;
        }
        
        const taskSettings = JSON.parse(fs.readFileSync(taskSettingsPath, 'utf8'));
        return taskSettings;
    } catch (error) {
        console.error('❌ Error loading task settings:', error);
        return null;
    }
}

// Generate a profile ID like the main system does
function generateProfileId() {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    return `profile_${timestamp}_${randomId}`;
}

// Create a task profile like the main system
async function createTaskProfile(taskId) {
    const baseProfilePath = path.join(__dirname, 'my-profile');
    const profileId = generateProfileId();
    const profilePath = path.join(__dirname, profileId);
    
    try {
        // Check if base profile exists
        if (!fs.existsSync(baseProfilePath)) {
            console.log('⚠️  Base profile (my-profile) not found. Using default profile.');
            return profileId; // Return ID but don't copy
        }
        
        // Copy base profile to new profile directory
        await fs.copy(baseProfilePath, profilePath);
        console.log(`✅ Created profile: ${profileId}`);
        return profileId;
    } catch (error) {
        console.error(`❌ Error creating profile for task ${taskId}:`, error);
        return profileId; // Return ID even if copy fails
    }
}

// Launch browser with profile like the main system
async function launchBrowser(profileId, headless = false) {
    console.log(`🌐 Launching browser with profile: ${profileId}, Headless: ${headless}`);
    
    try {
        const launchOptions = {
            headless: headless === true ? 'new' : false,
            defaultViewport: null,
            userDataDir: `./${profileId}`,
            args: [
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disk-cache-size=0'
            ]
        };
        
        const browser = await puppeteer.launch(launchOptions);
        console.log('✅ Browser launched successfully');
        return browser;
    } catch (error) {
        console.error('❌ Failed to launch browser:', error);
        throw error;
    }
}

async function quickWebhookTest(taskIdOrIndex = null) {
    console.log('🚀 Starting quick webhook test with existing task data...');
    
    // Load task settings
    const taskSettings = loadTaskSettings();
    if (!taskSettings) {
        console.log('❌ Could not load task settings. Exiting.');
        return;
    }
    
    // Get available tasks
    const taskIds = Object.keys(taskSettings);
    console.log(`📋 Found ${taskIds.length} available tasks:`);
    
    taskIds.forEach((id, index) => {
        const task = taskSettings[id];
        console.log(`  ${index + 1}. ${task.label || 'Unnamed'} (${id})`);
        console.log(`     Channel: ${task.channelUrl}`);
        console.log(`     Targets: ${task.targetChannels?.join(', ') || 'None'}`);
    });
    
    // Select task
    let selectedTask;
    if (taskIdOrIndex) {
        // If a specific task ID is provided
        if (taskSettings[taskIdOrIndex]) {
            selectedTask = { id: taskIdOrIndex, ...taskSettings[taskIdOrIndex] };
        } else {
            // If it's a number, treat as index
            const index = parseInt(taskIdOrIndex) - 1;
            if (index >= 0 && index < taskIds.length) {
                const taskId = taskIds[index];
                selectedTask = { id: taskId, ...taskSettings[taskId] };
            }
        }
    } else {
        // Interactive selection
        console.log('\n🎯 Select a task to test (enter number or task ID):');
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
            rl.question('Enter selection: ', resolve);
        });
        rl.close();
        
        if (taskSettings[answer]) {
            selectedTask = { id: answer, ...taskSettings[answer] };
        } else {
            const index = parseInt(answer) - 1;
            if (index >= 0 && index < taskIds.length) {
                const taskId = taskIds[index];
                selectedTask = { id: taskId, ...taskSettings[taskId] };
            }
        }
    }
    
    if (!selectedTask) {
        console.log('❌ Invalid task selection. Exiting.');
        return;
    }
    
    console.log(`\n🎯 Selected task: ${selectedTask.label || 'Unnamed'} (${selectedTask.id})`);
    console.log(`📺 Channel: ${selectedTask.channelUrl}`);
    console.log(`🎯 Targets: ${selectedTask.targetChannels?.join(', ') || 'None'}`);
    console.log(`⚙️  Settings: Headless=${selectedTask.headless}, Regular Messages=${selectedTask.enableRegularMessages}`);
    
    // Create a test profile
    const testTaskId = `test_${Date.now()}`;
    const profileId = await createTaskProfile(testTaskId);
    
    let browser;
    let page;
    
    try {
        // Launch browser with profile
        browser = await launchBrowser(profileId, selectedTask.headless);
        
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to channel
        console.log('📡 Navigating to Discord channel...');
        await page.goto(selectedTask.channelUrl, { 
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'], 
            timeout: 60000 
        });
        
        // Wait a bit for page to fully load
        console.log('⏳ Waiting for page to load...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check for login screen
        const loginContainer = await page.$('div[class*="mainLoginContainer"]');
        if (loginContainer) {
            console.log('⚠️  Login screen detected! Please log in manually and press Enter when ready...');
            await new Promise(resolve => {
                process.stdin.once('data', resolve);
            });
        }
        
        // Scrape messages
        console.log('🔍 Scraping messages...');
        const scrapedMessages = await ScrapeData(page, selectedTask.enableRegularMessages);
        
        if (!scrapedMessages || scrapedMessages.length === 0) {
            console.log('❌ No messages found!');
            return;
        }
        
        console.log(`✅ Found ${scrapedMessages.length} messages`);
        
        // Process each message
        for (let i = 0; i < scrapedMessages.length; i++) {
            const messageData = scrapedMessages[i];
            const { messageId, regularMessage, embedArray } = messageData;
            
            console.log(`\n📝 Processing message ${i + 1}/${scrapedMessages.length} (ID: ${messageId})`);
            
            if (embedArray && embedArray.length > 0) {
                console.log(`📋 Found ${embedArray.length} embeds`);
                console.log('🔧 Building webhook JSON for embeds...');
                
                // Use the first webhook URL from the task
                const webhookUrl = selectedTask.webhookInfo?.[0]?.webhook_url || 'https://discord.com/api/webhooks/test/test';
                
                // Build the webhook payload (this will create the JSON structure)
                const { Webhook, MessageBuilder } = require('discord-webhook-node');
                const hook = new Webhook(webhookUrl);
                const embedMessage = new MessageBuilder();
                embedMessage.setColor('#FF5733');
                hook.setAvatar('https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                hook.setUsername('Dollar Shoe Club');
                
                // Process embeds
                embedArray.forEach((embed, index) => {
                    const { title, value, url } = embed;
                    
                    switch (title.toLowerCase()) {
                        case 'author':
                            embedMessage.setAuthor(value, 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                            break;
                        case 'description':
                            embedMessage.setDescription(value);
                            break;
                        case 'footer':
                            embedMessage.setFooter('Dollar Shoe Club Monitoring', 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                            break;
                        case 'title':
                            embedMessage.setTitle(value);
                            if (url) {
                                embedMessage.setURL(url);
                            }
                            break;
                        case 'thumbnail':
                            embedMessage.setThumbnail(value);
                            break;
                        case 'image':
                            embedMessage.setImage(value);
                            break;
                        default:
                            embedMessage.addField(title, value, false);
                            break;
                    }
                });
                
                // Always set the footer and timestamp
                embedMessage.setFooter('Dollar Shoe Club Monitoring', 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg');
                embedMessage.setTimestamp();
                
                // Get the webhook payload
                const webhookPayload = embedMessage.getJSON();
                
                console.log('\n🎯 WEBHOOK JSON OUTPUT:');
                console.log('='.repeat(50));
                console.log(JSON.stringify(webhookPayload, null, 2));
                console.log('='.repeat(50));
                
                // Also show the raw embed data
                console.log('\n📊 RAW EMBED DATA:');
                console.log('-'.repeat(30));
                console.log(JSON.stringify(embedArray, null, 2));
                console.log('-'.repeat(30));
                
                break; // Only process the first message with embeds
                
            } else if (regularMessage) {
                console.log('💬 Found regular message');
                console.log('🔧 Building webhook JSON for regular message...');
                
                // Create webhook payload for regular message
                const webhookPayload = {
                    content: regularMessage.content.substring(0, 2000),
                    username: regularMessage.username?.substring(0, 80) || 'Unknown User',
                    avatar_url: regularMessage.avatar_url || 'https://pbs.twimg.com/profile_images/1563967215438790656/y8DLGAKv_400x400.jpg'
                };
                
                console.log('\n🎯 WEBHOOK JSON OUTPUT:');
                console.log('='.repeat(50));
                console.log(JSON.stringify(webhookPayload, null, 2));
                console.log('='.repeat(50));
                
                // Also show the raw message data
                console.log('\n📊 RAW MESSAGE DATA:');
                console.log('-'.repeat(30));
                console.log(JSON.stringify(regularMessage, null, 2));
                console.log('-'.repeat(30));
                
                break; // Only process the first regular message
            }
        }
        
    } catch (error) {
        console.error('❌ Error during webhook test:', error);
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            await browser.close();
        }
        
        // Clean up the test profile
        try {
            const profilePath = path.join(__dirname, profileId);
            if (fs.existsSync(profilePath)) {
                await fs.remove(profilePath);
                console.log(`🧹 Cleaned up test profile: ${profileId}`);
            }
        } catch (error) {
            console.error(`⚠️  Error cleaning up profile ${profileId}:`, error);
        }
    }
}

// Get command line arguments
const args = process.argv.slice(2);
const taskIdOrIndex = args[0] || null;

// Run the test
quickWebhookTest(taskIdOrIndex).then(() => {
    console.log('\n✅ Webhook test completed!');
    process.exit(0);
}).catch(error => {
    console.error('\n❌ Webhook test failed:', error);
    process.exit(1);
}); 