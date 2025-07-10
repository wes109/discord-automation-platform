const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const { exec, execSync } = require('child_process');
const bodyParser = require('body-parser');
const cors = require('cors');
const config = require('./config.json');
const MavelyManager = require('./mavely_manager');

// Cron job configuration
// REMOVE const CRON_SCHEDULE = "*/1 * * * *"; // Default: every 5 minutes
// Other common options:
// "0 */12 * * *" - every 12 hours
// "0 */1 * * *" - every hour
// "0 */2 * * *" - every 2 hours
// "0 */4 * * *" - every 4 hours
// "0 */6 * * *" - every 6 hours
// "0 */8 * * *" - every 8 hours
// "0 */24 * * *" - every 24 hours

// Initialize Express app
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Store active monitoring tasks with process group information
const activeTasks = new Map();
const taskLogs = new Map();
const MAX_LOG_ENTRIES = 1000;
const TASKS_SETTINGS_FILE = path.join(__dirname, 'task_settings.json');
const SAVED_TASKS_FILE = path.join(__dirname, 'saved_tasks.json');

// Track tasks that are in the process of being stopped
const stoppingTasks = new Set();

// Mavely Manager Instance and Status
let mavelyManagerInstance = null;
let mavelyManagerStatus = 'stopped'; // 'stopped', 'initializing', 'running', 'stopping', 'error'
let mavelyLastError = null;

// Tweet Processor Status
let tweetProcessorStatus = 'stopped'; // 'stopped', 'initializing', 'running', 'stopping', 'error'
let tweetProcessorLastError = null;

// Load saved tasks on server start
function loadSavedTasks() {
  try {
    if (!fs.existsSync(SAVED_TASKS_FILE)) {
      fs.writeJsonSync(SAVED_TASKS_FILE, [], { spaces: 2 });
      return [];
    }
    return fs.readJsonSync(SAVED_TASKS_FILE);
  } catch (error) {
    console.error('Error loading saved tasks:', error);
    return [];
  }
}

// Function to read saved tasks
function readSavedTasks() {
  try {
    if (!fs.existsSync(SAVED_TASKS_FILE)) {
      fs.writeJsonSync(SAVED_TASKS_FILE, [], { spaces: 2 });
      return [];
    }
    return fs.readJsonSync(SAVED_TASKS_FILE);
  } catch (error) {
    console.error('Error reading saved tasks:', error);
    return [];
  }
}

