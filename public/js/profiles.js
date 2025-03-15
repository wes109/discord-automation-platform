document.addEventListener('DOMContentLoaded', () => {
    const generateProfilesBtn = document.getElementById('generateProfilesBtn');
    const profileCount = document.getElementById('profileCount');
    const statusDiv = document.getElementById('profileGenerationStatus');

    generateProfilesBtn.addEventListener('click', async () => {
        const count = parseInt(profileCount.value);
        if (!count || count < 1) {
            statusDiv.innerHTML = '<div class="alert alert-danger">Please enter a valid number of profiles (minimum 1)</div>';
            return;
        }

        try {
            generateProfilesBtn.disabled = true;
            statusDiv.innerHTML = '<div class="alert alert-info">Generating profiles... Please wait and follow the instructions in the new window.</div>';

            const response = await fetch('/api/profiles/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ count })
            });

            const result = await response.json();
            
            if (result.success) {
                statusDiv.innerHTML = '<div class="alert alert-success">Profiles generated successfully!</div>';
            } else {
                statusDiv.innerHTML = `<div class="alert alert-danger">Failed to generate profiles: ${result.error}</div>`;
            }
        } catch (error) {
            statusDiv.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
        } finally {
            generateProfilesBtn.disabled = false;
        }
    });
}); 