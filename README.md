# DollarShoeClub

A sophisticated e-commerce monitoring and automation system built with Node.js, focusing on real-time product tracking and automated notifications.

## 🚀 Features

### Real-Time Product Monitoring
- Advanced web scraping implementation using Puppeteer
- Real-time monitoring of product availability and price changes
- Intelligent detection of product restocks and new releases
- Automated session management and browser optimization

### Smart Link Management
- Automated affiliate link generation and management
- Integration with multiple affiliate networks
- Dynamic URL processing and transformation
- Intelligent link validation and error handling

### Notification System
- Real-time Discord webhook integration
- Rich embed message formatting
- Customizable notification templates
- Automated retry mechanisms with exponential backoff

### Performance Optimization
- Singleton pattern implementation for resource management
- Efficient browser instance handling
- Memory optimization for long-running processes
- Robust error handling and recovery mechanisms

## 🛠 Technical Stack

- **Runtime Environment**: Node.js
- **Browser Automation**: Puppeteer
- **Networking**: Native fetch API
- **Error Handling**: Custom error management system
- **Configuration**: JSON-based configuration
- **Notification**: Discord Webhook API

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/wes109/DollarShoeClub.git
```

2. Install dependencies:
```bash
cd DollarShoeClub
npm install
```

3. Configure the application:
- Set up your `config.json` file with:
  - Discord channel URLs to monitor
  - Webhook URLs for notifications
  - Browser profile settings
  - Affiliate network credentials

## 🚦 Usage

1. Ensure your `config.json` is properly configured
2. Start the monitoring system:
```bash
node main.js
```

The application will automatically:
- Load configuration from `config.json`
- Initialize browser sessions
- Begin monitoring configured channels
- Send notifications through specified webhooks

## 🏗 Architecture

### Core Components

1. **Task Manager**
   - Handles task scheduling and execution
   - Manages concurrent operations
   - Implements retry logic

2. **Browser Manager**
   - Singleton pattern implementation
   - Manages browser sessions
   - Handles connection pooling

3. **Link Processor**
   - URL transformation and validation
   - Affiliate link generation
   - Link status monitoring

4. **Notification Service**
   - Message formatting
   - Webhook management
   - Delivery confirmation

## 💡 Best Practices

- Implements singleton pattern for resource optimization
- Uses async/await for clean asynchronous code
- Includes comprehensive error handling
- Features detailed logging for debugging
- Follows modular design principles

## 🔒 Security

- Secure credential management
- Rate limiting implementation
- Session security measures
- Error message sanitization

## 🤝 Contributing

While this is primarily a personal project, suggestions and feedback are welcome. Please feel free to:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🎯 Future Enhancements

- Enhanced monitoring capabilities
- Additional platform integrations
- Advanced analytics features
- Performance optimization improvements

## 👨‍💻 Author

Wesley Connell
- GitHub: [@wes109](https://github.com/wes109)

# Discord Monitor Dashboard

A web-based dashboard for monitoring Discord channels and forwarding messages to specified webhook destinations.

## Features

- Monitor multiple Discord channels simultaneously
- Forward messages to multiple target channels via webhooks
- User-friendly web interface for task management
- Support for headless operation
- Configurable webhook destinations
- Task persistence across server restarts
- Real-time task logs and status monitoring

## Prerequisites

- Node.js (v14 or higher)
- Chrome/Chromium browser
- Discord webhook URLs for target channels

## Installation

1. Clone the repository:
```bash
git clone https://github.com/wes109/DollarShoeClub.git
cd DollarShoeClub
```

2. Install dependencies:
```bash
npm install
```

3. Create a config.json file in the root directory:
```json
{
  "discord": {
    "channels": []
  },
  "monitoring": {
    "channels": []
  }
}
```

## Usage

1. Start the server:
```bash
node server.js
```

2. Open your browser and navigate to `http://localhost:3001`

3. Configure Discord webhooks:
   - Click on the "Configuration" tab
   - Add webhook URLs for your target channels

4. Create monitoring tasks:
   - Click "New Task" button
   - Enter the Discord channel URL to monitor
   - Select target channels for message forwarding
   - Choose between GUI or headless mode
   - Start the task

## Configuration

### Discord Webhooks
- Each webhook requires a unique name and webhook URL
- Optional labels can be added for better organization
- Webhooks can be edited or deleted through the UI

### Monitoring Tasks
- Tasks can be started, stopped, and saved
- Each task can forward messages to multiple target channels
- Task settings and status are persisted across server restarts

## License

MIT License - See LICENSE file for details 