// Function to write saved tasks
function writeSavedTasks(tasks) {
  try {
    fs.writeJsonSync(SAVED_TASKS_FILE, tasks, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Error writing saved tasks:', error);
    return false;
  }
}

// Save task to persistent storage
function saveTask(taskInfo) {
  try {
    const savedTasks = loadSavedTasks();
    
    // Ensure we preserve important fields like profileId
    const taskToSave = {
      taskId: taskInfo.taskId,
      label: taskInfo.label,
      channelUrl: taskInfo.channelUrl,
      targetChannels: taskInfo.targetChannels,
      webhookInfo: taskInfo.webhookInfo,
      settings: {
        ...taskInfo.settings,
        // Ensure headless setting is preserved
        headless: taskInfo.settings?.headless === true
      },
      // Preserve the profile ID at the top level too if it exists
      profileId: taskInfo.settings?.profileId,
      createdTime: taskInfo.createdTime || new Date().toISOString()
    };
    
    // Make sure settings has the profileId
    if (taskInfo.settings?.profileId) {
      taskToSave.settings.profileId = taskInfo.settings.profileId;
    }
    
    console.log(`[Task Manager] Saving task ${taskInfo.taskId} with profile ID: ${taskToSave.settings.profileId || 'none'}`);
    
    // Remove any existing task with the same ID
    const updatedTasks = savedTasks.filter(t => t.taskId !== taskInfo.taskId);
    updatedTasks.push(taskToSave);
    
    fs.writeJsonSync(SAVED_TASKS_FILE, updatedTasks, { spaces: 2 });
    
    // Also update task settings
    if (taskToSave.settings) {
      writeTaskSettings(taskInfo.taskId, taskToSave.settings);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving task:', error);
    return false;
  }
}

// Function to read task settings
function readTaskSettings() {
  try {
    if (fs.existsSync(TASKS_SETTINGS_FILE)) {
      return fs.readJsonSync(TASKS_SETTINGS_FILE);
    }
    return {};
  } catch (error) {
    console.error('Error reading task settings:', error);
    return {};
  }
}

// Function to write task settings
function writeTaskSettings(taskId, settings) {
  try {
    const allSettings = readTaskSettings();
    allSettings[taskId] = settings;
    fs.writeJsonSync(TASKS_SETTINGS_FILE, allSettings, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Error writing task settings:', error);
    return false;
  }
}

// Function to delete task settings
function deleteTaskSettings(taskId) {
  try {
    const allSettings = readTaskSettings();
    if (allSettings[taskId]) {
      delete allSettings[taskId];
      fs.writeJsonSync(TASKS_SETTINGS_FILE, allSettings, { spaces: 2 });
    }
    return true;
  } catch (error) {
    console.error('Error deleting task settings:', error);
    return false;
  }
}

// Function to read config
function readConfig() {
  const defaultConfig = {
    discord: { channels: [] },
    monitoring: {
      channels: [],
      cronSchedule: "*/60 * * * *" // Default PM2 cron schedule (every 5 mins)
    }
  };
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
       console.warn('config.json not found, creating with defaults.');
       fs.writeJsonSync(configPath, defaultConfig, { spaces: 2 });
       return defaultConfig;
    }
    let config = fs.readJsonSync(configPath);
    // Ensure monitoring object and cron schedule exist
    config.monitoring = config.monitoring || { channels: [], cronSchedule: defaultConfig.monitoring.cronSchedule };
    config.monitoring.cronSchedule = config.monitoring.cronSchedule || defaultConfig.monitoring.cronSchedule;
    config.monitoring.channels = config.monitoring.channels || []; // Ensure channels array exists
    config.discord = config.discord || { channels: [] }; // Ensure discord object exists
    config.discord.channels = config.discord.channels || []; // Ensure channels array exists

    return config;
  } catch (error) {
    console.error('Error reading config, returning defaults:', error);
    return defaultConfig;
  }
}

// Function to write config
function writeConfig(config) {
  try {
    fs.writeJsonSync(path.join(__dirname, 'config.json'), config, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Error writing config:', error);
    return false;
  }
}

// Function to generate a unique profile ID
function generateProfileId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `profile_${timestamp}_${random}`;
}

// Function to copy base profile for a task
async function createTaskProfile(taskId) {
  const baseProfilePath = path.join(__dirname, 'my-profile');
  const profileId = generateProfileId();
  const profilePath = path.join(__dirname, profileId);
  
  try {
    // Check if base profile exists
    if (!fs.existsSync(baseProfilePath)) {
      throw new Error('Base profile does not exist. Please generate profiles first.');
    }
    
    // Copy base profile to new profile directory
    await fs.copy(baseProfilePath, profilePath);
    return profileId;
  } catch (error) {
    console.error(`Error creating profile for task ${taskId}:`, error);
    throw error;
  }
}

// Function to create a task without starting it
function createTask(channelUrl, targetChannels, taskSettings = {}) {
  const taskId = `task_${Date.now()}`;
  
  // Get webhook information for target channels
  const webhookInfo = [];
  const config = readConfig();
  
  for (const targetChannel of targetChannels) {
    const channelConfig = config.discord.channels.find(ch => ch.name === targetChannel);
    if (channelConfig) {
      webhookInfo.push({
        name: channelConfig.name,
        label: channelConfig.label || channelConfig.name,
        webhook_url: channelConfig.webhook_url
      });
    }
  }
  
  // Ensure headless is a boolean
  const isHeadless = taskSettings.headless === true;
  
  // Create task settings
  const settings = {
    label: taskSettings.label || channelUrl.split('/').pop(),
    channelUrl,
    targetChannels,
    webhookInfo,
    enableUrlUnshortening: taskSettings.enableUrlUnshortening || false,
    headless: isHeadless,
    enableRegularMessages: taskSettings.enableRegularMessages === true,
    createdTime: new Date().toISOString(),
    isTestingModule: taskSettings.isTestingModule === true,
    enableAffiliateLinks: taskSettings.enableAffiliateLinks === true,
    // Add tweet settings
    enableTweeting: taskSettings.enableTweeting === true,
    tweetKeywords: taskSettings.tweetKeywords || ''
  };
  
  // Create the task object with headless state at all levels
  const taskToSave = {
    taskId,
    ...settings,
    headless: isHeadless, // Add at top level
    enableRegularMessages: settings.enableRegularMessages,
    isHeadless, // Add isHeadless flag
    enableAffiliateLinks: settings.enableAffiliateLinks,
    enableTweeting: settings.enableTweeting,
    tweetKeywords: settings.tweetKeywords,
    settings: {
      ...settings,
      headless: isHeadless, // Ensure it's in settings
      enableRegularMessages: settings.enableRegularMessages, // And here
      isTestingModule: settings.isTestingModule,
      enableAffiliateLinks: settings.enableAffiliateLinks,
      enableTweeting: settings.enableTweeting,
      tweetKeywords: settings.tweetKeywords
    }
  };
  
  // Save to saved tasks
  const savedTasks = readSavedTasks();
  savedTasks.push(taskToSave);
  writeSavedTasks(savedTasks);
  
  return taskToSave;
}

// Function to delete a saved task
function deleteSavedTask(taskId) {
  try {
    // Get the task before deleting it to access its profile ID
    const savedTasks = readSavedTasks();
    const taskToDelete = savedTasks.find(task => task.taskId === taskId);
    
    // Delete the task from saved tasks
    const updatedTasks = savedTasks.filter(task => task.taskId !== taskId);
    writeSavedTasks(updatedTasks);
    
    // Delete task settings
    deleteTaskSettings(taskId);
    
    // Delete the profile folder if it exists
    if (taskToDelete && taskToDelete.settings && taskToDelete.settings.profileId) {
      const profilePath = path.join(__dirname, taskToDelete.settings.profileId);
      console.log(`[Task Manager] Cleaning up profile directory for deleted task: ${profilePath}`);
      try {
        fs.removeSync(profilePath);
        console.log(`[Task Manager] Profile directory removed successfully for deleted task`);
      } catch (profileError) {
        console.error(`[Task Manager] Error removing profile directory for deleted task:`, profileError);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting saved task:', error);
    return false;
  }
}

// Replace the entire startMonitoringTask function with the PM2 version
async function startMonitoringTask(channelUrl, targetChannels, taskSettings = {}) {
  const taskId = `task_${Date.now()}`;
  // PM2 process name - must be unique and simple
  const pm2_task_id = `monitor_${taskId}`;
  
  console.log(`[Task Manager] Starting PM2 task ${pm2_task_id} with settings:`, taskSettings);
  
  // Initialize log for this task (optional, PM2 handles logs too)
  taskLogs.set(taskId, [{
    timestamp: new Date(),
    type: 'info',
    message: `Requesting PM2 start for task ${pm2_task_id} with settings: ${JSON.stringify({
      channelUrl,
      targetChannels,
      headless: taskSettings.headless === true,
      label: taskSettings.label
    }, null, 2)}`
  }]);
  
  // Get webhook info (keep this)
  const webhookInfo = [];
  const config = readConfig();
  for (const targetChannel of targetChannels) {
    const channelConfig = config.discord.channels.find(ch => ch.name === targetChannel);
    if (channelConfig) {
      webhookInfo.push({
        name: channelConfig.name,
        label: channelConfig.label || channelConfig.name,
        webhook_url: channelConfig.webhook_url
      });
    }
  }
  
  // Create profile (keep this)
  let profileId;
  try {
    profileId = await createTaskProfile(taskId);
  } catch (error) {
    console.error(`Failed to create profile for task ${taskId}:`, error);
    return { success: false, message: 'Failed to create Chrome profile' };
  }
  
  const isHeadless = taskSettings.headless === true;
  const label = taskSettings.label || channelUrl.split('/').pop();
  const isTestingModule = taskSettings.isTestingModule === true; // Read testing mode
  
  // Save initial task settings (keep this)
  const settings = {
    label: label,
    channelUrl,
    targetChannels,
    webhookInfo,
    enableUrlUnshortening: taskSettings.enableUrlUnshortening || false,
    headless: isHeadless,
    enableRegularMessages: taskSettings.enableRegularMessages === true,
    startTime: new Date().toISOString(),
    profileId,
    isTestingModule, // Save testing mode to settings
    // Store the pm2 id in settings as well for persistence
    pm2_task_id,
    enableAffiliateLinks: taskSettings.enableAffiliateLinks === true,
    enableTweeting: taskSettings.enableTweeting === true, // <-- Save tweet setting
    tweetKeywords: taskSettings.tweetKeywords || '' // <-- Save tweet keywords
  };
  writeTaskSettings(taskId, settings);
  

  // --- Build PM2 Command ---
  const mainScriptPath = path.join(__dirname, 'main.js'); // Ensure absolute path

  // Build arguments for main.js (passed after --)
  const scriptArgs = [
    '--channel', `"${channelUrl}"`, // Quote URLs just in case
    '--targets', `"${targetChannels.join(',')}"`,
    '--task-id', taskId, // Pass the original taskId for logging within main.js if needed
    '--profile', profileId
  ];
  if (settings.enableUrlUnshortening) {
    scriptArgs.push('--enable-url-unshortening');
  }
  if (isHeadless === true) {
    scriptArgs.push('--headless');
  }
  if (settings.enableRegularMessages === true) {
    scriptArgs.push('--enable-regular-messages');
  }
  if (isTestingModule === true) { // Pass flag to main.js
    scriptArgs.push('--testing-mode');
  }
  if (settings.enableAffiliateLinks === true) {
    scriptArgs.push('--enable-affiliate-links');
  }
  if (settings.enableTweeting === true) {
    scriptArgs.push('--enable-tweeting');
  }
  if (Array.isArray(settings.tweetKeywords) && settings.tweetKeywords.length > 0) {
    scriptArgs.push('--tweet-keywords', `"${settings.tweetKeywords.join(',')}"`);
  }

  // --- Set Cron Schedule to Every 3 Days --- 
  const cron_schedule = '0 0 */3 * *'; // Set to run at 00:00 every 3 days
  console.log(`[Task Manager] Using fixed cron schedule for ${pm2_task_id}: "${cron_schedule}"`);
  // --- End Cron Schedule ---

  // Construct the full PM2 command
  // Remove --no-autorestart to allow PM2 to restart on crash/exit
  const pm2Command = `pm2 start ${mainScriptPath} --name "${pm2_task_id}" --cron "${cron_schedule}" -- ${scriptArgs.join(' ')}`;

  console.log(`[Task Manager] Executing PM2 command: ${pm2Command}`);

  // --- Execute PM2 Command ---
  return new Promise((resolve) => {
    exec(pm2Command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Task Manager] PM2 failed to start task ${pm2_task_id}:`, error);
        console.error(`[Task Manager] PM2 stderr:`, stderr);
        // Add error log
    const logs = taskLogs.get(taskId) || [];
        logs.push({ timestamp: new Date(), type: 'error', message: `PM2 failed to start: ${error.message}. Stderr: ${stderr}` });
    taskLogs.set(taskId, logs);
        // Clean up profile if start failed
         fs.remove(path.join(__dirname, profileId)).catch(err => console.error(`Error cleaning up profile ${profileId} after failed start:`, err));
        resolve({ success: false, message: `PM2 failed to start: ${error.message}` });
        return;
      }

      console.log(`[Task Manager] PM2 stdout for starting ${pm2_task_id}:`, stdout);
      if (stderr) { // Log stderr even if no error object
         console.warn(`[Task Manager] PM2 stderr on start ${pm2_task_id}:`, stderr);
      }

      // Add success log
       const logs = taskLogs.get(taskId) || [];
       logs.push({ timestamp: new Date(), type: 'info', message: `PM2 successfully started task ${pm2_task_id}` });
    taskLogs.set(taskId, logs);
  
      // Store task information locally for UI
      const taskInfo = {
    taskId,
        pm2_task_id, // Store the PM2 name
    channelUrl,
    targetChannels,
    webhookInfo,
    label: settings.label,
        settings: { // Store settings including profileId and pm2_task_id
      ...settings,
           headless: isHeadless
    },
    startTime: new Date(),
        status: 'running', // Assume running initially
        isHeadless,
        enableTweeting: settings.enableTweeting, // <-- Add tweet fields
        tweetKeywords: settings.tweetKeywords
      };
      activeTasks.set(taskId, taskInfo);

      // Persist the task info so it can potentially be reloaded if server.js restarts
      // Note: PM2 handles the actual process persistence
      saveTask(taskInfo); // Pass the full taskInfo including pm2_task_id

      resolve({ success: true, taskId });
    });
  });
}

// Function to stop a monitoring task using PM2
async function stopMonitoringTask(taskId) {
  console.log(`[Task Manager] ========== Requesting PM2 stop/delete for task ${taskId} ==========`);

  let taskInfo = activeTasks.get(taskId);
  let pm2_task_id_to_stop;

  if (!taskInfo) {
    console.log(`[Task Manager] Task not found locally: ${taskId}. Checking saved tasks.`);
    // Try to find pm2_task_id from saved tasks if possible
    const savedTaskSettings = readTaskSettings()[taskId];
    pm2_task_id_to_stop = savedTaskSettings?.pm2_task_id;

    if (!pm2_task_id_to_stop) {
         // Fallback guess if not found in settings either
         pm2_task_id_to_stop = `monitor_${taskId}`;
         console.warn(`[Task Manager] PM2 task ID for ${taskId} not found in active or saved settings. Using guessed name: ${pm2_task_id_to_stop}`);
    }
     // Proceed to attempt PM2 stop/delete even if task wasn't active
  } else {
      pm2_task_id_to_stop = taskInfo.pm2_task_id; // Get the PM2 name from active task
       // Check if task is already being stopped (optional UI feedback)
  if (stoppingTasks.has(taskId)) {
        console.log(`[Task Manager] Task ${taskId} (PM2: ${pm2_task_id_to_stop}) is already being stopped.`);
    return { success: true, message: 'Task is already being stopped' };
  }
  stoppingTasks.add(taskId);
  
       // Update local status immediately for UI responsiveness
    taskInfo.status = 'stopping';
    taskInfo.endTime = new Date();
    activeTasks.set(taskId, taskInfo);
      console.log(`[Task Manager] Updated local task status to stopping for ${taskId}`);

       // Add log entry (optional)
      const logs = taskLogs.get(taskId) || [];
      logs.push({ timestamp: new Date(), type: 'info', message: `Requesting PM2 stop/delete for ${pm2_task_id_to_stop}` });
      taskLogs.set(taskId, logs);
  }


  if (!pm2_task_id_to_stop) {
      console.error(`[Task Manager] Cannot stop task ${taskId}: Could not determine PM2 task ID.`);
       if(stoppingTasks.has(taskId)) stoppingTasks.delete(taskId); // Clean up stopping state
      return { success: false, message: 'Internal error: Could not determine PM2 task ID.' };
  }

  // --- Execute PM2 Stop and Delete Commands ---
  const pm2StopCommand = `pm2 stop "${pm2_task_id_to_stop}" --silent && pm2 delete "${pm2_task_id_to_stop}" --silent`;
  console.log(`[Task Manager] Executing PM2 command: ${pm2StopCommand}`);

  return new Promise((resolve) => {
      exec(pm2StopCommand, (error, stdout, stderr) => {
          stoppingTasks.delete(taskId); // Remove from stopping set once command finishes

          const logs = taskLogs.get(taskId) || []; // Get logs if task was active

          if (error) {
              // PM2 often returns error code if process not found for delete, treat as success in cleanup
              console.warn(`[Task Manager] PM2 command for ${pm2_task_id_to_stop} finished with potential error (may be normal if already stopped/deleted):`, error.code);
              console.warn(`[Task Manager] PM2 stderr:`, stderr);
              // Update local status if task was active
              if(taskInfo) {
                  taskInfo.status = 'stopped'; // Mark as stopped even on error
                  logs.push({ timestamp: new Date(), type: 'warning', message: `PM2 stop/delete finished with code ${error.code}. Marking as stopped.` });
                  taskLogs.set(taskId, logs);
                  activeTasks.delete(taskId); // Remove from active list
              }
          } else {
               console.log(`[Task Manager] PM2 stdout for stopping/deleting ${pm2_task_id_to_stop}:`, stdout);
               if (stderr) { // Log stderr even if no error object
                   console.warn(`[Task Manager] PM2 stderr on stop/delete ${pm2_task_id_to_stop}:`, stderr);
               }
               // Update final status if task was active
              if(taskInfo) {
                   taskInfo.status = 'stopped';
                   logs.push({ timestamp: new Date(), type: 'info', message: `PM2 successfully stopped/deleted ${pm2_task_id_to_stop}` });
                   taskLogs.set(taskId, logs);
                   activeTasks.delete(taskId); // Remove from active list
              }
          }


          // Delete associated profile directory - Use settings from disk if task wasn't active
          const taskSettings = taskInfo?.settings || readTaskSettings()[taskId];
          if (taskSettings?.profileId) {
               const profilePath = path.join(__dirname, taskSettings.profileId);
               fs.remove(profilePath)
                 .then(() => console.log(`[Task Manager] Deleted profile directory: ${profilePath}`))
                 .catch(err => console.error(`[Task Manager] Error deleting profile directory ${profilePath}:`, err));
           } else {
               console.log(`[Task Manager] No profile ID found for task ${taskId}, skipping profile deletion.`);
           }

           // Also delete task settings file entry
           deleteTaskSettings(taskId);

           // Resolve success because the goal is to ensure the task is not running in PM2
           resolve({ success: true });
      });
  });
}

// Graceful shutdown function
function gracefulShutdown() {
  console.log('[Task Manager] Received shutdown signal. Attempting to stop all tasks...');

  // Stop all active tasks
  for (const [taskId, taskInfo] of activeTasks.entries()) {
    const pm2_task_id = taskInfo.pm2_task_id;
    const stopCommand = `pm2 stop "${pm2_task_id}" && pm2 delete "${pm2_task_id}"`;
    console.log(`[Task Manager] Executing PM2 command: ${stopCommand}`);

    exec(stopCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Task Manager] PM2 failed to stop task ${pm2_task_id}:`, error);
        console.error(`[Task Manager] PM2 stderr:`, stderr);
      } else {
        console.log(`[Task Manager] PM2 stdout for stopping ${pm2_task_id}:`, stdout);
        if (stderr) {
          console.warn(`[Task Manager] PM2 stderr on stop ${pm2_task_id}:`, stderr);
        }
        console.log(`[Task Manager] Successfully stopped task ${pm2_task_id}`);
      }
    });
  }

  // Exit after a short delay to allow tasks to stop
  setTimeout(() => {
    console.log('[Task Manager] All tasks stopped. Exiting...');
    process.exit(0);
  }, 5000);
}

