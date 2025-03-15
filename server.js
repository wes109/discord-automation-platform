const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');

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
const MAX_LOG_ENTRIES = 100;
const TASKS_SETTINGS_FILE = path.join(__dirname, 'task_settings.json');
const SAVED_TASKS_FILE = path.join(__dirname, 'saved_tasks.json');

// Track tasks that are in the process of being stopped
const stoppingTasks = new Set();

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
    const taskToSave = {
      taskId: taskInfo.taskId,
      label: taskInfo.label,
      channelUrl: taskInfo.channelUrl,
      targetChannels: taskInfo.targetChannels,
      webhookInfo: taskInfo.webhookInfo,
      settings: taskInfo.settings,
      createdTime: new Date().toISOString()
    };
    
    // Remove any existing task with the same ID
    const updatedTasks = savedTasks.filter(t => t.taskId !== taskInfo.taskId);
    updatedTasks.push(taskToSave);
    
    fs.writeJsonSync(SAVED_TASKS_FILE, updatedTasks, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Error saving task:', error);
    return false;
  }
}

// Function to find Chrome/Puppeteer processes
async function findChromePids(parentPid) {
  console.log(`[Process Manager] Searching for Chrome processes under parent PID ${parentPid}`);
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = `ps -A -o pid,ppid,command | grep -i "chrome.*--remote-debugging-port" | awk '$2 == ${parentPid} {print $1 " " $3}'`;
    console.log(`[Process Manager] Executing command: ${cmd}`);
    
    exec(cmd, (error, stdout) => {
      if (error) {
        console.log(`[Process Manager] Error finding Chrome processes:`, error);
        resolve([]);
        return;
      }
      if (!stdout.trim()) {
        console.log(`[Process Manager] No Chrome processes found under PID ${parentPid}`);
        resolve([]);
        return;
      }
      const processes = stdout.trim().split('\n').map(line => {
        const [pid, ...cmdParts] = line.split(' ');
        return { pid: parseInt(pid), command: cmdParts.join(' ') };
      }).filter(proc => !isNaN(proc.pid));
      
      console.log(`[Process Manager] Found Chrome processes:`, processes);
      resolve(processes.map(p => p.pid));
    });
  });
}

// Function to get all descendant processes for a PID
async function getAllDescendantProcesses(parentPid) {
  console.log(`[Process Manager] Getting all descendants of PID ${parentPid}`);
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = `ps -A -o pid,ppid,command | awk '$2 == ${parentPid} {print $1 " " $3}'`;
    console.log(`[Process Manager] Executing command: ${cmd}`);
    
    exec(cmd, (error, stdout) => {
      if (error) {
        console.log(`[Process Manager] Error finding descendant processes:`, error);
        resolve([]);
        return;
      }
      if (!stdout.trim()) {
        console.log(`[Process Manager] No descendants found for PID ${parentPid}`);
        resolve([]);
        return;
      }
      const processes = stdout.trim().split('\n').map(line => {
        const [pid, ...cmdParts] = line.split(' ');
        return { pid: parseInt(pid), command: cmdParts.join(' ') };
      }).filter(proc => !isNaN(proc.pid));
      
      console.log(`[Process Manager] Found descendant processes:`, processes);
      resolve(processes);
    });
  });
}

// Function to check if a process exists
async function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

// Function to kill a specific process
async function killProcess(pid, signal = 'SIGTERM') {
  console.log(`[Process Manager] Attempting to kill PID ${pid} with ${signal}`);
  try {
    const running = await isProcessRunning(pid);
    if (!running) {
      console.log(`[Process Manager] Process ${pid} is already dead`);
      return true;
    }
    
    process.kill(pid, signal);
    console.log(`[Process Manager] Successfully sent ${signal} to process ${pid}`);
    
    // Verify process was killed
    await new Promise(resolve => setTimeout(resolve, 500));
    const stillRunning = await isProcessRunning(pid);
    console.log(`[Process Manager] Process ${pid} status after ${signal}: ${stillRunning ? 'still running' : 'terminated'}`);
    
    return !stillRunning;
  } catch (e) {
    console.log(`[Process Manager] Failed to send ${signal} to process ${pid}:`, e.message);
    return false;
  }
}

