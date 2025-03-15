document.addEventListener('DOMContentLoaded', function() {
  // Initialize Bootstrap tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  // Task Management
  const startTaskBtn = document.getElementById('startTaskBtn');
  if (startTaskBtn) {
    startTaskBtn.addEventListener('click', startTask);
    startTaskBtn.textContent = 'Create Task';
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

  // Monitoring Channel Management
  const saveMonitoringChannelBtn = document.getElementById('saveMonitoringChannelBtn');
  if (saveMonitoringChannelBtn) {
    saveMonitoringChannelBtn.addEventListener('click', saveMonitoringChannel);
  }

  document.querySelectorAll('.edit-monitoring-channel-btn').forEach(btn => {
    btn.addEventListener('click', editMonitoringChannel);
  });

  document.querySelectorAll('.delete-monitoring-channel-btn').forEach(btn => {
    btn.addEventListener('click', deleteMonitoringChannel);
  });
  
  // Update Monitoring Channel
  const updateMonitoringChannelBtn = document.getElementById('updateMonitoringChannelBtn');
  if (updateMonitoringChannelBtn) {
    updateMonitoringChannelBtn.addEventListener('click', updateMonitoringChannel);
  }

  document.querySelectorAll('.start-monitoring-btn').forEach(btn => {
    btn.addEventListener('click', prepareStartMonitoring);
  });

  // Confirm start monitoring button
  const confirmStartMonitoringBtn = document.getElementById('confirmStartMonitoringBtn');
  if (confirmStartMonitoringBtn) {
    confirmStartMonitoringBtn.addEventListener('click', confirmStartMonitoring);
    confirmStartMonitoringBtn.textContent = 'Create Task';
  }

  // Refresh logs button
  const refreshLogsBtn = document.getElementById('refreshLogsBtn');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', refreshLogs);
  }

  // Set up auto-refresh for tasks table
  setInterval(refreshTasksTable, 2000); // Refresh every 2 seconds
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

// Function to start a new task
async function startTask() {
  const channelUrl = document.getElementById('channelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.target-channel-checkbox:checked')).map(cb => cb.value);
  const headless = document.getElementById('enableHeadless').checked;
  const label = document.getElementById('taskLabel').value;

  if (!channelUrl || targetChannels.length === 0) {
    showToast('Please select a channel URL and at least one target channel', 'danger');
    return;
  }

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
      const modal = bootstrap.Modal.getInstance(document.getElementById('newTaskModal'));
      modal.hide();
      
      // Clear form fields
      document.getElementById('channelUrl').value = '';
      document.getElementById('taskLabel').value = '';
      document.querySelectorAll('.target-channel-checkbox').forEach(cb => cb.checked = false);
      document.getElementById('enableHeadless').checked = false;
      
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

// Function to start a saved task
async function startSavedTask(taskId) {
  if (!confirm('Are you sure you want to start this task?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/tasks/${taskId}/start`, {
      method: 'POST'
    });

    const result = await response.json();

    if (result.success) {
      // Refresh the tasks table
      refreshTasksTable();
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

// Function to prepare start monitoring
function prepareStartMonitoring(event) {
  const channelUrl = event.currentTarget.dataset.channelUrl;
  const targetChannels = event.currentTarget.dataset.targetChannels;
  
  // Set values in the modal
  document.getElementById('startMonitoringChannelUrl').value = channelUrl;
  document.getElementById('startMonitoringTargetChannels').value = targetChannels;
  
  // Set a default label based on the channel URL
  document.getElementById('startMonitoringLabel').value = channelUrl.split('/').pop();
}

// Function to confirm start monitoring
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
  const taskId = event.currentTarget.dataset.taskId;
  
  try {
    // Disable the stop button immediately
    const stopButton = event.currentTarget;
    if (stopButton) {
      stopButton.disabled = true;
    }
    
    // Find the row silently without showing errors
    const row = document.querySelector(`tr[data-task-id="${taskId}"]`);
    const statusCell = row ? row.querySelector('.status-badge') : null;
    
    // Update status if we found the elements
    if (statusCell) {
      statusCell.textContent = 'Stopping';
      statusCell.className = 'status-badge badge bg-warning';
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

// Function to save a new monitoring channel
async function saveMonitoringChannel() {
  const url = document.getElementById('monitoringChannelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.target-channel-checkbox:checked')).map(cb => cb.value);
  
  if (!url || targetChannels.length === 0) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch('/api/config/monitoring/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, targetChannels })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newMonitoringChannelModal'));
      modal.hide();
      
      // Refresh the page to show the new channel
      window.location.reload();
    } else {
      alert(`Failed to save monitoring channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error saving monitoring channel:', error);
    alert('An error occurred while saving the monitoring channel');
  }
}

// Function to edit a monitoring channel
function editMonitoringChannel(event) {
  const url = event.currentTarget.dataset.channelUrl;
  const targetChannels = event.currentTarget.dataset.targetChannels.split(',');
  
  // Set values in the edit modal
  document.getElementById('editMonitoringChannelOriginalUrl').value = url;
  document.getElementById('editMonitoringChannelUrl').value = url;
  
  // Set selected options in the target channels select
  document.querySelectorAll('.edit-target-channel-checkbox').forEach(cb => {
    cb.checked = targetChannels.includes(cb.value);
  });
  
  // Show the edit modal
  const editModal = new bootstrap.Modal(document.getElementById('editMonitoringChannelModal'));
  editModal.show();
}

// Function to update a monitoring channel
async function updateMonitoringChannel() {
  const originalUrl = document.getElementById('editMonitoringChannelOriginalUrl').value;
  const newUrl = document.getElementById('editMonitoringChannelUrl').value;
  const targetChannels = Array.from(document.querySelectorAll('.edit-target-channel-checkbox:checked')).map(cb => cb.value);
  
  if (!newUrl || targetChannels.length === 0) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch(`/api/config/monitoring/channels/${encodeURIComponent(originalUrl)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        url: newUrl !== originalUrl ? newUrl : undefined,
        targetChannels
      })
    });

    const result = await response.json();

    if (result.success) {
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('editMonitoringChannelModal'));
      modal.hide();
      
      // Refresh the page to show the updated channel
      window.location.reload();
    } else {
      alert(`Failed to update monitoring channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error updating monitoring channel:', error);
    alert('An error occurred while updating the monitoring channel');
  }
}

// Function to delete a monitoring channel
async function deleteMonitoringChannel(event) {
  const url = event.currentTarget.dataset.channelUrl;
  
  if (!confirm(`Are you sure you want to delete the monitoring channel "${url}"?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/config/monitoring/channels/${encodeURIComponent(url)}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      // Refresh the page to show the updated list
      window.location.reload();
    } else {
      alert(`Failed to delete monitoring channel: ${result.message}`);
    }
  } catch (error) {
    console.error('Error deleting monitoring channel:', error);
    alert('An error occurred while deleting the monitoring channel');
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
      task.settings?.headless
        ? '<span class="badge bg-info me-1">Headless</span>'
        : '<span class="badge bg-secondary">GUI</span>'
    }</td>
    <td>${
      task.isSaved 
        ? `Created: ${new Date(task.createdTime).toLocaleString()}`
        : `Started: ${new Date(task.startTime).toLocaleString()}`
    }</td>
    <td>
      <div class="btn-group">
        ${task.isSaved 
          ? `<button class="btn btn-sm btn-success" onclick="startSavedTask('${task.taskId}')" title="Start this task">
               <i class="bi bi-play"></i> Start
             </button>
             <button class="btn btn-sm btn-primary edit-task-btn" onclick="editTask('${task.taskId}')" title="Edit this task">
               <i class="bi bi-pencil"></i> Edit
             </button>
             <button class="btn btn-sm btn-danger" onclick="deleteSavedTask('${task.taskId}')" title="Delete this task">
               <i class="bi bi-trash"></i> Delete
             </button>`
          : `<button class="btn btn-sm btn-info view-logs-btn" data-task-id="${task.taskId}" title="View task logs">
               <i class="bi bi-journal-text"></i> Logs
             </button>
             ${task.status === 'running' 
               ? `<button class="btn btn-sm btn-warning stop-task-btn" onclick="stopTask(event)" data-task-id="${task.taskId}" title="Stop this task">
                    <i class="bi bi-stop-circle"></i> Stop
                  </button>`
               : ''
             }`
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
        label
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

// Handle stop task button clicks
document.addEventListener('click', async (e) => {
  if (e.target.closest('.stop-task-btn')) {
    const btn = e.target.closest('.stop-task-btn');
    const taskId = btn.dataset.taskId;
    
    try {
      btn.disabled = true;
      const response = await fetch(`/api/tasks/${taskId}/stop`, {
        method: 'POST'
      });
      const result = await response.json();
      
      if (result.success) {
        // Update task status in UI
        const row = btn.closest('tr');
        const statusCell = row.querySelector('td:nth-child(2)');
        statusCell.innerHTML = '<span class="badge bg-warning">stopping</span>';
        btn.remove();
      } else {
        alert('Failed to stop task: ' + result.message);
      }
    } catch (error) {
      console.error('Error stopping task:', error);
      alert('Error stopping task: ' + error.message);
    } finally {
      btn.disabled = false;
    }
  }
});

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