// Handle SIGTERM and SIGINT signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Routes
app.get('/', (req, res) => {
  const config = readConfig();
  // Reload active tasks from PM2 maybe? Or rely on server memory? For now, use server memory.
  // Need a way to sync state if server.js restarts but PM2 keeps tasks running.
  // Simpler: assume server.js state is the source of truth for the UI for now.
  res.render('dashboard', { 
    config,
    activeTasks: Array.from(activeTasks.values()) // Map values directly
  });
});

// API endpoint to get all tasks
app.get('/api/tasks', (req, res) => {
  try {
    const savedTasks = readSavedTasks();
    const taskSettings = readTaskSettings();
    
    // Combine task info with settings and active status
    const tasks = savedTasks.map(task => {
      const isActive = activeTasks.has(task.taskId);
      const isStopping = stoppingTasks.has(task.taskId);
      
      // Determine task status
      let status = 'saved';
      if (isActive) {
        status = 'running';
      } else if (isStopping) {
        status = 'stopping';
      }

      return {
        ...task,
        status,
        settings: taskSettings[task.taskId] || {}
      };
    });
    
    res.json({ tasks });
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

// Get single task details
app.get('/api/tasks/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const savedTasks = readSavedTasks();
    const taskSettings = readTaskSettings();
    
    // Find the specific task
    const task = savedTasks.find(t => t.taskId === taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Combine task info with settings and active status
    const taskDetails = {
      ...task,
      ...taskSettings[taskId],  // Spread settings at top level for easier access
      isActive: activeTasks.has(taskId)
    };
    
    res.json(taskDetails);
  } catch (error) {
    console.error('Error getting task details:', error);
    res.status(500).json({ error: 'Failed to get task details' });
  }
});

// API endpoint to get task logs (fetch from PM2)
app.get('/api/tasks/:taskId/logs', (req, res) => {
  const { taskId } = req.params;

  // Find the PM2 task ID associated with our internal taskId
  const taskInfo = activeTasks.get(taskId) || readTaskSettings()[taskId];
  const pm2_task_id = taskInfo?.pm2_task_id || taskInfo?.settings?.pm2_task_id; // Check both places

  if (!pm2_task_id) {
    // If we can't find the PM2 ID, return an error or empty logs
    console.warn(`[Logs API] Could not find pm2_task_id for taskId ${taskId}`);
    return res.json({ logs: [{ timestamp: new Date(), type: 'error', message: 'Could not find PM2 task ID for this task.' }] });
  }

  // Construct the PM2 logs command
  // --lines specifies max lines
  // --nostream prevents it from waiting for more logs
  // --raw outputs only the log message without timestamp/prefix from PM2
  const pm2LogsCommand = `pm2 logs ${pm2_task_id} --lines ${MAX_LOG_ENTRIES} --nostream --raw`;
  console.log(`[Logs API] Executing: ${pm2LogsCommand}`);

  exec(pm2LogsCommand, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => { // Added maxBuffer
    if (error) {
        // PM2 might return error code 1 if process not found, handle this gracefully
        console.error(`[Logs API] Error fetching PM2 logs for ${pm2_task_id}: ${error.message}`);
        console.error(`[Logs API] PM2 stderr: ${stderr}`);
        // Try to provide a meaningful error, check if it was just not found
        const errorMessage = stderr.includes('process or namespace not found') 
                             ? `PM2 process ${pm2_task_id} not found. It might be stopped or deleted.`
                             : `Failed to fetch PM2 logs: ${stderr || error.message}`;
        return res.status(500).json({ logs: [{ timestamp: new Date(), type: 'error', message: errorMessage }] });
    }

    // Parse raw logs into the expected format
    // Each line from stdout is a log entry. We'll add a timestamp.
    const parsedLogs = stdout
        .trim()
        .split('\n')
        .filter(line => line.trim() !== '') // Remove empty lines
        .map(line => {
            // Attempt to determine log type (basic heuristic)
            let type = 'info';
            if (line.includes('[ERROR]') || line.includes('Error:')) type = 'error';
            else if (line.includes('[WARNING]')) type = 'warning';
            else if (line.includes('[DEBUG]')) type = 'debug';
            // You might need more sophisticated parsing if main.js logs JSON
            return { timestamp: new Date(), type: type, message: line }; 
        });
        
    // Reverse logs so newest appear first in modal if desired by UI (or sort by timestamp)
    // parsedLogs.reverse(); 

    res.json({ logs: parsedLogs });
  });
});

// API endpoint to create a task without starting it
app.post('/api/tasks/create', (req, res) => {
  const { channelUrl, targetChannels, enableUrlUnshortening, label, headless, enableRegularMessages, isTestingModule, enableAffiliateLinks, enableTweeting, tweetKeywords } = req.body;
  
  console.log('[DEBUG] Creating task with settings:', {
    channelUrl, targetChannels, enableUrlUnshortening, label, headless, enableRegularMessages, isTestingModule, enableAffiliateLinks, enableTweeting, tweetKeywords
  });
  
  if (!channelUrl || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }
  
  const taskSettings = {
    enableUrlUnshortening: enableUrlUnshortening || false,
    label: label || '',
    headless: headless === true, // Ensure boolean conversion
    enableRegularMessages: enableRegularMessages === true, // <-- Ensure boolean conversion
    isTestingModule: isTestingModule === true,
    enableAffiliateLinks: enableAffiliateLinks === true,
    enableTweeting: enableTweeting === true, // <-- Add tweet setting
    tweetKeywords: tweetKeywords || '' // <-- Add tweet keywords
  };
  
  const result = createTask(channelUrl, targetChannels, taskSettings);
  res.json(result);
});

// API endpoint to start a task
app.post('/api/tasks/start', async (req, res) => {
  const { channelUrl, targetChannels, enableUrlUnshortening, label, headless, enableRegularMessages, enableAffiliateLinks, enableTweeting, tweetKeywords } = req.body;
  
  console.log('[DEBUG] /api/tasks/start received request with headless:', headless);
  
  if (!channelUrl || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }
  
  const taskSettings = {
    enableUrlUnshortening: enableUrlUnshortening || false,
    label: label || '',
    headless: headless === true, // Strict boolean comparison
    enableRegularMessages: enableRegularMessages === true, // <-- Get from request
    enableAffiliateLinks: enableAffiliateLinks === true,
    enableTweeting: enableTweeting === true, // <-- Add tweet setting
    tweetKeywords: tweetKeywords || '' // <-- Add tweet keywords
  };
  
  console.log('[DEBUG] Starting task with settings:', {
    ...taskSettings,
    channelUrl,
    targetChannels,
    headless: taskSettings.headless // Log the actual boolean value
  });
  
  const result = await startMonitoringTask(channelUrl, targetChannels, taskSettings);
  res.json(result);
});

// API endpoint to start a saved task
app.post('/api/tasks/:taskId/start', async (req, res) => {
  const { taskId } = req.params;
  // Get all settings from request body if provided
  const { headless, enableRegularMessages, enableAffiliateLinks, enableTweeting, tweetKeywords } = req.body || {}; 
  
  console.log('[DEBUG] Starting saved task with parameters:', { headless, enableRegularMessages, enableAffiliateLinks, enableTweeting, tweetKeywords });
  
  // Find the saved task
  const savedTasks = readSavedTasks();
  const taskToStart = savedTasks.find(task => task.taskId === taskId);
  
  if (!taskToStart) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  // Remove from saved tasks before starting 
  const updatedTasks = savedTasks.filter(task => task.taskId !== taskId);
  writeSavedTasks(updatedTasks);
  
  // Determine settings to use: prioritize request body, fallback to saved settings
  const useHeadless = headless !== undefined ? headless === true : taskToStart.settings?.headless === true;
  const useEnableRegularMessages = enableRegularMessages !== undefined 
                                   ? enableRegularMessages === true 
                                   : taskToStart.settings?.enableRegularMessages === true;
  const useEnableAffiliateLinks = enableAffiliateLinks !== undefined
                                   ? enableAffiliateLinks === true
                                   : taskToStart.settings?.enableAffiliateLinks === true;
  const useEnableTweeting = enableTweeting !== undefined
                             ? enableTweeting === true
                             : taskToStart.settings?.enableTweeting === true;
  const useTweetKeywords = tweetKeywords !== undefined
                            ? tweetKeywords
                            : taskToStart.settings?.tweetKeywords || '';
  
  console.log('[DEBUG] Using settings for task:', { useHeadless, useEnableRegularMessages, useEnableAffiliateLinks, useEnableTweeting, useTweetKeywords });
  
  // Start the task with preserved settings and determined overrides
  const result = await startMonitoringTask(
    taskToStart.channelUrl, 
    taskToStart.targetChannels, 
    {
      // Preserve other saved settings if needed, add as necessary
      enableUrlUnshortening: taskToStart.settings?.enableUrlUnshortening, // Example
      label: taskToStart.label,
      headless: useHeadless, 
      enableRegularMessages: useEnableRegularMessages, // <-- Use determined value
      isTestingModule: taskToStart.settings?.isTestingModule === true,
      enableAffiliateLinks: useEnableAffiliateLinks,
      enableTweeting: useEnableTweeting, // <-- Use determined tweet value
      tweetKeywords: useTweetKeywords // <-- Use determined tweet keywords
    }
  );

  if (!result.success) {
    // If start failed, add back to saved tasks
    updatedTasks.push(taskToStart);
    writeSavedTasks(updatedTasks);
  }

  res.json(result);
});

// API endpoint to stop a task
app.post('/api/tasks/:taskId/stop', async (req, res) => {
  const { taskId } = req.params;
  const result = await stopMonitoringTask(taskId);
  res.json(result);
});

// API endpoint to delete a saved task
app.delete('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  
  // Delete the saved task
  const success = deleteSavedTask(taskId);
  
  res.json({ success });
});

// API endpoint to update task settings
app.put('/api/tasks/:taskId/settings', (req, res) => {
  const { taskId } = req.params;
  const { channelUrl, targetChannels, headless, label, enableRegularMessages, isTestingModule, enableAffiliateLinks, enableTweeting, tweetKeywords } = req.body;
  
  console.log('[API] Updating task settings:', {
    taskId,
    channelUrl,
    targetChannels,
    headless,
    label,
    enableRegularMessages,
    isTestingModule,
    enableAffiliateLinks,
    enableTweeting,
    tweetKeywords
  });
  
  if (!channelUrl || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }
  
  // Get webhook information for target channels
  const webhookInfo = [];
  const config = readConfig();
  
  for (const targetChannel of targetChannels) {
    const channelConfig = config.discord.channels.find(ch => ch.name === targetChannel);
    if (channelConfig) {
      webhookInfo.push({
        name: channelConfig.name,
        label: channelConfig.label || channelConfig.name,
        webhook_url: channelConfig.webhook_url
      });
    }
  }
  
  // Find and update the saved task
  const savedTasks = readSavedTasks();
  const taskIndex = savedTasks.findIndex(task => task.taskId === taskId);
  
  if (taskIndex === -1) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  
  // Create updated settings object
  const updatedSettings = {
    ...savedTasks[taskIndex].settings,
    channelUrl,
    targetChannels,
    webhookInfo,
    label,
    headless: headless === true, // Ensure boolean conversion
    enableRegularMessages: enableRegularMessages === true, // <-- Store setting
    isTestingModule: isTestingModule === true, // <-- Store testing mode setting
    enableAffiliateLinks: enableAffiliateLinks === true,
    enableTweeting: enableTweeting === true, // <-- Store tweet setting
    tweetKeywords: tweetKeywords || '' // <-- Store tweet keywords
  };
  
  // Update task settings
  savedTasks[taskIndex] = {
    ...savedTasks[taskIndex],
    channelUrl,
    targetChannels,
    webhookInfo,
    label,
    settings: updatedSettings,
    enableRegularMessages: updatedSettings.enableRegularMessages, // <-- Add top-level flag
    isHeadless: headless === true, // Add top-level flag for consistency
    isTestingModule: updatedSettings.isTestingModule,
    enableAffiliateLinks: updatedSettings.enableAffiliateLinks,
    enableTweeting: updatedSettings.enableTweeting, // <-- Add top-level tweet flag
    tweetKeywords: updatedSettings.tweetKeywords // <-- Add top-level tweet keywords
  };
  
  console.log('[API] Updated task:', savedTasks[taskIndex]);
  
  // Save both to saved tasks and task settings
  const savedTasksSuccess = writeSavedTasks(savedTasks);
  const taskSettingsSuccess = writeTaskSettings(taskId, updatedSettings);
  
  if (savedTasksSuccess && taskSettingsSuccess) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, message: 'Failed to save task settings' });
  }
});

