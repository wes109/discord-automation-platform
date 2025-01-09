// monitor.js
const express = require('express');
const app = express();
const port = 3000; // Choose a port for your server

// Increase Node.js heap memory limit to 1GB (you can adjust this value as needed)
process.env.NODE_OPTIONS = "--max-old-space-size=1024"; // 1GB in MB

// Store pinged URLs and timestamps
const pingedURLs = new Map();

// Middleware to log incoming pings
app.use((req, res, next) => {
  const { discordUrl } = req.query;
  if (discordUrl) {
    // Store the timestamp when the ping was received
    pingedURLs.set(discordUrl, Date.now());
  }
  next();
});

// Function to generate formatted current time
function getCurrentTime() {
  const now = new Date();
  const formattedTime = now.toISOString().replace('T', ' ').slice(0, 19);
  return formattedTime;
}

// Route to list recent pings
app.get('/monitor-list', (req, res) => {
  const currentTime = Date.now();
  const recentPings = Array.from(pingedURLs.entries()).filter(
    ([_, timestamp]) => currentTime - timestamp < 15000
  );

  // Generate an HTML table with improved CSS styling and a renamed page title
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Monitor List</title>
      <style>
        /* Improved CSS styling */
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
          text-align: center; /* Center align the content */
        }
        // ... (rest of your CSS styles)
      </style>
    </head>
    <body>
      <h1>Monitor List</h1>
      <!-- Display Last Updated text with current time -->
      <p class="last-updated">Last Updated: ${getCurrentTime()}</p>
      <table>
        <tr>
          <th>Discord Channel</th>
        </tr>
  `;

  recentPings.forEach(([url]) => {
    html += `<tr><td>${url}</td></tr>`;
  });

  html += `
      </table>
    </body>
    </html>
  `;

  res.send(html);
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
