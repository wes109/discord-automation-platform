/**
 * Keyword Matcher Utility
 * Efficiently matches webhook content against keyword groups
 */

/**
 * Parse a keyword group string into positive and negative keywords
 * @param {string} keywordGroup - String like "+ETB,-destined,+pokemon"
 * @returns {Object} - { positive: ['ETB', 'pokemon'], negative: ['destined'] }
 */
function parseKeywordGroup(keywordGroup) {
  const positive = [];
  const negative = [];
  
  if (!keywordGroup || typeof keywordGroup !== 'string') {
    return { positive, negative };
  }
  
  const keywords = keywordGroup.split(',').map(k => k.trim()).filter(k => k);
  
  for (const keyword of keywords) {
    if (keyword.startsWith('+')) {
      positive.push(keyword.substring(1).toLowerCase());
    } else if (keyword.startsWith('-')) {
      negative.push(keyword.substring(1).toLowerCase());
    }
  }
  
  return { positive, negative };
}

/**
 * Extract all text content from webhook embeds for keyword matching
 * @param {Array} embeds - Array of Discord embed objects
 * @returns {string} - Combined text content
 */
function extractWebhookContent(embeds) {
  if (!embeds || !Array.isArray(embeds)) {
    return '';
  }
  
  const contentParts = [];
  
  for (const embed of embeds) {
    if (embed.title) contentParts.push(embed.title);
    if (embed.description) contentParts.push(embed.description);
    if (embed.author && embed.author.name) contentParts.push(embed.author.name);
    if (embed.footer && embed.footer.text) contentParts.push(embed.footer.text);
    
    if (embed.fields && Array.isArray(embed.fields)) {
      for (const field of embed.fields) {
        if (field.name) contentParts.push(field.name);
        if (field.value) contentParts.push(field.value);
      }
    }
  }
  
  return contentParts.join(' ').toLowerCase();
}

/**
 * Check if webhook content matches a keyword group
 * @param {string} content - Webhook content to check
 * @param {string} keywordGroup - Keyword group string like "+ETB,-destined"
 * @returns {boolean} - True if content matches the keyword group
 */
function matchesKeywordGroup(content, keywordGroup) {
  if (!content || !keywordGroup) {
    return false;
  }
  
  const { positive, negative } = parseKeywordGroup(keywordGroup);
  const contentLower = content.toLowerCase();
  
  // Check negative keywords first (fail fast)
  for (const negativeKeyword of negative) {
    if (contentLower.includes(negativeKeyword)) {
      return false; // Content contains negative keyword, no match
    }
  }
  
  // Check positive keywords
  for (const positiveKeyword of positive) {
    if (!contentLower.includes(positiveKeyword)) {
      return false; // Content doesn't contain required positive keyword
    }
  }
  
  // All positive keywords found and no negative keywords found
  return positive.length > 0; // Must have at least one positive keyword
}

/**
 * Check webhook content against multiple keyword groups
 * @param {Array} embeds - Webhook embeds
 * @param {Array} keywordGroups - Array of keyword group strings
 * @returns {Object|null} - Match result or null if no match
 */
function checkWebhookKeywords(embeds, keywordGroups) {
  if (!keywordGroups || !Array.isArray(keywordGroups) || keywordGroups.length === 0) {
    return null;
  }
  
  const content = extractWebhookContent(embeds);
  if (!content) {
    return null;
  }
  
  // Check each keyword group in order
  for (let i = 0; i < keywordGroups.length; i++) {
    const keywordGroup = keywordGroups[i];
    if (matchesKeywordGroup(content, keywordGroup)) {
      return {
        matchedGroup: keywordGroup,
        groupIndex: i,
        content: content.substring(0, 200) + (content.length > 200 ? '...' : '') // Truncate for logging
      };
    }
  }
  
  return null; // No matches found
}

module.exports = {
  parseKeywordGroup,
  extractWebhookContent,
  matchesKeywordGroup,
  checkWebhookKeywords
}; 