// API endpoint to get config
app.get('/api/config', (req, res) => {
  const config = readConfig();
  res.json(config);
});

// API endpoint to update the cron schedule
app.put('/api/config/cron', (req, res) => {
  const { cronSchedule } = req.body;

  if (!cronSchedule || typeof cronSchedule !== 'string' || cronSchedule.trim() === '') {
    return res.status(400).json({ success: false, message: 'Invalid cron schedule provided.' });
  }

  // Basic validation (5 or 6 parts separated by space)
  const parts = cronSchedule.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
      return res.status(400).json({ success: false, message: 'Invalid cron format (must have 5 or 6 space-separated parts).' });
  }

  try {
    const currentConfig = readConfig();
    // Ensure monitoring object exists
    currentConfig.monitoring = currentConfig.monitoring || { channels: [], cronSchedule: '' }; 
    currentConfig.monitoring.cronSchedule = cronSchedule.trim(); // Update the schedule

    const success = writeConfig(currentConfig);
    if (success) {
      console.log(`[Config] Updated PM2 Cron Schedule to: "${cronSchedule.trim()}"`);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, message: 'Failed to write updated config file.' });
    }
  } catch (error) {
    console.error('Error updating cron schedule:', error);
    res.status(500).json({ success: false, message: 'Internal server error while updating schedule.' });
  }
});

