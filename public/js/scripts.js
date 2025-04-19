document.addEventListener('DOMContentLoaded', () => {
    // ... (other existing code, e.g., nav handling, modal setup) ...

    const cronIntervalInputMinutes = document.getElementById('cronIntervalInputMinutes');
    const currentCronStringDisplay = document.getElementById('currentCronStringDisplay'); // Span to show the actual cron string
    const saveCronScheduleBtn = document.getElementById('saveCronScheduleBtn');
    const discordChannelsTableBody = document.querySelector('#discordChannelsTable tbody');
    // Add other element selectors as needed...

    // --- Config Loading --- 
    async function loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Failed to fetch config');
            const config = await response.json();

            // Populate Cron Interval Input and Display
            if (config.monitoring && config.monitoring.cronSchedule) {
                const currentCron = config.monitoring.cronSchedule;
                if (currentCronStringDisplay) {
                    currentCronStringDisplay.textContent = `Current schedule string: ${currentCron}`;
                }
                if (cronIntervalInputMinutes) {
                    // Attempt to parse minutes/hours from standard formats
                    const parts = currentCron.trim().split(/\s+/);
                    if (parts.length >= 5) {
                        if (parts[0].startsWith('*/') && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
                            const minutes = parseInt(parts[0].substring(2));
                            if (!isNaN(minutes)) {
                                cronIntervalInputMinutes.value = minutes;
                            }
                        } else if (parts[0] === '0' && parts[1].startsWith('*/') && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
                             const hours = parseInt(parts[1].substring(2));
                             if (!isNaN(hours)) {
                                 cronIntervalInputMinutes.value = hours * 60;
                             }
                        }
                        // Add more specific patterns if needed (e.g., `0 0 */1 * *`) 
                        else {
                             console.log("Cron schedule doesn't match standard minute/hour interval pattern.");
                        }
                    }
                }
            }

            // Populate Discord Channels Table
            if (discordChannelsTableBody && config.discord && config.discord.channels) {
                 populateDiscordTable(config.discord.channels);
             }

            // ... (populate other config fields if needed) ...

        } catch (error) {
            console.error('Error loading config:', error);
            showAlert('Error loading configuration.', 'danger'); // Use your alert function
        }
    }

    // Function to populate Discord table (Example, adapt if you already have one)
    function populateDiscordTable(channels) {
        if (!discordChannelsTableBody) return;
        discordChannelsTableBody.innerHTML = ''; // Clear existing rows
        if (channels.length === 0) {
             discordChannelsTableBody.innerHTML = '<tr><td colspan="2" class="text-center">No webhooks configured</td></tr>';
             return;
         }
        channels.forEach(channel => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${escapeHTML(channel.label || channel.name)}</td>
                <td>
                  <div class="btn-group">
                    <button class="btn btn-sm btn-info edit-discord-channel-btn" 
                      data-channel-name="${escapeHTML(channel.name)}"
                      data-webhook-url="${escapeHTML(channel.webhook_url)}"
                      data-channel-label="${escapeHTML(channel.label || channel.name)}"
                      title="Edit webhook">
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-danger delete-discord-channel-btn" 
                      data-channel-name="${escapeHTML(channel.name)}"
                      title="Delete webhook">
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
                </td>
            `;
            discordChannelsTableBody.appendChild(row);
        });
    }

    // --- Cron Schedule Saving --- 
    async function saveCronSchedule() {
        if (!cronIntervalInputMinutes || !saveCronScheduleBtn) return;

        const minutesInput = parseInt(cronIntervalInputMinutes.value, 10);

        if (isNaN(minutesInput) || minutesInput < 1) {
            showAlert('Please enter a valid positive number of minutes for the interval.', 'warning');
            return;
        }

        let newCronSchedule = '';
        if (minutesInput < 60) {
            // Use minute interval
            newCronSchedule = `*/${minutesInput} * * * *`;
        } else {
            // Check if it's a multiple of 60 for hourly interval
            if (minutesInput % 60 !== 0) {
                 showAlert('Intervals of 60 minutes or more must be multiples of 60 (e.g., 60, 120, 180).', 'warning');
                 return;
             }
            const hours = minutesInput / 60;
            newCronSchedule = `0 */${hours} * * *`; // Every H hours, on the hour
        }

        console.log(`Converted ${minutesInput} minutes to cron string: ${newCronSchedule}`); // Debug log

        // Basic client-side validation (already done by conversion logic)
        // const parts = newCronSchedule.split(/\s+/);
        // if (parts.length < 5 || parts.length > 6) { ... }

        try {
            saveCronScheduleBtn.disabled = true;
            saveCronScheduleBtn.textContent = 'Saving...';

            const response = await fetch('/api/config/cron', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // Send the CONVERTED cron string to the backend
                body: JSON.stringify({ cronSchedule: newCronSchedule })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showAlert('Restart interval updated successfully! Changes apply to newly started tasks.', 'success');
                // Refresh the displayed cron string
                if (currentCronStringDisplay) {
                    currentCronStringDisplay.textContent = `Current schedule string: ${newCronSchedule}`;
                }
            } else {
                throw new Error(result.message || 'Failed to update cron schedule.');
            }
        } catch (error) {
            console.error('Error saving cron schedule:', error);
            showAlert(`Error saving restart interval: ${error.message}`, 'danger');
        } finally {
            saveCronScheduleBtn.disabled = false;
            // Update button text to reflect interval
            saveCronScheduleBtn.textContent = 'Save Restart Interval'; 
        }
    }

    // Add event listener for the save button
    if (saveCronScheduleBtn) {
        saveCronScheduleBtn.addEventListener('click', saveCronSchedule);
    }

    // Helper function for showing alerts (replace with your actual implementation if different)
    function showAlert(message, type = 'info') {
        // Simple alert, replace with a more sophisticated Bootstrap alert if needed
        console.log(`ALERT [${type}]: ${message}`);
        alert(`[${type.toUpperCase()}] ${message}`); 
    }

    // Helper function to escape HTML (prevent XSS)
    function escapeHTML(str) {
         return str.replace(/[&<>'"]/g, 
           tag => ({
               '&': '&amp;',
               '<': '&lt;',
               '>': '&gt;',
               '\'': '&#39;',
               '"': '&quot;'
           }[tag] || tag)
         );
     }

    // --- Initial Load --- 
    // Make sure to call loadConfig to populate the UI on page load
    loadConfig();

    // ... (rest of your existing event listeners and functions) ...

}); 