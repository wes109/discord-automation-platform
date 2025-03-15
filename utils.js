// Helper function for consistent logging
function logTask(taskId, status, message, error = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${taskId}] [${status}] ${message}`;
    if (error) {
        console.error(`${logMessage}\nError: ${error.message}`);
        if (error.stack) {
            console.error(error.stack);
        }
    } else {
        console.log(logMessage);
    }
}

module.exports = {
    logTask
}; 