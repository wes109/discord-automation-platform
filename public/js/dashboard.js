document.addEventListener('DOMContentLoaded', function() {
  // Initialize Bootstrap tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  // Initialize Modals
  initializeModal('newTaskModal');
  initializeModal('editTaskModal');
  initializeModal('newDiscordChannelModal');
  initializeModal('editDiscordChannelModal');
  initializeModal('taskLogsModal');
  initializeModal('generateProfilesModal');
  initializeModal('statusModal');

  // Task Management
  const startTaskBtn = document.getElementById('startTaskBtn');
  if (startTaskBtn) {
    startTaskBtn.addEventListener('click', handleCreateTaskSubmit);
  }

  // Save All Tasks button
  const saveAllTasksBtn = document.getElementById('saveAllTasksBtn');
  if (saveAllTasksBtn) {
    saveAllTasksBtn.addEventListener('click', saveAllTasks);
  }

  // Add event listeners for task actions
  document.querySelectorAll('.stop-task-btn').forEach(btn => {
    btn.addEventListener('click', stopTask);
  });

  document.querySelectorAll('.view-logs-btn').forEach(btn => {
    btn.addEventListener('click', viewTaskLogs);
  });

  // Add manual health check button
  const tasksHeader = document.querySelector('#tasksTable thead tr');
  if (tasksHeader) {
    const healthHeader = tasksHeader.querySelector('th#health-column-header');
    if (healthHeader) {
      healthHeader.innerHTML = 'Health <button id="manual-health-check" class="btn btn-sm btn-outline-secondary ms-1" title="Run health check now"><i class="bi bi-arrow-clockwise"></i></button>';
      
      // Add event listener for manual health check
      const manualHealthCheckBtn = document.getElementById('manual-health-check');
      if (manualHealthCheckBtn) {
        manualHealthCheckBtn.addEventListener('click', function() {
          showToast('Running health check...', 'info');
          checkTaskHealth();
        });
      }
    }
  }

  // Mavely Manager Control Button
  const mavelyBtn = document.getElementById('mavelyManagerControlBtn');
  if (mavelyBtn) {
    mavelyBtn.addEventListener('click', handleMavelyControlClick);
  }
  // Initial check for Mavely status on page load
  updateMavelyButtonState();
  // Periodically check Mavely status
  setInterval(updateMavelyButtonState, 15000); // Check every 15 seconds

  // Discord Channel Management
  const saveDiscordChannelBtn = document.getElementById('saveDiscordChannelBtn');
  if (saveDiscordChannelBtn) {
    saveDiscordChannelBtn.addEventListener('click', saveDiscordChannel);
  }

  document.querySelectorAll('.edit-discord-channel-btn').forEach(btn => {
    btn.addEventListener('click', editDiscordChannel);
  });

  document.querySelectorAll('.delete-discord-channel-btn').forEach(btn => {
    btn.addEventListener('click', deleteDiscordChannel);
  });
  
  // Update Discord Channel
  const updateDiscordChannelBtn = document.getElementById('updateDiscordChannelBtn');
  if (updateDiscordChannelBtn) {
    updateDiscordChannelBtn.addEventListener('click', updateDiscordChannel);
  }

  // Save Edited Task button
  const saveEditedTaskBtn = document.getElementById('saveEditedTaskBtn');
  if (saveEditedTaskBtn) {
      saveEditedTaskBtn.addEventListener('click', saveEditedTask);
  }

  // Start Monitoring Modal
  const confirmStartMonitoringBtn = document.getElementById('confirmStartMonitoringBtn');
  if (confirmStartMonitoringBtn) {
    confirmStartMonitoringBtn.addEventListener('click', confirmStartMonitoring);
  }

  // Task Logs Modal
  const refreshLogsBtn = document.getElementById('refreshLogsBtn');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', refreshLogs);
  }

  // Load tasks on page load
  refreshTasksTable();
  
  // Set up interval to refresh tasks table
  setInterval(refreshTasksTable, 10000); // Refresh every 10 seconds
  
  // Run health check immediately and then every 60 seconds
  checkTaskHealth();
  setInterval(checkTaskHealth, 60000);
});

// Current task ID for logs modal
let currentTaskId = null;

// Object to store the last known health state for each task
let taskHealthStates = {}; // Structure: { taskId: { isHealthy: boolean, lastCheck: string, unhealthySince: Date | null, restartAttempts: number, lastRestartAttempt: Date | null } }

// --- Constants for Auto Restart ---
const UNHEALTHY_RESTART_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RESTART_COOLDOWN_MS = 5 * 1000; // 5 seconds between stop and start
// --------------------------------

// Add toast container to the DOM
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
toastContainer.style.zIndex = '11';
document.body.appendChild(toastContainer);

// --- Mavely Manager Control Functions ---

let isMavelyActionInProgress = false; // Prevent double clicks

