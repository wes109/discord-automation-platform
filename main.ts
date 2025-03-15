// Helper function to process embed values
async function processEmbedValue(value, taskId) {
    const urlRegex = /\[.*?\]\((.*?)\)|(?:https?:\/\/[^\s<>)"']+[^\s.,;!?)<>'"])/g;
    const matches = [...value.matchAll(urlRegex)];
    let modifiedValue = value;

    // First, validate all URLs and collect only valid brand URLs
    const validUrls = [];
    for (const match of matches) {
        const originalUrl = match[1] || match[0];
        try {
            const urlToCheck = ENABLE_URL_UNSHORTENING ? await unshorten(originalUrl) : originalUrl;
            if (mavelyManager.isValidBrandUrl(urlToCheck)) {
                validUrls.push({
                    originalUrl,
                    unshortenedUrl: urlToCheck,
                    fullMatch: match[0],
                    isMarkdown: !!match[1]
                });
            }
        } catch (error) {
            console.error('Error processing URL', error);
        }
    }

    // Then, process only valid URLs with Mavely
    for (const urlData of validUrls) {
        let retryCount = 0;
        let mavelyUrl = null;
        
        while (retryCount < MAVELY_RETRY_COUNT) {
            try {
                mavelyUrl = await mavelyManager.generateMavelyLink(urlData.unshortenedUrl);
                if (mavelyUrl) {
                    break; // Success, exit retry loop
                }
                
                // Check if it's the "in progress" error
                if (mavelyManager.lastError?.includes('in progress')) {
                    retryCount++;
                    if (retryCount < MAVELY_RETRY_COUNT) {
                        await delay(MAVELY_RETRY_DELAY);
                        continue;
                    }
                }
                break; // Not an "in progress" error, exit retry loop
            } catch (error) {
                console.error(`Error on attempt ${retryCount + 1}`, error);
                break;
            }
        }

        if (mavelyUrl) {
            if (urlData.isMarkdown) {
                const linkText = urlData.fullMatch.match(/\[(.*?)\]/)[1];
                const newLink = `[${linkText}](${mavelyUrl})`;
                modifiedValue = modifiedValue.replace(urlData.fullMatch, newLink);
            } else {
                modifiedValue = modifiedValue.replace(urlData.fullMatch, mavelyUrl);
            }
        }
    }

    return modifiedValue;
} 