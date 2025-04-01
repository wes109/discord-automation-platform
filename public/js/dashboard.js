document.addEventListener('DOMContentLoaded', function() {
  // Initialize Bootstrap tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

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

// Add toast container to the DOM
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
toastContainer.style.zIndex = '11';
document.body.appendChild(toastContainer);

// Function to show a toast notification
function showToast(message, type = 'info') {
  const toastId = `toast-${Date.now()}`;
  const toastHtml = `
    <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="toast-header bg-${type} text-white">
        <strong class="me-auto">Notification</strong>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
      <div class="toast-body">
        ${message}
      </div>
    </div>
  `;
  
  toastContainer.insertAdjacentHTML('beforeend', toastHtml);
  const toastElement = document.getElementById(toastId);
  const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
  toast.show();
  
  // Remove toast element after it's hidden
  toastElement.addEventListener('hidden.bs.toast', () => {
    toastElement.remove();
  });
}

// Function to create a task (called by the modal)
async function handleCreateTaskSubmit() {
  const channelUrl = document.getElementById('channelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.target-channel-checkbox:checked')).map(cb => cb.value);
  const headless = document.getElementById('enableHeadless').checked;
  const label = document.getElementById('taskLabel').value;
  const enableRegularMessages = document.getElementById('enableRegularMessages').checked;

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
        enableRegularMessages
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newTaskModal'));
      modal.hide();
      
      // Clear form fields
      document.getElementById('channelUrl').value = '';
      document.getElementById('taskLabel').value = '';
      document.querySelectorAll('.target-channel-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('enableHeadless').checked = false;
      document.getElementById('enableRegularMessages').checked = false;
      
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
async function startSavedTask(taskId) {
  if (!confirm('Are you sure you want to start this task?')) {
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
  console.log(`Starting saved task ${taskId} with headless: ${headless}, regularMessages: ${enableRegularMessages}`);
  
  try {
    const response = await fetch(`/api/tasks/${taskId}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ headless, enableRegularMessages })
    });

    const result = await response.json();

    if (result.success) {
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
async function deleteSavedTask(taskId) {
  if (!confirm('Are you sure you want to delete this task?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
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
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('startMonitoringModal'));
      modal.hide();
      
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
async function stopTask(event) {
  // Prevent event from bubbling up
  event.preventDefault();
  event.stopPropagation();
  
  const taskId = event.currentTarget.dataset.taskId;
  
  try {
    // Disable the stop button immediately
    const stopButton = event.currentTarget;
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
    if (event.currentTarget) {
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
  
  // Show the logs modal
  const logsModal = new bootstrap.Modal(document.getElementById('taskLogsModal'));
  logsModal.show();
  
  // Load the logs
  await loadTaskLogs(taskId);
}

// Function to load task logs
async function loadTaskLogs(taskId) {
  try {
    const response = await fetch(`/api/tasks/${taskId}/logs`);
    const result = await response.json();
    
    const logsContent = document.getElementById('taskLogsContent');
    
    if (result.logs && result.logs.length > 0) {
      // Format logs
      const formattedLogs = result.logs.map(log => {
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
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newDiscordChannelModal'));
      modal.hide();
      
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
  
  // Show the edit modal
  const editModal = new bootstrap.Modal(document.getElementById('editDiscordChannelModal'));
  editModal.show();
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
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('editDiscordChannelModal'));
      modal.hide();
      
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
    
    const tasksTableBody = document.querySelector('#tasksTable tbody');
    const noTasksRow = document.querySelector('#noTasksRow');
    
    if (result.tasks && result.tasks.length > 0) {
      // Hide no tasks message if it exists
      if (noTasksRow) {
        noTasksRow.style.display = 'none';
      }
      
      // Update existing rows or add new ones
      result.tasks.forEach(task => {
        let row = document.querySelector(`tr[data-task-id="${task.taskId}"]`) || 
                 document.querySelector(`tr[data-task-key="${task.key}"]`);
        
        if (!row) {
          // Create new row if it doesn't exist
          row = document.createElement('tr');
          if (task.isSaved) {
            row.dataset.taskId = task.taskId;
          } else {
            row.dataset.taskKey = task.key;
          }
          tasksTableBody.appendChild(row);
        }
        
        // Update row content
        updateTaskRow(row, task);
      });
      
      // Remove rows for tasks that no longer exist
      const existingRows = tasksTableBody.querySelectorAll('tr[data-task-id], tr[data-task-key]');
      existingRows.forEach(row => {
        const taskId = row.dataset.taskId;
        const taskKey = row.dataset.taskKey;
        
        const taskExists = result.tasks.some(task => 
          (taskId && task.taskId === taskId) || (taskKey && task.key === taskKey)
        );
        
        if (!taskExists) {
          row.remove();
        }
      });
    } else {
      // Show no tasks message
      tasksTableBody.innerHTML = `
        <tr id="noTasksRow">
          <td colspan="7" class="text-center">No active tasks</td>
        </tr>
      `;
    }
  } catch (error) {
    console.error('Error refreshing tasks table:', error);
    showToast('Error refreshing tasks table', 'danger');
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
  // Get the last check time if it exists
  const healthCell = row.querySelector('.health-check-cell');
  const lastCheckTime = healthCell ? healthCell.dataset.lastCheck : '';
  
  // Get the current health status if it exists
  const healthIndicator = healthCell ? healthCell.querySelector('.health-indicator') : null;
  const isHealthy = healthIndicator ? healthIndicator.classList.contains('healthy') : false;
  
  // For new rows, always start with unhealthy status
  const healthClass = row.innerHTML === '' ? 'health-indicator unhealthy' : 
                     (isHealthy ? 'health-indicator healthy' : 'health-indicator unhealthy');
  
  // Create row content
  const rowHtml = `
    <td><strong>${task.label || getChannelName(task.channelUrl)}</strong></td>
    <td><span class="status-badge badge ${
      task.status === 'running' ? 'bg-success' : 
      (task.status === 'stopping' ? 'bg-warning' : 
      (task.status === 'saved' ? 'bg-secondary' : 'bg-danger'))
    }">${task.status}</span></td>
    <td title="${task.channelUrl}">${getChannelName(task.channelUrl)}</td>
    <td>${
      task.webhookInfo && task.webhookInfo.length > 0 
        ? `<ul class="list-unstyled mb-0">${
            task.webhookInfo.map(webhook => 
              `<li><span class="badge bg-secondary">${webhook.name}</span></li>`
            ).join('')
          }</ul>`
        : task.targetChannels.join(', ')
    }</td>
    <td>${
      (task.settings?.headless
        ? '<span class="badge bg-info me-1">Headless</span>'
        : '<span class="badge bg-secondary">GUI</span>') +
      (task.settings?.enableRegularMessages
        ? '<span class="badge bg-primary ms-1">RegMsg</span>' 
        : '') 
    }</td>
    <td class="health-check-cell" data-task-id="${task.taskId}" data-last-check="${lastCheckTime}">
      <div class="${healthClass}" title="${lastCheckTime || 'Not checked yet'}"></div>
    </td>
    <td>
      <div class="btn-group">
        ${ task.status === 'running' /* Prioritize running status */
           ? `<button class="btn btn-sm btn-info view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
                <i class="bi bi-journal-text"></i> Logs
              </button>
              <button class="btn btn-sm btn-warning stop-task-btn" onclick="stopTask(event)" data-task-id="${task.taskId}" title="Stop this task">
                 <i class="bi bi-stop-circle"></i> Stop
              </button>`
         : task.status === 'stopping' /* Handle stopping status */
           ? `<button class="btn btn-sm btn-info view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
                <i class="bi bi-journal-text"></i> Logs
              </button>
              <button class="btn btn-sm btn-secondary" disabled>
                 <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Stopping...
              </button>`
         : task.status === 'saved' /* Only show Start/Edit/Delete if purely saved */
           ? `<button class="btn btn-sm btn-success" onclick="startSavedTask('${task.taskId}')" title="Start this task">
                <i class="bi bi-play"></i> Start
              </button>
              <button class="btn btn-sm btn-primary edit-task-btn" onclick="editTask('${task.taskId}')" title="Edit this task">
                <i class="bi bi-pencil"></i> Edit
              </button>
              <button class="btn btn-sm btn-danger" onclick="deleteSavedTask('${task.taskId}')" title="Delete this task">
                <i class="bi bi-trash"></i> Delete
              </button>`
         : '' // Default case for other statuses (e.g., error, stopped) - add buttons as needed
        }
      </div>
    </td>
  `;
  
  // Update row content
  row.innerHTML = rowHtml;
  
  // Reattach event listeners
  const viewLogsBtn = row.querySelector('.view-logs-btn');
  if (viewLogsBtn) {
    viewLogsBtn.addEventListener('click', viewTaskLogs);
  }
  
  // For stop buttons that use onclick attribute
  const stopTaskBtn = row.querySelector('.stop-task-btn');
  if (stopTaskBtn) {
    stopTaskBtn.addEventListener('click', stopTask);
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
    
    // Set selected target channels
    document.querySelectorAll('.edit-target-channel-checkbox').forEach(cb => {
      cb.checked = task.targetChannels.includes(cb.value);
    });
    
    // Show the edit modal
    const editModal = new bootstrap.Modal(document.getElementById('editTaskModal'));
    editModal.show();
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
        enableRegularMessages
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('editTaskModal'));
      modal.hide();
      
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

// Function to directly update a health indicator
function updateHealthIndicator(taskId, isHealthy) {
  const cell = document.querySelector(`.health-check-cell[data-task-id="${taskId}"]`);
  if (!cell) {
    console.log(`No health cell found for task ${taskId}`);
    return;
  }
  
  const indicator = cell.querySelector('.health-indicator');
  if (!indicator) {
    console.log(`No health indicator found for task ${taskId}`);
    return;
  }
  
  // Get current time in HH:MM:SS format
  const currentTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  
  // Create a new indicator element
  const newIndicator = document.createElement('div');
  newIndicator.className = isHealthy ? 'health-indicator healthy' : 'health-indicator unhealthy';
  newIndicator.title = `Last checked: ${currentTime}`;
  
  // Replace the old indicator with the new one
  indicator.parentNode.replaceChild(newIndicator, indicator);
  
  // Store the last check time in the cell's data attribute
  cell.dataset.lastCheck = `Last checked: ${currentTime}`;
  
  console.log(`Directly updated task ${taskId} to ${isHealthy ? 'healthy' : 'unhealthy'}`);
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
      
      // Get the last 25 log entries or all if less than 25
      const logs = data.logs || [];
      const recentLogs = logs.slice(-25);
      console.log(`Task ${taskId}: Found ${recentLogs.length} recent logs`);
      
      // Check if any recent log contains "Message already processed"
      const isHealthy = recentLogs.some(log => 
        log.message && log.message.includes('Message already processed')
      );
      console.log(`Task ${taskId}: Health status is ${isHealthy ? 'healthy' : 'unhealthy'}`);
      
      // Use the direct update function
      updateHealthIndicator(taskId, isHealthy);
    } catch (error) {
      console.error(`Error checking health for task ${taskId}:`, error);
      // Mark as unhealthy on error
      updateHealthIndicator(taskId, false);
    }
  });
} 