async function updateMavelyButtonState() {
  const mavelyBtn = document.getElementById('mavelyManagerControlBtn');
  if (!mavelyBtn || isMavelyActionInProgress) return;

  try {
    const response = await fetch('/api/mavely/status');
    const data = await response.json();

    // Clear existing classes
    mavelyBtn.classList.remove('bg-info-DEFAULT', 'hover:bg-info-hover', 'bg-success-DEFAULT', 'hover:bg-success-hover', 'bg-danger-DEFAULT', 'hover:bg-danger-hover', 'bg-warning-DEFAULT', 'hover:bg-warning-hover', 'bg-secondary-DEFAULT', 'hover:bg-secondary-hover', 'opacity-50', 'cursor-not-allowed');
    mavelyBtn.disabled = false;
    const icon = mavelyBtn.querySelector('i');
    icon.className = 'bi bi-gear mr-2'; // Reset icon

    switch (data.status) {
      case 'running':
        mavelyBtn.classList.add('bg-success-DEFAULT', 'hover:bg-success-hover');
        mavelyBtn.innerHTML = '<i class="bi bi-stop-circle mr-2"></i> Stop Mavely Manager';
        mavelyBtn.setAttribute('data-action', 'stop');
        break;
      case 'stopped':
        mavelyBtn.classList.add('bg-info-DEFAULT', 'hover:bg-info-hover');
        mavelyBtn.innerHTML = '<i class="bi bi-play-circle mr-2"></i> Initialize Mavely Manager';
        mavelyBtn.setAttribute('data-action', 'start');
        break;
      case 'initializing':
        mavelyBtn.classList.add('bg-warning-DEFAULT', 'opacity-50', 'cursor-not-allowed');
        mavelyBtn.innerHTML = '<i class="bi bi-hourglass-split mr-2"></i> Mavely Initializing...';
        mavelyBtn.disabled = true;
        mavelyBtn.removeAttribute('data-action');
        break;
      case 'stopping':
        mavelyBtn.classList.add('bg-warning-DEFAULT', 'opacity-50', 'cursor-not-allowed');
        mavelyBtn.innerHTML = '<i class="bi bi-hourglass-split mr-2"></i> Mavely Stopping...';
        mavelyBtn.disabled = true;
        mavelyBtn.removeAttribute('data-action');
        break;
      case 'error':
        mavelyBtn.classList.add('bg-danger-DEFAULT', 'hover:bg-danger-hover');
        mavelyBtn.innerHTML = '<i class="bi bi-exclamation-triangle mr-2"></i> Mavely Error (Re-Initialize)';
        mavelyBtn.setAttribute('data-action', 'start'); // Allow re-initialization attempt
        if (data.lastError) {
            mavelyBtn.title = `Last Error: ${data.lastError}`;
        } else {
             mavelyBtn.title = 'An error occurred with the Mavely Manager.';
        }
        break;
      default:
        mavelyBtn.classList.add('bg-secondary-DEFAULT', 'hover:bg-secondary-hover');
        mavelyBtn.innerHTML = '<i class="bi bi-question-circle mr-2"></i> Mavely Status Unknown';
        mavelyBtn.setAttribute('data-action', 'start'); // Default to allowing start
    }
  } catch (error) {
    console.error('Error fetching Mavely status:', error);
    mavelyBtn.classList.add('bg-secondary-DEFAULT', 'hover:bg-secondary-hover');
    mavelyBtn.innerHTML = '<i class="bi bi-question-circle mr-2"></i> Mavely Status Error';
    mavelyBtn.disabled = false; // Allow attempting action even if status fails
    mavelyBtn.setAttribute('data-action', 'start');
     mavelyBtn.title = 'Could not fetch Mavely Manager status.';
  }
}

async function handleMavelyControlClick() {
  if (isMavelyActionInProgress) return;

  const mavelyBtn = document.getElementById('mavelyManagerControlBtn');
  const action = mavelyBtn.getAttribute('data-action');

  if (!action) return; // Should not happen if button is not disabled

  isMavelyActionInProgress = true;
  mavelyBtn.disabled = true;
  const originalHtml = mavelyBtn.innerHTML;
  mavelyBtn.innerHTML = '<i class="bi bi-hourglass-split mr-2"></i> Processing...';
  mavelyBtn.classList.add('opacity-50', 'cursor-not-allowed');

  try {
    let endpoint = '';
    if (action === 'start') {
      endpoint = '/api/mavely/initialize';
    } else if (action === 'stop') {
      endpoint = '/api/mavely/close';
    }

    const response = await fetch(endpoint, { method: 'POST' });
    const result = await response.json();

    if (response.ok) {
      showToast(result.message || (action === 'start' ? 'Mavely initialization started.' : 'Mavely stopping process started.'), 'success');
    } else {
      showToast(`Error: ${result.message || 'Failed to perform Mavely action.'}`, 'danger');
    }
  } catch (error) {
    console.error(`Error during Mavely ${action} action:`, error);
    showToast(`Network or server error during Mavely ${action}.`, 'danger');
  } finally {
    isMavelyActionInProgress = false;
    // Re-enable button interaction will be handled by the next status update
    // but we can restore the text quicker if needed, though status update handles it
    // mavelyBtn.innerHTML = originalHtml; 
    // mavelyBtn.disabled = false;
    // mavelyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    updateMavelyButtonState(); // Immediately update state after action attempt
  }
}

// --- End Mavely Manager Control Functions ---

// Function to show a toast notification
function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    console.error('Toast container not found!');
    return;
  }

  const toastId = `toast-${Date.now()}`;
  let bgColor = 'bg-primary-DEFAULT'; // Default blue/primary
  let icon = 'bi-info-circle';

  switch (type) {
    case 'success':
      bgColor = 'bg-success-DEFAULT'; // Green
      icon = 'bi-check-circle';
      break;
    case 'warning':
      bgColor = 'bg-warning-DEFAULT'; // Amber
      icon = 'bi-exclamation-triangle';
      break;
    case 'danger':
    case 'error': // Treat error as danger
      bgColor = 'bg-danger-DEFAULT'; // Red
      icon = 'bi-x-octagon';
      break;
    // Keep default for 'info'
  }

  // Removed the close button from the template literal
  const toastHtml = `
    <div id="${toastId}" class="max-w-xs ${bgColor} text-sm text-white rounded-lg shadow-lg p-4 mb-2 flex items-center transition-opacity duration-300 ease-out opacity-100" role="alert">
      <i class="bi ${icon} mr-3 text-lg"></i>
      <div class="flex-1">${message}</div>
    </div>
  `;

  toastContainer.insertAdjacentHTML('beforeend', toastHtml);
  const toastElement = document.getElementById(toastId);

  // Auto-dismiss after 10 seconds (increased from 5)
  const timeoutId = setTimeout(() => {
    if (toastElement) {
        toastElement.classList.replace('opacity-100', 'opacity-0');
        // Remove after fade out transition completes
        setTimeout(() => toastElement.remove(), 400); 
    }
  }, 10000); // Changed from 5000 to 10000

  // Removed the event listener logic for the close button
}