// Function to kill process and all its descendants
async function killProcessTree(pid) {
  console.log(`[Process Manager] ========== Starting process tree termination for PID ${pid} ==========`);
  
  try {
    // First, try to find and kill Chrome/Puppeteer processes
    console.log(`[Process Manager] Step 1: Finding Chrome processes`);
    const chromePids = await findChromePids(pid);
    console.log(`[Process Manager] Found ${chromePids.length} Chrome processes to kill:`, chromePids);
    
    // Kill Chrome processes first with SIGTERM
    console.log(`[Process Manager] Step 2: Sending SIGTERM to Chrome processes`);
    for (const chromePid of chromePids) {
      await killProcess(chromePid, 'SIGTERM');
    }
    
    // Get all other descendant processes
    console.log(`[Process Manager] Step 3: Finding all descendant processes`);
    const descendants = await getAllDescendantProcesses(pid);
    console.log(`[Process Manager] Found ${descendants.length} total descendant processes`);
    
    // Send SIGTERM to all descendants except Chrome
    console.log(`[Process Manager] Step 4: Sending SIGTERM to non-Chrome descendants`);
    for (const proc of descendants) {
      if (!chromePids.includes(proc.pid)) {
        await killProcess(proc.pid, 'SIGTERM');
      }
    }
    
    // Kill parent with SIGTERM
    console.log(`[Process Manager] Step 5: Sending SIGTERM to parent process ${pid}`);
    await killProcess(pid, 'SIGTERM');
    
    // Wait longer for Chrome to cleanup
    console.log(`[Process Manager] Step 6: Waiting 1 second before SIGKILL phase`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check remaining processes
    console.log(`[Process Manager] Step 7: Checking for remaining processes`);
    let remainingProcesses = await getAllDescendantProcesses(pid);
    console.log(`[Process Manager] ${remainingProcesses.length} processes still running after SIGTERM`);
    
    if (remainingProcesses.length > 0) {
      console.log(`[Process Manager] Step 8: Sending SIGKILL to remaining processes`);
      for (const proc of remainingProcesses) {
        await killProcess(proc.pid, 'SIGKILL');
      }
    }
    
    // Final check on parent
    console.log(`[Process Manager] Step 9: Final check on parent process ${pid}`);
    const parentRunning = await isProcessRunning(pid);
    if (parentRunning) {
      console.log(`[Process Manager] Parent still running, sending SIGKILL`);
      await killProcess(pid, 'SIGKILL');
    }
    
    // Use pkill as a last resort - ignore exit code 1 as it just means no processes were found
    console.log(`[Process Manager] Step 10: Final cleanup with pkill`);
    const { exec } = require('child_process');
    await new Promise((resolve) => {
      exec(`pkill -9 -P ${pid}`, (error) => {
        if (error && error.code !== 1) {
          console.log(`[Process Manager] pkill error:`, error);
        } else if (error && error.code === 1) {
          console.log(`[Process Manager] No remaining processes found for pkill cleanup`);
        }
        resolve();
      });
    });
    
    // Double check Chrome processes - ignore exit code 1 as it just means no processes were found
    console.log(`[Process Manager] Step 11: Final Chrome process cleanup`);
    await new Promise((resolve) => {
      exec(`pkill -9 -f "chrome.*--remote-debugging-port"`, (error) => {
        if (error && error.code !== 1) {
          console.log(`[Process Manager] Chrome cleanup error:`, error);
        } else if (error && error.code === 1) {
          console.log(`[Process Manager] No Chrome processes found for cleanup`);
        }
        resolve();
      });
    });
    
    // Final verification
    const finalDescendants = await getAllDescendantProcesses(pid);
    const finalParentStatus = await isProcessRunning(pid);
    console.log(`[Process Manager] Final status:`, {
      parentRunning: finalParentStatus,
      remainingDescendants: finalDescendants.length
    });
    
    console.log(`[Process Manager] ========== Process tree termination complete ==========`);
    return finalDescendants.length === 0 && !finalParentStatus;
  } catch (error) {
    console.error(`[Process Manager] Critical error in killProcessTree:`, error);
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
  try {
    return fs.readJsonSync(path.join(__dirname, 'config.json'));
  } catch (error) {
    console.error('Error reading config:', error);
    return { discord: { channels: [] }, monitoring: { channels: [] } };
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
  
  // Create task settings
  const settings = {
    label: taskSettings.label || channelUrl.split('/').pop(),
    channelUrl,
    targetChannels,
    webhookInfo,
    enableUrlUnshortening: taskSettings.enableUrlUnshortening || false,
    createdTime: new Date().toISOString()
  };
  
  // Save to saved tasks
  const savedTasks = readSavedTasks();
  savedTasks.push({
    taskId,
    ...settings
  });
  writeSavedTasks(savedTasks);
  
  return { success: true, taskId, settings };
}

// Function to delete a saved task
function deleteSavedTask(taskId) {
  try {
    const savedTasks = readSavedTasks();
    const updatedTasks = savedTasks.filter(task => task.taskId !== taskId);
    writeSavedTasks(updatedTasks);
    return true;
  } catch (error) {
    console.error('Error deleting saved task:', error);
    return false;
  }
}

// Function to start a monitoring task
async function startMonitoringTask(channelUrl, targetChannels, taskSettings = {}) {
  const taskId = `task_${Date.now()}`;
  
  // Initialize log for this task
  taskLogs.set(taskId, [{
    timestamp: new Date(),
    type: 'info',
    message: `Starting task with settings: ${JSON.stringify({
      channelUrl,
      targetChannels,
      headless: taskSettings.headless,
      label: taskSettings.label
    }, null, 2)}`
  }]);
  
  // Get webhook information
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
  
  // Create a unique profile for this task
  let profileId;
  try {
    profileId = await createTaskProfile(taskId);
  } catch (error) {
    console.error(`Failed to create profile for task ${taskId}:`, error);
    return { success: false, message: 'Failed to create Chrome profile' };
  }
  
  // Save task settings
  const settings = {
    label: taskSettings.label || channelUrl.split('/').pop(),
    channelUrl,
    targetChannels,
    webhookInfo,
    enableUrlUnshortening: taskSettings.enableUrlUnshortening || false,
    headless: taskSettings.headless || false,
    startTime: new Date().toISOString(),
    profileId
  };
  
  writeTaskSettings(taskId, settings);
  
  // Build command line arguments
  const args = [
    'main.js',
    '--channel', channelUrl,
    '--targets', targetChannels.join(','),
    '--task-id', taskId,
    '--profile', profileId
  ];
  
  if (settings.enableUrlUnshortening) {
    args.push('--enable-url-unshortening');
  }

  if (settings.headless) {
    args.push('--headless');
  }
  
  // Spawn task process with its own process group
  const task = spawn('node', args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Handle task output
  task.stdout.on('data', (data) => {
    const message = data.toString().trim();
    const logs = taskLogs.get(taskId) || [];
    logs.push({
      timestamp: new Date(),
      type: 'info',
      message
    });
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.shift();
    }
    taskLogs.set(taskId, logs);
    console.log(`[${taskId}] ${message}`);
  });

  task.stderr.on('data', (data) => {
    const message = data.toString().trim();
    const logs = taskLogs.get(taskId) || [];
    logs.push({
      timestamp: new Date(),
      type: 'error',
      message
    });
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.shift();
    }
    taskLogs.set(taskId, logs);
    console.error(`[${taskId}] Error: ${message}`);
  });
  
  // Store task information using taskId as the key
  activeTasks.set(taskId, {
    taskId,
    process: task,
    channelUrl,
    targetChannels,
    webhookInfo,
    label: settings.label,
    settings,
    startTime: new Date(),
    status: 'running'
  });
  
  return { success: true, taskId };
}

// Function to stop a monitoring task
async function stopMonitoringTask(taskId) {
  console.log(`[Task Manager] ========== Starting task termination for task ${taskId} ==========`);
  
  if (!activeTasks.has(taskId)) {
    console.log(`[Task Manager] Task not found: ${taskId}`);
    return { success: false, message: 'Task not found' };
  }

  // Check if task is already being stopped
  if (stoppingTasks.has(taskId)) {
    console.log(`[Task Manager] Task ${taskId} is already being stopped`);
    return { success: true, message: 'Task is already being stopped' };
  }

  // Add to stopping tasks set
  stoppingTasks.add(taskId);
  
  const taskInfo = activeTasks.get(taskId);
  console.log(`[Task Manager] Stopping task ${taskInfo.taskId} with process ${taskInfo.process.pid}`);
  
  try {
    // Update task status immediately
    taskInfo.status = 'stopping';
    taskInfo.endTime = new Date();
    activeTasks.set(taskId, taskInfo);
    console.log(`[Task Manager] Updated task status to stopping`);
    
    // Add log entry
    const logs = taskLogs.get(taskInfo.taskId) || [];
    logs.push({
      timestamp: new Date(),
      type: 'info',
      message: 'Task stopping - initiating shutdown sequence'
    });
    taskLogs.set(taskInfo.taskId, logs);
    
    if (taskInfo.process && taskInfo.process.pid) {
      const processGroupId = Math.abs(taskInfo.processGroup);
      console.log(`[Task Manager] Starting process cleanup for group ${processGroupId}`);
      
      // First try sending SIGTERM to allow graceful shutdown
      try {
        taskInfo.process.kill('SIGTERM');
        console.log(`[Task Manager] Sent initial SIGTERM to main process ${taskInfo.process.pid}`);
      } catch (e) {
        console.log(`[Task Manager] Failed to send initial SIGTERM:`, e.message);
      }
      
      // Wait for graceful shutdown
      console.log(`[Task Manager] Waiting 5 seconds for graceful shutdown`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Kill the entire process tree
      console.log(`[Task Manager] Starting process tree termination`);
      const killed = await killProcessTree(processGroupId);
      console.log(`[Task Manager] Process tree termination result:`, killed);
      
      // Save task before removing from active tasks
      console.log(`[Task Manager] Saving task to persistent storage`);
      saveTask(taskInfo);
      
      // Remove from active tasks
      console.log(`[Task Manager] Removing task from active tasks`);
      activeTasks.delete(taskId);
      
      // Clean up the task's profile directory
      if (taskInfo.settings && taskInfo.settings.profileId) {
        const profilePath = path.join(__dirname, taskInfo.settings.profileId);
        console.log(`[Task Manager] Cleaning up profile directory: ${profilePath}`);
        try {
          await fs.remove(profilePath);
          console.log(`[Task Manager] Profile directory removed successfully`);
        } catch (error) {
          console.error(`[Task Manager] Error removing profile directory:`, error);
        }
      }
      
      // Add final log entry
      logs.push({
        timestamp: new Date(),
        type: 'info',
        message: 'Task stopped successfully'
      });
      taskLogs.set(taskInfo.taskId, logs);
      
      // Final cleanup - kill any remaining Chrome processes
      // Note: pkill returning 1 just means no processes were found to kill, which is fine
      console.log(`[Task Manager] Performing final Chrome cleanup`);
      try {
        const { execSync } = require('child_process');
        execSync('pkill -9 -f "chrome.*--remote-debugging-port"');
      } catch (e) {
        // Ignore pkill errors - exit code 1 just means no matching processes were found
        console.log(`[Task Manager] Chrome cleanup completed (no processes found)`);
      }
      
      // Remove from stopping tasks set
      stoppingTasks.delete(taskId);
      
      console.log(`[Task Manager] ========== Task termination complete ==========`);
      return {
        success: true,
        taskId: taskInfo.taskId,
        status: 'stopped'
      };
    }
    
    console.log(`[Task Manager] No process to clean up, just saving task`);
    saveTask(taskInfo);
    activeTasks.delete(taskId);
    stoppingTasks.delete(taskId);
    return {
      success: true,
      taskId: taskInfo.taskId,
      status: 'stopped'
    };
  } catch (error) {
    console.error(`[Task Manager] Critical error in stopMonitoringTask:`, error);
    
    // Try to save task even if there's an error
    try {
      saveTask(taskInfo);
    } catch (saveError) {
      console.error(`[Task Manager] Error saving task:`, saveError);
    }
    
    // Clean up even if there's an error
    if (activeTasks.has(taskId)) {
      activeTasks.delete(taskId);
    }
    stoppingTasks.delete(taskId);
    
    // Add error log entry
    const logs = taskLogs.get(taskInfo.taskId) || [];
    logs.push({
      timestamp: new Date(),
      type: 'error',
      message: `Error stopping task: ${error.message}`
    });
    taskLogs.set(taskInfo.taskId, logs);
    
    // Try one last time to kill everything
    // Note: Ignore pkill errors as they just mean no processes were found
    console.log(`[Task Manager] Attempting final emergency cleanup`);
    try {
      const { execSync } = require('child_process');
      execSync(`pkill -9 -P ${taskInfo.process.pid}`);
      execSync('pkill -9 -f "chrome.*--remote-debugging-port"');
    } catch (e) {
      // Ignore pkill errors
      console.log(`[Task Manager] Emergency cleanup completed (no processes found)`);
    }
    
    return {
      success: true, // Return success even if there were pkill errors
      taskId: taskInfo.taskId,
      status: 'stopped'
    };
  }
}

// Routes
app.get('/', (req, res) => {
  const config = readConfig();
  res.render('dashboard', { 
    config,
    activeTasks: Array.from(activeTasks.entries()).map(([key, task]) => ({
      key,
      ...task
    }))
  });
});

// API endpoint to get all tasks
app.get('/api/tasks', (req, res) => {
  // Get saved tasks
  const savedTasks = readSavedTasks().map(task => ({
    ...task,
    status: 'saved',
    isSaved: true
  }));
  
  // Get active tasks
  const runningTasks = Array.from(activeTasks.entries()).map(([key, task]) => ({
    key,
    ...task,
    process: undefined, // Don't send process object
    isSaved: false
  }));
  
  res.json({
    tasks: [...savedTasks, ...runningTasks]
  });
});

// API endpoint to get task logs
app.get('/api/tasks/:taskId/logs', (req, res) => {
  const { taskId } = req.params;
  const logs = taskLogs.get(taskId) || [];
  res.json({ logs });
});

// API endpoint to create a task without starting it
app.post('/api/tasks/create', (req, res) => {
  const { channelUrl, targetChannels, enableUrlUnshortening, label } = req.body;
  
  if (!channelUrl || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }
  
  const taskSettings = {
    enableUrlUnshortening: enableUrlUnshortening || false,
    label: label || ''
  };
  
  const result = createTask(channelUrl, targetChannels, taskSettings);
  res.json(result);
});

// API endpoint to start a task
app.post('/api/tasks/start', async (req, res) => {
  const { channelUrl, targetChannels, enableUrlUnshortening, label, headless } = req.body;
  
  if (!channelUrl || !targetChannels || !Array.isArray(targetChannels)) {
    return res.status(400).json({ success: false, message: 'Invalid parameters' });
  }
  
  const taskSettings = {
    enableUrlUnshortening: enableUrlUnshortening || false,
    label: label || '',
    headless: headless || false
  };
  
  const result = await startMonitoringTask(channelUrl, targetChannels, taskSettings);
  res.json(result);
});

// API endpoint to start a saved task
app.post('/api/tasks/:taskId/start', async (req, res) => {
  const { taskId } = req.params;
  
  // Find the saved task
  const savedTasks = readSavedTasks();
  const taskToStart = savedTasks.find(task => task.taskId === taskId);
  
  if (!taskToStart) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  
  // Start the task
  const result = await startMonitoringTask(
    taskToStart.channelUrl, 
    taskToStart.targetChannels, 
    {
      enableUrlUnshortening: taskToStart.enableUrlUnshortening,
      label: taskToStart.label
    }
  );
  
  // If successful, remove from saved tasks
  if (result.success) {
    deleteSavedTask(taskId);
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
  const { channelUrl, targetChannels, headless, label } = req.body;
  
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
  
  // Update task settings
  savedTasks[taskIndex] = {
    ...savedTasks[taskIndex],
    channelUrl,
    targetChannels,
    webhookInfo,
    label,
    settings: {
      ...savedTasks[taskIndex].settings,
      headless
    }
  };
  
  // Save the updated tasks
  const success = writeSavedTasks(savedTasks);
  
  if (success) {
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

// API endpoint to update config
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

// Start the server
server.listen(port, () => {
  console.log(`Discord Monitor Dashboard running on http://localhost:${port}`);
  
  // Load saved tasks on server start
  const savedTasks = loadSavedTasks();
  console.log(`Loaded ${savedTasks.length} saved tasks`);
  
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