// API endpoint to update config (Keep existing one for other potential bulk updates? Or remove?)
// For now, let's keep it but note that cron schedule should be updated via the dedicated endpoint.
app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  
  if (!newConfig || !newConfig.discord || !newConfig.monitoring) {
    return res.status(400).json({ success: false, message: 'Invalid config format' });
  }
  
  const success = writeConfig(newConfig);
  res.json({ success });
});

// API endpoint to add a Discord channel
app.post('/api/config/discord/channels', (req, res) => {
  const { name, webhook_url, label } = req.body;
  
  if (!name || !webhook_url) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  const config = readConfig();
  
  // Check if channel already exists
  const existingChannelIndex = config.discord.channels.findIndex(ch => ch.name === name);
  
  if (existingChannelIndex !== -1) {
    return res.status(400).json({ success: false, message: 'Channel with this name already exists' });
  }
  
  // Add new channel
  config.discord.channels.push({
    name,
    webhook_url,
    label: label || name
  });
  
  const success = writeConfig(config);
  res.json({ success });
});

// API endpoint to update a Discord channel
app.put('/api/config/discord/channels/:name', (req, res) => {
  const { name } = req.params;
  const { webhook_url, label, newName } = req.body;
  
  if ((!webhook_url && !label && !newName) || (newName && newName.trim() === '')) {
    return res.status(400).json({ success: false, message: 'No valid fields to update' });
  }
  
  const config = readConfig();
  
  // Find channel
  const channelIndex = config.discord.channels.findIndex(ch => ch.name === name);
  
  if (channelIndex === -1) {
    return res.status(404).json({ success: false, message: 'Channel not found' });
  }
  
  // Check if new name already exists
  if (newName && newName !== name) {
    const existingChannel = config.discord.channels.find(ch => ch.name === newName);
    if (existingChannel) {
      return res.status(400).json({ success: false, message: 'Channel with this name already exists' });
    }
  }
  
  // Update channel
  if (webhook_url) config.discord.channels[channelIndex].webhook_url = webhook_url;
  if (label) config.discord.channels[channelIndex].label = label;
  if (newName) config.discord.channels[channelIndex].name = newName;
  
  const success = writeConfig(config);
  res.json({ success });
});