// Function to create a task (called by the modal)
async function handleCreateTaskSubmit() {
  const channelUrl = document.getElementById('channelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.target-channel-checkbox:checked')).map(cb => cb.value);
  const headless = document.getElementById('enableHeadless').checked;
  const label = document.getElementById('taskLabel').value;
  const enableRegularMessages = document.getElementById('enableRegularMessages').checked;
  const isTestingModule = document.getElementById('enableTestingModule').checked;
  const enableAffiliateLinks = document.getElementById('enableAffiliateLinks').checked;
  const disableEmbedWebhook = document.getElementById('disableEmbedWebhook').checked;

  if (!channelUrl || targetChannels.length === 0) {
    showToast('Please select a channel URL and at least one target channel', 'danger');
    return;
  }

  try {
    // Use the /api/tasks/create endpoint
    const response = await fetch('/api/tasks/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        channelUrl, 
        targetChannels,
        headless,
        label,
        enableRegularMessages,
        isTestingModule,
        enableAffiliateLinks,
        disableEmbedWebhook
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal using vanilla JS
      closeModal('newTaskModal');
      
      // Clear form fields
      document.getElementById('channelUrl').value = '';
      document.getElementById('taskLabel').value = '';
      document.querySelectorAll('.target-channel-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('enableHeadless').checked = false;
      document.getElementById('enableRegularMessages').checked = false;
      document.getElementById('enableTestingModule').checked = false;
      document.getElementById('enableAffiliateLinks').checked = false;
      document.getElementById('disableEmbedWebhook').checked = false;
      
      // Refresh the tasks table
      refreshTasksTable();
      
      // Run health check immediately for the new task
      setTimeout(checkTaskHealth, 1000);
      
      showToast('Task created successfully', 'success');
    } else {
      showToast(`Failed to create task: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error creating task:', error);
    showToast('An error occurred while creating the task', 'danger');
  }
}

// Update event listener for the form submission
const newTaskForm = document.getElementById('newTaskForm');
if (newTaskForm) {
    // Prevent default form submission
    newTaskForm.addEventListener('submit', function(event) {
        event.preventDefault();
        handleCreateTaskSubmit(); // Call our combined create function
    });
}

// Function to start a saved task
async function startSavedTask(taskId, skipConfirm = false) {
  if (!skipConfirm && !confirm('Are you sure you want to start this task?')) {
    return;
  }
  
  // Get the task data to retrieve the headless setting
  const tasksResponse = await fetch('/api/tasks');
  const tasksData = await tasksResponse.json();
  const task = tasksData.tasks.find(t => t.taskId === taskId);
  
  if (!task) {
    showToast('Task not found', 'danger');
    return;
  }
  
  // Get the headless and regular message settings from the task
  const headless = task.settings?.headless === true;
  const enableRegularMessages = task.settings?.enableRegularMessages === true;
  const enableAffiliateLinks = task.settings?.enableAffiliateLinks === true;
  const disableEmbedWebhook = task.settings?.disableEmbedWebhook === true;
  console.log(`Starting saved task ${taskId} with headless: ${headless}, regularMessages: ${enableRegularMessages}, affiliateLinks: ${enableAffiliateLinks}`);
  
  try {
    const response = await fetch(`/api/tasks/${taskId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        headless, 
        enableRegularMessages, 
        enableAffiliateLinks,
        disableEmbedWebhook
      })
    });

    const result = await response.json();

    if (result.success) {
      // Clear any unhealthy state on successful manual/auto start
      if (taskHealthStates[taskId]) {
        taskHealthStates[taskId].unhealthySince = null;
        taskHealthStates[taskId].restartAttempts = 0;
        taskHealthStates[taskId].lastRestartAttempt = null;
      }
      
      // Refresh the tasks table
      refreshTasksTable();
      
      // Run health check immediately for the started task
      setTimeout(checkTaskHealth, 1000);
      
      showToast('Task started successfully', 'success');
    } else {
      showToast(`Failed to start task: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error starting task:', error);
    showToast('An error occurred while starting the task', 'danger');
  }
}

// Function to delete a saved task
async function deleteSavedTask(taskId, skipConfirm = false) {
  if (!skipConfirm && !confirm('Are you sure you want to delete this task?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      // Remove from health state tracking
      delete taskHealthStates[taskId];
      
      // Refresh the tasks table
      refreshTasksTable();
      showToast('Task deleted successfully', 'success');
    } else {
      showToast(`Failed to delete task: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error deleting task:', error);
    showToast('An error occurred while deleting the task', 'danger');
  }
}

// Function to prepare the start monitoring modal
function prepareStartMonitoring(event) {
  const channelUrl = event.currentTarget.dataset.channelUrl;
  const targetChannels = event.currentTarget.dataset.targetChannels;
  
  // Set values in the modal
  document.getElementById('startMonitoringChannelUrl').value = channelUrl;
  document.getElementById('startMonitoringTargetChannels').value = targetChannels;
  
  // Set a default label based on the channel URL
  document.getElementById('startMonitoringLabel').value = channelUrl.split('/').pop();
}

// Function to confirm starting a monitoring task
async function confirmStartMonitoring() {
  const channelUrl = document.getElementById('startMonitoringChannelUrl').value;
  const targetChannels = document.getElementById('startMonitoringTargetChannels').value.split(',');
  const headless = document.getElementById('startMonitoringEnableHeadless').checked;
  const label = document.getElementById('startMonitoringLabel').value;
  
  try {
    const response = await fetch('/api/tasks/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        channelUrl, 
        targetChannels,
        headless,
        label
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal using vanilla JS
      closeModal('startMonitoringModal');
      
      // Refresh the tasks table
      refreshTasksTable();
      
      showToast('Task created successfully', 'success');
    } else {
      showToast(`Failed to create task: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error creating task:', error);
    showToast('An error occurred while creating the task', 'danger');
  }
}

// Function to stop a task
async function stopTask(event, taskIdOverride = null, skipConfirm = false) {
  // Prevent event from bubbling up if called from button click
  if (event) {
      event.preventDefault();
      event.stopPropagation();
  }
  
  const taskId = taskIdOverride || event?.currentTarget?.dataset?.taskId;
  if (!taskId) {
      console.error('stopTask called without taskId.');
      return; // Need a task ID
  }
  
  if (!skipConfirm && !confirm(`Are you sure you want to stop task ${taskId}?`)) {
     return;
  }

  try {
    // Disable the stop button immediately if called via event
    const stopButton = event ? event.currentTarget : document.querySelector(`.stop-task-btn[data-task-id="${taskId}"]`);
    if (stopButton) {
      stopButton.disabled = true;
    }
    
    // Find the row silently without showing errors
    const row = document.querySelector(`tr[data-task-id="${taskId}"]`);
    if (row) {
      const statusCell = row.querySelector('.status-badge');
      if (statusCell) {
        statusCell.textContent = 'Stopping';
        statusCell.className = 'status-badge badge bg-warning';
      }
    }
    
    // Make the API call to stop the task
    const encodedTaskId = encodeURIComponent(taskId);
    const response = await fetch(`/api/tasks/${encodedTaskId}/stop`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    // Handle the response
    const result = await response.json();
    
    if (result.success) {
      // Clear any unhealthy state on successful manual/auto stop
      if (taskHealthStates[taskId]) {
        taskHealthStates[taskId].unhealthySince = null;
        taskHealthStates[taskId].restartAttempts = 0;
        taskHealthStates[taskId].lastRestartAttempt = null;
      }
      
      // Update UI elements if they exist
      if (statusCell) {
        statusCell.textContent = 'Saved';
        statusCell.className = 'status-badge badge bg-secondary';
      }
      
      // Update the actions cell if it exists
      const actionsCell = row ? row.querySelector('td:last-child') : null;
      if (actionsCell) {
        actionsCell.innerHTML = `
          <div class="btn-group">
            <button class="btn btn-sm btn-success" onclick="startSavedTask('${taskId}')" title="Start this task">
              <i class="bi bi-play"></i> Start
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteSavedTask('${taskId}')" title="Delete this task">
              <i class="bi bi-trash"></i> Delete
            </button>
          </div>
        `;
      }
      
      // Refresh the tasks table to ensure everything is in sync
      setTimeout(refreshTasksTable, 1000);
    } else {
      showToast(`Failed to stop task ${taskId}: ${result.message}`, 'danger'); // Show error on failure
      // Silently revert the button state if it exists
      if (stopButton) {
        stopButton.disabled = false;
      }
      
      // Silently revert the status if elements exist
      if (statusCell) {
        statusCell.textContent = 'Running';
        statusCell.className = 'status-badge badge bg-success';
      }
    }
  } catch (error) {
    console.error('Error stopping task:', error);
    // Silently handle errors and try to revert UI state
    const row = document.querySelector(`tr[data-task-id="${taskId}"]`);
    if (row) {
      const statusCell = row.querySelector('.status-badge');
      if (statusCell) {
        statusCell.textContent = 'Running';
        statusCell.className = 'status-badge badge bg-success';
      }
    }
    // Re-enable the stop button if it exists
    if (event?.currentTarget) {
      event.currentTarget.disabled = false;
    }
  }
}

// Function to check task status
async function checkTaskStatus(taskId) {
  try {
    const response = await fetch('/api/tasks');
    const result = await response.json();
    
    const task = result.tasks.find(t => t.taskId === taskId);
    
    if (!task) {
      // Task no longer exists, it has been stopped
      showToast('Task has been stopped successfully', 'success');
      refreshTasksTable();
      return;
    }
    
    if (task.status === 'stopping') {
      // Check again in 2 seconds
      setTimeout(() => checkTaskStatus(taskId), 2000);
    } else if (task.status === 'stopped') {
      showToast('Task has been stopped successfully', 'success');
      refreshTasksTable();
    }
  } catch (error) {
    console.error('Error checking task status:', error);
    showToast('Error checking task status', 'danger');
  }
}

// Function to view task logs
async function viewTaskLogs(event) {
  const taskId = event.currentTarget.dataset.taskId;
  currentTaskId = taskId;
  
  // Show the logs modal using vanilla JS
  openModal('taskLogsModal');
  
  // Load the logs
  await loadTaskLogs(taskId);
}

// Function to load task logs
async function loadTaskLogs(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/logs`);
    const data = await response.json();
    
    // --- BEGIN TEMPORARY DEBUG LOGGING ---
    // console.log(`[Health Check Debug] Logs received for task ${taskId}:`, data.logs);
    // if (data.logs && data.logs.length > 0) {
    //  console.log(`[Health Check Debug] Sample log entry for task ${taskId}:`, data.logs[data.logs.length - 1]); 
    // }
    // --- END TEMPORARY DEBUG LOGGING ---
    
    const logsContent = document.getElementById('taskLogsContent');
    
    if (data.logs && data.logs.length > 0) {
      // Format logs
      const formattedLogs = data.logs.map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString();
        const type = log.type.toUpperCase();
        return `[${timestamp}] [${type}] ${log.message}`;
      }).join('\n');
      
      logsContent.textContent = formattedLogs;
    } else {
      logsContent.textContent = 'No logs available for this task';
    }
  } catch (error) {
    console.error('Error loading task logs:', error);
    document.getElementById('taskLogsContent').textContent = 'Error loading logs';
  }
}

