const { spawn } = require('child_process');

// Define the number of Puppeteer instances you want to run
const numberOfInstances = 4; // Adjust as needed

// Function to launch a Puppeteer script in a child process
function launchPuppeteerInstance(instanceNumber) {
  const childProcess = spawn('node', ['main.js', `--instance=${instanceNumber}`], {
    stdio: 'inherit', // Redirect child process's stdout and stderr to the parent process
  });

  childProcess.on('close', (code) => {
    console.log(`Puppeteer instance ${instanceNumber} exited with code ${code}`);
  });
}

// Launch multiple Puppeteer instances
for (let i = 1; i <= numberOfInstances; i++) {
  launchPuppeteerInstance(i);
}