// API endpoint to remove a Discord channel
app.delete('/api/config/discord/channels/:name', (req, res) => {
  const { name } = req.params;
  const config = readConfig();
  
  config.discord.channels = config.discord.channels.filter(ch => ch.name !== name);
  
  const success = writeConfig(config);
  res.json({ success, config: success ? config : null });
});

// API endpoint to add a monitoring channel
app.post('/api/config/monitoring/channels', (req, res) => {
  const { url, targetChannels } = req.body;
  
  if (!url || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  const config = readConfig();
  
  // Check if channel already exists
  const existingIndex = config.monitoring.channels.findIndex(ch => ch.url === url);
  if (existingIndex >= 0) {
    config.monitoring.channels[existingIndex] = { url, targetChannels };
  } else {
    config.monitoring.channels.push({ url, targetChannels });
  }
  
  const success = writeConfig(config);
  res.json({ success, config: success ? config : null });
});

// API endpoint to remove a monitoring channel
app.delete('/api/config/monitoring/channels', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, message: 'Missing URL' });
  }
  
  const config = readConfig();
  
  config.monitoring.channels = config.monitoring.channels.filter(ch => ch.url !== url);
  
  const success = writeConfig(config);
  res.json({ success, config: success ? config : null });
});

// API endpoint to remove a monitoring channel by URL parameter
app.delete('/api/config/monitoring/channels/:url', (req, res) => {
  const url = decodeURIComponent(req.params.url);
  
  if (!url) {
    return res.status(400).json({ success: false, message: 'Missing URL' });
  }
  
  const config = readConfig();
  
  config.monitoring.channels = config.monitoring.channels.filter(ch => ch.url !== url);
  
  const success = writeConfig(config);
  res.json({ success, config: success ? config : null });
});