// Function to refresh logs
async function refreshLogs() {
  if (currentTaskId) {
    await loadTaskLogs(currentTaskId);
  }
}

// Function to save a new Discord channel
async function saveDiscordChannel() {
  const name = document.getElementById('discordChannelName').value;
  const webhook_url = document.getElementById('discordWebhookUrl').value;
  const label = document.getElementById('discordChannelLabel').value;
  
  if (!name || !webhook_url) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch('/api/config/discord/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, webhook_url, label })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal using vanilla JS
      closeModal('newDiscordChannelModal');
      
      // Refresh the page to show the new channel
      window.location.reload();
    } else {
      alert(`Failed to save Discord channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error saving Discord channel:', error);
    alert('An error occurred while saving the Discord channel');
  }
}

// Function to edit a Discord channel
function editDiscordChannel(event) {
  const name = event.currentTarget.dataset.channelName;
  const webhook_url = event.currentTarget.dataset.webhookUrl;
  const label = event.currentTarget.dataset.channelLabel || name;
  
  // Set values in the edit modal
  document.getElementById('editDiscordChannelOriginalName').value = name;
  document.getElementById('editDiscordChannelName').value = name;
  document.getElementById('editDiscordWebhookUrl').value = webhook_url;
  document.getElementById('editDiscordChannelLabel').value = label;
  
  // Show the edit modal using vanilla JS
  openModal('editDiscordChannelModal');
}

// Function to update a Discord channel
async function updateDiscordChannel() {
  const originalName = document.getElementById('editDiscordChannelOriginalName').value;
  const newName = document.getElementById('editDiscordChannelName').value;
  const webhook_url = document.getElementById('editDiscordWebhookUrl').value;
  const label = document.getElementById('editDiscordChannelLabel').value;
  
  if (!newName || !webhook_url) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch(`/api/config/discord/channels/${originalName}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        newName: newName !== originalName ? newName : undefined,
        webhook_url,
        label
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal using vanilla JS
      closeModal('editDiscordChannelModal');
      
      // Refresh the page to show the updated channel
      window.location.reload();
    } else {
      alert(`Failed to update Discord channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error updating Discord channel:', error);
    alert('An error occurred while updating the Discord channel');
  }
}

// Function to delete a Discord channel
async function deleteDiscordChannel(event) {
  const name = event.currentTarget.dataset.channelName;
  
  if (!confirm(`Are you sure you want to delete the Discord channel "${name}"?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/config/discord/channels/${name}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      // Refresh the page to show the updated list
      window.location.reload();
    } else {
      alert(`Failed to delete Discord channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error deleting Discord channel:', error);
    alert('An error occurred while deleting the Discord channel');
  }
}

// Function to refresh the tasks table
async function refreshTasksTable() {
  try {
    const response = await fetch('/api/tasks');
    const result = await response.json();
    const tasks = result.tasks;

    // Sort tasks: running first, then by label
    tasks.sort((a, b) => {
        const statusOrder = {
            'running': 1,
            'stopping': 2,
            'saved': 3,
            'error': 4, 
            'stopped': 5
        };
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;

        if (orderA !== orderB) {
            return orderA - orderB; // Sort by status first
        }

        // Secondary sort: Alphabetical by label (case-insensitive)
        const labelA = (a.label || getChannelName(a.channelUrl) || '').toLowerCase();
        const labelB = (b.label || getChannelName(b.channelUrl) || '').toLowerCase();
        if (labelA < labelB) return -1;
        if (labelA > labelB) return 1;

        return 0; // Keep original relative order if status and label are same
    });

    const tasksTableBody = document.getElementById('tasksTable').querySelector('tbody');
    
    // Clear existing table rows before adding sorted ones
    tasksTableBody.innerHTML = ''; 

    if (tasks.length > 0) {
        tasks.forEach(task => {
            // Create a new row for each task in the sorted order
            const newRow = tasksTableBody.insertRow();
            newRow.dataset.taskId = task.taskId;
            newRow.classList.add('bg-gray-800', 'hover:bg-gray-700/50'); // Add base styling
            updateTaskRow(newRow, task); // Populate the row content
        });
    } else {
      // Display empty state if no tasks exist
      tasksTableBody.innerHTML = '<tr class="bg-gray-800"><td colspan="7" class="px-6 py-4 text-center text-gray-500">No tasks found</td></tr>';
    }
    
    // Re-initialize any dynamic elements if necessary (e.g., tooltips, although they are removed)

  } catch (error) {
    console.error('Error refreshing tasks table:', error);
    // Optionally display an error message in the table
    const tasksTableBody = document.getElementById('tasksTable').querySelector('tbody');
    tasksTableBody.innerHTML = '<tr class="bg-gray-800"><td colspan="7" class="px-6 py-4 text-center text-red-500">Error loading tasks</td></tr>';
  }
}

// Function to extract channel name from URL
function getChannelName(url) {
  try {
    const parts = url.split('/');
    return parts[parts.length - 1];
  } catch (error) {
    return url;
  }
}

// Function to update a task row
function updateTaskRow(row, task) {
  // Read the last known health state from our stored object
  const currentHealth = taskHealthStates[task.taskId] || { isHealthy: false, lastCheck: 'Not checked yet' };
  const healthClass = currentHealth.isHealthy ? 'health-indicator healthy' : 'health-indicator unhealthy';
  const healthTitle = currentHealth.lastCheck || 'Not checked yet';

  // Determine status badge classes
  let statusBadgeClass = 'bg-gray-600 text-gray-100'; // Default/Unknown
  switch (task.status) {
      case 'running': statusBadgeClass = 'bg-green-600 text-green-100'; break;
      case 'stopping': statusBadgeClass = 'bg-yellow-500 text-yellow-900'; break;
      case 'saved': statusBadgeClass = 'bg-gray-500 text-gray-100'; break;
      case 'stopped': statusBadgeClass = 'bg-red-600 text-red-100'; break;
      case 'error': statusBadgeClass = 'bg-red-800 text-red-100'; break;
  }

  // Determine settings badges (using slightly different colors for contrast)
  let settingsBadges = '';
  if (task.settings?.headless) {
      settingsBadges += '<span class="inline-block bg-indigo-600 text-indigo-100 text-xs font-medium me-2 px-2.5 py-0.5 rounded">Headless</span>';
  } else {
       settingsBadges += '<span class="inline-block bg-slate-500 text-slate-100 text-xs font-medium me-2 px-2.5 py-0.5 rounded">GUI</span>';
  }
   if (task.settings?.enableRegularMessages) {
      settingsBadges += '<span class="inline-block bg-purple-600 text-purple-100 text-xs font-medium px-2.5 py-0.5 rounded">RegMsg</span>';
  }
  if (task.settings?.enableAffiliateLinks) {
      settingsBadges += '<span class="inline-block bg-cyan-600 text-cyan-100 text-xs font-medium px-2.5 py-0.5 rounded">Affiliate</span>';
  }
  if (task.settings?.disableEmbedWebhook) {
      settingsBadges += '<span class="inline-block bg-red-600 text-red-100 text-xs font-medium px-2.5 py-0.5 rounded">No Embeds</span>';
  }

  // Target Channels Display
  let targetChannelsDisplay = '';
  if (task.webhookInfo && task.webhookInfo.length > 0) {
      targetChannelsDisplay = task.webhookInfo.map(webhook => 
          `<span class="inline-block bg-gray-600 text-gray-200 text-xs font-medium me-1 mb-1 px-2 py-0.5 rounded">${webhook.name}</span>`
      ).join('');
  } else if (task.targetChannels && task.targetChannels.length > 0) {
       targetChannelsDisplay = task.targetChannels.map(name => 
          `<span class="inline-block bg-gray-600 text-gray-200 text-xs font-medium me-1 mb-1 px-2 py-0.5 rounded">${name}</span>`
       ).join('');
  } else {
       targetChannelsDisplay = '<span class="text-gray-500">None</span>';
  }

  // Create row content using the stored health state
  const rowHtml = `
    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white"><strong>${task.label || getChannelName(task.channelUrl)}</strong></td>
    <td class="px-6 py-4 whitespace-nowrap text-sm">
        <span class="inline-block text-xs font-semibold px-2.5 py-1 rounded-md ${statusBadgeClass}">
            ${task.status}
        </span>
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-400 truncate" title="${task.channelUrl}">${getChannelName(task.channelUrl)}</td>
    <td class="px-6 py-4 text-sm text-gray-400">${targetChannelsDisplay}</td>
    <td class="px-6 py-4 whitespace-nowrap text-sm">${settingsBadges}</td>
    <td class="px-6 py-4 whitespace-nowrap text-sm text-center health-check-cell" data-task-id="${task.taskId}" data-last-check="${healthTitle}">
      <div class="${healthClass}" title="${healthTitle}"></div>
    </td>
    <td class="px-6 py-4 whitespace-nowrap text-sm">
      <div class="flex space-x-3 items-center">
        ${ task.status === 'running'
           ? `<button class="text-blue-400 hover:text-blue-300 view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
                <i class="bi bi-journal-text"></i> Logs
              </button>
              <button class="text-yellow-400 hover:text-yellow-300 stop-task-btn" data-task-id="${task.taskId}" title="Stop this task">
                 <i class="bi bi-stop-circle"></i> Stop
              </button>`
         : task.status === 'stopping'
           ? `<button class="text-blue-400 hover:text-blue-300 view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
                <i class="bi bi-journal-text"></i> Logs
              </button>
              <button class="text-gray-500 cursor-not-allowed flex items-center" disabled>
                 <svg class="animate-spin -ml-1 mr-1 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                   <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                 </svg> Stopping...
              </button>`
         : task.status === 'saved'
           ? `<button class="text-green-400 hover:text-green-300 start-saved-task-btn" data-task-id="${task.taskId}" title="Start this task">
                <i class="bi bi-play"></i> Start
              </button>
              <button class="text-blue-400 hover:text-blue-300 edit-task-btn" data-task-id="${task.taskId}" title="Edit this task">
                <i class="bi bi-pencil"></i> Edit
              </button>
              <button class="text-red-500 hover:text-red-400 delete-saved-task-btn" data-task-id="${task.taskId}" title="Delete this task">
                <i class="bi bi-trash"></i> Delete
              </button>`
         : task.status === 'stopped' || task.status === 'error'
            ? `<button class="text-blue-400 hover:text-blue-300 view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
                 <i class="bi bi-journal-text"></i> Logs
               </button>
               <button class="text-red-500 hover:text-red-400 delete-saved-task-btn" data-task-id="${task.taskId}" title="Delete this task">
                 <i class="bi bi-trash"></i> Delete
               </button>`
         : ''
        }
      </div>
    </td>
  `;

  // Update row content
  row.innerHTML = rowHtml;

  // --- Reattach event listeners for dynamically created buttons --- 
  // (Important because row.innerHTML = ... removes old listeners)
  const viewLogsBtn = row.querySelector('.view-logs-btn');
  if (viewLogsBtn) {
    viewLogsBtn.addEventListener('click', viewTaskLogs);
  }
  
  const stopTaskBtn = row.querySelector('.stop-task-btn');
  if (stopTaskBtn) {
    stopTaskBtn.addEventListener('click', stopTask);
  }

  const startSavedTaskBtn = row.querySelector('.start-saved-task-btn');
  if (startSavedTaskBtn) {
    startSavedTaskBtn.addEventListener('click', (e) => startSavedTask(e.currentTarget.dataset.taskId));
  }

  const editTaskBtn = row.querySelector('.edit-task-btn');
  if (editTaskBtn) {
    editTaskBtn.addEventListener('click', (e) => editTask(e.currentTarget.dataset.taskId));
  }

  const deleteSavedTaskBtn = row.querySelector('.delete-saved-task-btn');
  if (deleteSavedTaskBtn) {
    deleteSavedTaskBtn.addEventListener('click', (e) => deleteSavedTask(e.currentTarget.dataset.taskId));
  }
}

// Function to edit a task
async function editTask(taskId) {
  try {
    // Fetch task details
    const response = await fetch('/api/tasks');
    const result = await response.json();
    const task = result.tasks.find(t => t.taskId === taskId);
    
    if (!task) {
      console.error('Task not found');
      return;
    }
    
    // Set values in the edit modal
    document.getElementById('editTaskId').value = taskId;
    document.getElementById('editChannelUrl').value = task.channelUrl;
    document.getElementById('editTaskLabel').value = task.label || '';
    document.getElementById('editEnableHeadless').checked = task.settings?.headless || false;
    document.getElementById('editEnableRegularMessages').checked = task.settings?.enableRegularMessages || false;
    document.getElementById('editEnableTestingModule').checked = task.settings?.isTestingModule || false;
    document.getElementById('editEnableAffiliateLinks').checked = task.settings?.enableAffiliateLinks || false;
    document.getElementById('editDisableEmbedWebhook').checked = task.settings?.disableEmbedWebhook || false;
    
    // Set selected target channels
    document.querySelectorAll('.edit-target-channel-checkbox').forEach(cb => {
      cb.checked = task.targetChannels.includes(cb.value);
    });
    
    // Show the edit task modal using vanilla JS
    openModal('editTaskModal');
  } catch (error) {
    console.error('Error loading task for editing:', error);
    showToast('Error loading task for editing', 'danger');
  }
}

// Function to save edited task
async function saveEditedTask() {
  const taskId = document.getElementById('editTaskId').value;
  const channelUrl = document.getElementById('editChannelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.edit-target-channel-checkbox:checked')).map(cb => cb.value);
  const headless = document.getElementById('editEnableHeadless').checked;
  const label = document.getElementById('editTaskLabel').value;
  const enableRegularMessages = document.getElementById('editEnableRegularMessages').checked;
  const isTestingModule = document.getElementById('editEnableTestingModule').checked;
  const enableAffiliateLinks = document.getElementById('editEnableAffiliateLinks').checked;
  const disableEmbedWebhook = document.getElementById('editDisableEmbedWebhook').checked;

  if (!channelUrl || targetChannels.length === 0) {
    showToast('Please select a channel URL and at least one target channel', 'danger');
    return;
  }

  try {
    // Update the task settings
    const response = await fetch(`/api/tasks/${taskId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelUrl,
        targetChannels,
        headless,
        label,
        enableRegularMessages,
        isTestingModule,
        enableAffiliateLinks,
        disableEmbedWebhook
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal using vanilla JS
      closeModal('editTaskModal');
      
      // Refresh the tasks table
      refreshTasksTable();
      
      showToast('Task updated successfully', 'success');
    } else {
      showToast(`Failed to update task: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error updating task:', error);
    showToast('An error occurred while updating the task', 'danger');
  }
}

// Function to save all active tasks
async function saveAllTasks() {
  try {
    const response = await fetch('/api/tasks/save-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      showToast(result.message, 'success');
      // Refresh the tasks table to show updated statuses
      refreshTasksTable();
    } else {
      showToast(`Failed to save tasks: ${result.message}`, 'danger');
    }
  } catch (error) {
    console.error('Error saving tasks:', error);
    showToast('An error occurred while saving tasks', 'danger');
  }
}

// Function to directly update a health indicator AND store the state
function updateHealthIndicator(taskId, isHealthy) {
  const cell = document.querySelector(`.health-check-cell[data-task-id="${taskId}"]`);
  if (!cell) return; 

  const indicator = cell.querySelector('.health-indicator');
  if (!indicator) return;

  const now = new Date();
  const currentTimeString = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  const currentTitle = `Last checked: ${currentTimeString}`;

  // Update DOM
  indicator.className = isHealthy ? 'health-indicator healthy' : 'health-indicator unhealthy';
  indicator.title = currentTitle;
  cell.dataset.lastCheck = currentTitle; // Update cell's data attribute too

  // Ensure state object exists for the task
  if (!taskHealthStates[taskId]) {
    taskHealthStates[taskId] = { 
      isHealthy: isHealthy, 
      lastCheck: currentTitle, 
      unhealthySince: isHealthy ? null : now, // Start timer if initially unhealthy
      restartAttempts: 0,
      lastRestartAttempt: null
    };
  } else {
    // Update existing state
    const currentState = taskHealthStates[taskId];
    currentState.lastCheck = currentTitle;

    if (isHealthy) {
      if (!currentState.isHealthy) {
        // Transitioned to healthy: reset unhealthy timer and attempts
        console.log(`Task ${taskId} recovered. Resetting unhealthy timer.`);
        currentState.unhealthySince = null;
        currentState.restartAttempts = 0; // Reset attempts on recovery
        currentState.lastRestartAttempt = null;
      }
      currentState.isHealthy = true;
    } else {
      // Is unhealthy
      if (currentState.isHealthy) {
        // Transitioned to unhealthy: start timer
        console.log(`Task ${taskId} became unhealthy. Starting timer.`);
        currentState.unhealthySince = now;
      } else if (currentState.unhealthySince) {
        // Already unhealthy, check if restart threshold is met
        const unhealthyDuration = now.getTime() - currentState.unhealthySince.getTime();
        console.log(`Task ${taskId} still unhealthy for ${Math.round(unhealthyDuration / 1000)}s`);

        if (unhealthyDuration > UNHEALTHY_RESTART_THRESHOLD_MS) {
          console.log(`Task ${taskId} exceeded unhealthy threshold (${UNHEALTHY_RESTART_THRESHOLD_MS / 1000}s). Checking restart conditions.`);
          attemptRestartTask(taskId); // Attempt restart if conditions met
        }
      }
      currentState.isHealthy = false;
    }
  }
  // console.log(`Updated health state for ${taskId}:`, taskHealthStates[taskId]);
}

// Health check function
function checkTaskHealth() {
  console.log('Running health check at:', new Date().toLocaleTimeString());
  const healthCells = document.querySelectorAll('.health-check-cell');
  console.log(`Found ${healthCells.length} health cells to check`);
  
  healthCells.forEach(async (cell, index) => {
    const taskId = cell.dataset.taskId;
    if (!taskId) {
      console.log(`Cell ${index} has no taskId, skipping`);
      return;
    }
    
    console.log(`Checking health for task ${taskId}`);
    
    try {
      // Fetch task logs
      const response = await fetch(`/api/tasks/${taskId}/logs`);
      const data = await response.json();
      
      // --- BEGIN TEMPORARY DEBUG LOGGING ---
      // console.log(`[Health Check Debug] Logs received for task ${taskId}:`, data.logs);
      // if (data.logs && data.logs.length > 0) {
      //  console.log(`[Health Check Debug] Sample log entry for task ${taskId}:`, data.logs[data.logs.length - 1]); 
      // }
      // --- END TEMPORARY DEBUG LOGGING ---
      
      // Get the last 100 log entries or all if less than 100
      const logs = data.logs || [];
      const recentLogs = logs.slice(-100);
      console.log(`Task ${taskId}: Found ${recentLogs.length} recent logs`);
      
      // Check for "already processed. Skipping." message (case-insensitive) in the last 100 lines
      const searchString = 'already processed. Skipping.'.toLowerCase();
      const hasProcessedMessage = recentLogs.some(log => 
        log.type.toUpperCase() === 'DEBUG' && 
        log.message.toLowerCase().includes(searchString)
      );
      
      // Update health indicator based on finding the message
      updateHealthIndicator(taskId, hasProcessedMessage);
      
      console.log(`Task ${taskId}: Health check result - ${hasProcessedMessage ? 'healthy' : 'unhealthy'}`);
    } catch (error) {
      console.error(`Error checking health for task ${taskId}:`, error);
      // Mark as unhealthy on error
      updateHealthIndicator(taskId, false);
    }
  });
}

// --- Vanilla JS Modal Handling ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex'); // Use flex for centering
        modal.setAttribute('aria-hidden', 'false'); // Make accessible
        
        // Optional: Set focus to the first focusable element in the modal
        // Find the first focusable element (button, input, etc.)
        const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable) {
            focusable.focus();
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.setAttribute('aria-hidden', 'true'); // Hide from accessibility
    }
}

function initializeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const triggerButtons = document.querySelectorAll(`[data-bs-toggle="modal"][data-bs-target="#${modalId}"]`);
    const overlay = modal.querySelector('.modal-overlay');
    const closeButtons = modal.querySelectorAll('[data-bs-dismiss="modal"]');

    triggerButtons.forEach(button => {
        button.addEventListener('click', () => openModal(modalId));
    });

    if (overlay) {
        overlay.addEventListener('click', () => closeModal(modalId));
    }

    closeButtons.forEach(button => {
        button.addEventListener('click', () => closeModal(modalId));
    });
}
// --- End Vanilla JS Modal Handling --- 

// --- Auto Restart Logic ---
async function attemptRestartTask(taskId) {
  console.log(`Attempting auto-restart evaluation for unhealthy task: ${taskId}`);
  
  // 1. Check if task still exists and is 'running'
  let task;
  try {
    const response = await fetch('/api/tasks');
    const result = await response.json();
    task = result.tasks.find(t => t.taskId === taskId);
  } catch (fetchError) {
    console.error(`Error fetching task list during restart attempt for ${taskId}:`, fetchError);
    return; // Cannot proceed without task info
  }

  if (!task) {
    console.log(`Auto-restart for ${taskId} cancelled: Task no longer exists.`);
    delete taskHealthStates[taskId]; // Clean up state
    return;
  }

  if (task.status !== 'running') {
    console.log(`Auto-restart for ${taskId} cancelled: Task status is '${task.status}', not 'running'.`);
    // If it's saved/stopped, reset the unhealthy timer just in case
    if (taskHealthStates[taskId]) {
        taskHealthStates[taskId].unhealthySince = null;
    }
    return;
  }

  // 2. Check restart attempt limits
  const state = taskHealthStates[taskId];
  if (!state) {
    console.warn(`Auto-restart for ${taskId} cancelled: Health state missing.`);
    return; // Should not happen if updateHealthIndicator called this
  }

  const now = new Date();
  // Reset attempts if the last attempt was outside the window
  if (state.lastRestartAttempt && (now.getTime() - state.lastRestartAttempt.getTime() > RESTART_ATTEMPT_WINDOW_MS)) {
    console.log(`Resetting restart attempts for ${taskId} as the last attempt was outside the window.`);
    state.restartAttempts = 0;
    state.lastRestartAttempt = null;
  }

  if (state.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.warn(`Auto-restart for ${taskId} skipped: Maximum restart attempts (${MAX_RESTART_ATTEMPTS}) reached within the last ${RESTART_ATTEMPT_WINDOW_MS / 1000 / 60} minutes.`);
    showToast(`Task ${task.label || taskId} auto-restart limit reached. Please check manually.`, 'warning');
    // Do NOT reset unhealthySince here, let it stay unhealthy
    return;
  }

  // 3. Proceed with restart
  state.restartAttempts++;
  state.lastRestartAttempt = now;
  // Immediately reset the unhealthy timer so it doesn't re-trigger instantly
  state.unhealthySince = null; 
  
  showToast(`Task ${task.label || taskId} is unhealthy. Attempting automatic restart (${state.restartAttempts}/${MAX_RESTART_ATTEMPTS}).`, 'warning');
  console.log(`Initiating auto-restart for ${taskId} (Attempt ${state.restartAttempts}/${MAX_RESTART_ATTEMPTS})`);

  try {
    // Stop the task (skip confirmation)
    await stopTask(null, taskId, true); // Pass null for event, taskId, and skipConfirm=true

    // Wait for cooldown
    console.log(`Waiting ${RESTART_COOLDOWN_MS / 1000}s before restarting ${taskId}...`);
    await new Promise(resolve => setTimeout(resolve, RESTART_COOLDOWN_MS));

    // Start the task again (skip confirmation)
    await startSavedTask(taskId, true);
    console.log(`Auto-restart sequence completed for ${taskId}.`);
    
  } catch (error) {
    console.error(`Error during auto-restart sequence for task ${taskId}:`, error);
    showToast(`Error during auto-restart for ${task.label || taskId}.`, 'danger');
    // State remains as is, might retry on next health check if still unhealthy
  }
}
// --- End Auto Restart Logic --- 