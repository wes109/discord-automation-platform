# Dollar Shoe Club - Portfolio Showcase

This is a showcase version of the Dollar Shoe Club Discord monitoring system, designed for portfolio and job application purposes.

## Overview

This project demonstrates a sophisticated Discord channel monitoring system that:
- Scrapes Discord messages using Puppeteer
- Processes embed messages and regular text messages
- Forwards messages to multiple Discord channels via webhooks
- Integrates with n8n workflows for automated tweeting
- Manages multiple monitoring tasks with PM2
- Includes a web dashboard for task management

## Architecture

### Core Components

- **main.js**: Main monitoring loop and task orchestration
- **scrape.js**: Discord message scraping (proprietary implementation removed)
- **webhook.js**: Discord webhook message building (proprietary implementation removed)
- **discord_manager.js**: Discord bot client management (proprietary implementation removed)
- **server.js**: Express server with REST API for task management
- **utils/**: Utility modules for keyword matching, logging, etc.

### Key Features

1. **Multi-Channel Monitoring**: Monitor multiple Discord channels simultaneously
2. **Message Processing**: Extract and process both embed and regular messages
3. **Webhook Forwarding**: Forward messages to multiple target channels
4. **Keyword Filtering**: Filter messages based on configurable keyword groups
5. **Automated Tweeting**: Integration with n8n workflows for social media posting
6. **Task Management**: Web-based dashboard for starting/stopping monitoring tasks
7. **Rate Limiting**: Built-in rate limit handling for Discord API

## Protected Files

The following files contain proprietary implementations and have been redacted:
- `scrape.js` - Discord scraping logic
- `webhook.js` - Webhook building logic
- `discord_manager.js` - Discord bot management

Sensitive configuration files are excluded:
- `config.json`, `config2.json` - API keys and webhook URLs
- `cookies.json` - Authentication cookies
- `*.token` files - API tokens
- `auth-token.txt` - Authentication tokens

## Technology Stack

- **Node.js**: Runtime environment
- **Puppeteer**: Browser automation for Discord scraping
- **Discord.js**: Discord bot API integration
- **Express**: Web server framework
- **PM2**: Process management
- **n8n**: Workflow automation
- **Discord Webhooks**: Message forwarding

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your Discord channels in `config.json` (not included in showcase)

3. Start the server:
```bash
node server.js
```

4. Access the dashboard at `http://localhost:3000`

## License

This code is provided for portfolio/portfolio purposes only. Proprietary implementations have been removed to protect intellectual property.

## Contact

For inquiries about the full implementation, please contact the repository owner.