// API endpoint to generate Chrome profiles
app.post('/api/profiles/generate', (req, res) => {
  const { count } = req.body;
  
  if (!count || count < 1) {
    return res.status(400).json({ success: false, error: 'Invalid profile count' });
  }

  try {
    const { spawn } = require('child_process');
    const process = spawn('node', ['prepareCookies.js', count.toString()], {
      detached: true,
      stdio: 'ignore'
    });
    
    process.unref();
    res.json({ success: true });
  } catch (error) {
    console.error('Error generating profiles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to save all active tasks
app.post('/api/tasks/save-all', (req, res) => {
  try {
    // Get all active tasks
    const runningTasks = Array.from(activeTasks.entries()).map(([key, task]) => ({
      taskId: task.taskId,
      label: task.label,
      channelUrl: task.channelUrl,
      targetChannels: task.targetChannels,
      webhookInfo: task.webhookInfo,
      settings: task.settings,
      createdTime: task.startTime
    }));

    // Get existing saved tasks
    const savedTasks = readSavedTasks();

    // Filter out any running tasks that are already saved
    const newTasks = runningTasks.filter(runningTask => 
      !savedTasks.some(savedTask => savedTask.taskId === runningTask.taskId)
    );

    // Combine existing saved tasks with new ones
    const allTasks = [...savedTasks, ...newTasks];

    // Write all tasks to file
    const success = writeSavedTasks(allTasks);

    if (success) {
      res.json({ 
        success: true, 
        message: `Successfully saved ${newTasks.length} new tasks` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save tasks to file' 
      });
    }
  } catch (error) {
    console.error('Error saving all tasks:', error);
    res.status(500).json({ 
      success: false, 
      message: `Error saving tasks: ${error.message}` 
    });
  }
});

// Initialize Mavely Manager
app.post('/api/mavely/initialize', async (req, res) => {
  if (mavelyManagerStatus === 'running' || mavelyManagerStatus === 'initializing') {
    return res.status(400).json({ message: `Mavely Manager is already ${mavelyManagerStatus}.` });
  }
  mavelyManagerStatus = 'initializing';
  mavelyLastError = null;
  console.log('[Mavely API] Initializing Mavely Manager...');
  try {
    // Ensure previous instance is fully closed if it exists and errored out
    if (mavelyManagerInstance) {
        try {
            await mavelyManagerInstance.close();
        } catch (closeErr) {
            console.warn('[Mavely API] Error closing previous instance before re-init:', closeErr.message);
        }
    }
    mavelyManagerInstance = new MavelyManager();
    const success = await mavelyManagerInstance.initialize('SERVER_MAVELY');
    if (success) {
      mavelyManagerStatus = 'running';
      console.log('[Mavely API] Mavely Manager initialized successfully.');
      res.status(200).json({ message: 'Mavely Manager initialized successfully.' });
    } else {
      mavelyManagerStatus = 'error';
      mavelyLastError = mavelyManagerInstance.lastError || 'Unknown initialization error';
      console.error(`[Mavely API] Failed to initialize Mavely Manager: ${mavelyLastError}`);
      res.status(500).json({ message: 'Failed to initialize Mavely Manager.', error: mavelyLastError });
    }
  } catch (error) {
    mavelyManagerStatus = 'error';
    mavelyLastError = error.message;
    console.error('[Mavely API] Critical error during Mavely Manager initialization:', error);
    res.status(500).json({ message: 'Critical error during Mavely Manager initialization.', error: error.message });
  }
});

// Close Mavely Manager
app.post('/api/mavely/close', async (req, res) => {
  if (!mavelyManagerInstance || mavelyManagerStatus === 'stopped' || mavelyManagerStatus === 'stopping') {
    return res.status(400).json({ message: 'Mavely Manager is not running or already stopping.' });
  }
  mavelyManagerStatus = 'stopping';
  mavelyLastError = null;
  console.log('[Mavely API] Closing Mavely Manager...');
  try {
    const success = await mavelyManagerInstance.close();
    if (success) {
      mavelyManagerStatus = 'stopped';
      mavelyManagerInstance = null; // Release instance
      console.log('[Mavely API] Mavely Manager closed successfully.');
      res.status(200).json({ message: 'Mavely Manager closed successfully.' });
    } else {
      // Even if close fails, we consider it stopped but potentially uncleanly
      mavelyManagerStatus = 'error'; // Indicate an issue occurred during close
      mavelyLastError = 'Failed to close Mavely Manager cleanly.';
      mavelyManagerInstance = null; // Release instance anyway
      console.error('[Mavely API] Failed to close Mavely Manager cleanly.');
      res.status(500).json({ message: 'Failed to close Mavely Manager cleanly.' });
    }
  } catch (error) {
    mavelyManagerStatus = 'error'; // Error during close attempt
    mavelyLastError = error.message;
    mavelyManagerInstance = null; // Release instance
    console.error('[Mavely API] Critical error during Mavely Manager closing:', error);
    res.status(500).json({ message: 'Critical error during Mavely Manager closing.', error: error.message });
  }
});

// Get Mavely Manager Status
app.get('/api/mavely/status', (req, res) => {
  res.status(200).json({
    status: mavelyManagerStatus,
    lastError: mavelyLastError
  });
});

// Generate Mavely Link
app.post('/api/mavely/generate-link', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ message: 'URL is required.' });
  }
  if (!mavelyManagerInstance || mavelyManagerStatus !== 'running') {
    return res.status(409).json({ message: 'Mavely Manager is not running.' });
  }

  try {
    const mavelyLink = await mavelyManagerInstance.generateMavelyLink(url, 'SERVER_API');
    // Check if the returned link is the same as the original (indicating failure or invalid URL)
    if (mavelyLink === url) {
         // It might be an invalid URL or a generation failure that didn't throw an error
         // Check if the URL was considered valid by the manager
         if (!mavelyManagerInstance.validateUrl(url)) {
             console.log(`[Mavely API] URL rejected by validation: ${url}`);
             return res.status(400).json({ message: 'URL is not valid for Mavely affiliation.', originalUrl: url, generatedLink: null });
         } else {
             console.warn(`[Mavely API] Link generation returned original URL for valid domain: ${url}. Treating as failure.`);
             return res.status(500).json({ message: 'Failed to generate Mavely link (returned original URL).', originalUrl: url, generatedLink: null });
         }
    } else {
         console.log(`[Mavely API] Generated link for ${url}: ${mavelyLink}`);
         res.status(200).json({ message: 'Link generated successfully.', originalUrl: url, generatedLink: mavelyLink });
    }
  } catch (error) {
    console.error(`[Mavely API] Error generating Mavely link for ${url}:`, error);
    res.status(500).json({ message: 'Error generating Mavely link.', error: error.message });
  }
});

