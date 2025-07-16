const { checkWebhookKeywords, extractWebhookContent, parseKeywordGroup } = require('./utils/keyword_matcher');

// Debug the failing test case
const embeds = [{ title: "This is a testing product", description: "Great for testing purposes" }];
const keywords = ["+testing,-test"];

console.log("Debugging test case:");
console.log("Embeds:", JSON.stringify(embeds, null, 2));
console.log("Keywords:", keywords);

const content = extractWebhookContent(embeds);
console.log("Extracted content:", content);

const parsed = parseKeywordGroup(keywords[0]);
console.log("Parsed keywords:", parsed);

const result = checkWebhookKeywords(embeds, keywords);
console.log("Result:", result); 