// Initialize Tweet Processor
app.post('/api/tweet-processor/initialize', async (req, res) => {
  if (tweetProcessorStatus === 'running' || tweetProcessorStatus === 'initializing') {
    return res.status(400).json({ message: `Tweet Processor is already ${tweetProcessorStatus}.` });
  }
  
  tweetProcessorStatus = 'initializing';
  tweetProcessorLastError = null;
  console.log('[Tweet API] Initializing Tweet Processor...');
  
  try {
    // Initialize n8n connection here if needed
    tweetProcessorStatus = 'running';
    console.log('[Tweet API] Tweet Processor initialized successfully.');
    res.status(200).json({ message: 'Tweet Processor initialized successfully.' });
  } catch (error) {
    tweetProcessorStatus = 'error';
    tweetProcessorLastError = error.message;
    console.error('[Tweet API] Critical error during Tweet Processor initialization:', error);
    res.status(500).json({ message: 'Critical error during Tweet Processor initialization.', error: error.message });
  }
});

// Stop Tweet Processor
app.post('/api/tweet-processor/close', async (req, res) => {
  if (tweetProcessorStatus === 'stopped' || tweetProcessorStatus === 'stopping') {
    return res.status(400).json({ message: 'Tweet Processor is not running or already stopping.' });
  }
  
  tweetProcessorStatus = 'stopping';
  tweetProcessorLastError = null;
  console.log('[Tweet API] Stopping Tweet Processor...');
  
  try {
    // Cleanup n8n connection here if needed
    tweetProcessorStatus = 'stopped';
    console.log('[Tweet API] Tweet Processor stopped successfully.');
    res.status(200).json({ message: 'Tweet Processor stopped successfully.' });
  } catch (error) {
    tweetProcessorStatus = 'error';
    tweetProcessorLastError = error.message;
    console.error('[Tweet API] Critical error during Tweet Processor stopping:', error);
    res.status(500).json({ message: 'Critical error during Tweet Processor stopping.', error: error.message });
  }
});

// Get Tweet Processor Status
app.get('/api/tweet-processor/status', (req, res) => {
  res.status(200).json({
    status: tweetProcessorStatus,
    lastError: tweetProcessorLastError
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Discord Monitor Dashboard running on http://localhost:${port}`);
  
  // Load saved tasks on server start
  const savedTasks = loadSavedTasks();
  console.log(`Loaded ${savedTasks.length} saved tasks`);
  
  // Validate saved tasks and clean up orphaned profile folders
  try {
    // Get all profile folders
    const files = fs.readdirSync(__dirname);
    const profileFolders = files.filter(file => file.startsWith('profile_'));
    console.log(`Found ${profileFolders.length} profile folders`);
    
    // Get all profile IDs from saved tasks
    const savedProfileIds = new Set();
    savedTasks.forEach(task => {
      if (task.settings && task.settings.profileId) {
        savedProfileIds.add(task.settings.profileId);
      }
    });
    
    // Clean up orphaned profile folders
    let cleanedCount = 0;
    for (const folder of profileFolders) {
      if (!savedProfileIds.has(folder)) {
        try {
          const folderPath = path.join(__dirname, folder);
          fs.removeSync(folderPath);
          console.log(`Cleaned up orphaned profile folder: ${folder}`);
          cleanedCount++;
        } catch (error) {
          console.error(`Error removing orphaned profile folder ${folder}:`, error);
        }
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} orphaned profile folders`);
    }
  } catch (error) {
    console.error('Error cleaning up profile folders:', error);
  }
  
  // Initialize task logs for saved tasks
  savedTasks.forEach(task => {
    if (!taskLogs.has(task.taskId)) {
      taskLogs.set(task.taskId, [{
        timestamp: new Date(),
        type: 'info',
        message: 'Task loaded from saved state'
      }]);
    }
  });
}); 

// --- Graceful Shutdown for server.js ---
// Ensure server.js tells PM2 to stop all managed tasks on exit
async function gracefulShutdown() {
    console.log('[Server] Initiating graceful shutdown...');
    const tasksToStop = Array.from(activeTasks.values());
    console.log(`[Server] Attempting to stop ${tasksToStop.length} active PM2 tasks...`);
    const stopPromises = tasksToStop.map(taskInfo => {
      if (taskInfo.pm2_task_id) {
        return new Promise((resolve) => {
           const pm2StopCommand = `pm2 stop "${taskInfo.pm2_task_id}" --silent && pm2 delete "${taskInfo.pm2_task_id}" --silent`;
           console.log(`[Server] Sending PM2 command: ${pm2StopCommand}`);
           exec(pm2StopCommand, (error, stdout, stderr) => {
               if (error) console.error(`[Server] Error stopping/deleting PM2 task ${taskInfo.pm2_task_id} during shutdown:`, stderr || error);
               else console.log(`[Server] PM2 stop/delete successful for ${taskInfo.pm2_task_id}`);
               resolve(); // Resolve regardless of error during shutdown
           });
        });
      }
      return Promise.resolve();
    });

    await Promise.all(stopPromises); // Wait for all PM2 commands to finish

    console.log('[Server] PM2 stop commands issued.');
    server.close(() => {
        console.log('[Server] HTTP server closed.');
        process.exit(0);
    });
    // Force exit after timeout if server hangs
    setTimeout(() => {
        console.error('[Server] Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000); // 10 seconds timeout
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);