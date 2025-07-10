/**
 * Parses a keyword string into include and exclude patterns
 * @param {string} keywordString - String containing keywords (e.g., "+pokemon,+ETB,-destined")
 * @returns {{includes: string[], excludes: string[]}} Object containing arrays of words to include and exclude
 */
function parseKeywords(keywordString) {
    if (!keywordString || typeof keywordString !== 'string') {
        return { includes: [], excludes: [] };
    }

    const keywords = keywordString.split(',').map(k => k.trim());
    return {
        includes: keywords.filter(k => k.startsWith('+')).map(k => k.slice(1).toLowerCase()),
        excludes: keywords.filter(k => k.startsWith('-')).map(k => k.slice(1).toLowerCase())
    };
}

/**
 * Checks if a product title matches the keyword criteria
 * @param {string} title - Product title to check
 * @param {string} keywordString - String containing keywords (e.g., "+pokemon,+ETB,-destined")
 * @returns {boolean} True if title matches all criteria, false otherwise
 */
function matchesKeywords(title, keywordString) {
    if (!title || typeof title !== 'string') {
        return false;
    }

    const { includes, excludes } = parseKeywords(keywordString);
    const titleLower = title.toLowerCase();

    // Check if all include keywords are present
    const hasAllIncludes = includes.length === 0 || 
        includes.every(word => titleLower.includes(word));

    // Check if no exclude keywords are present
    const hasNoExcludes = excludes.length === 0 || 
        excludes.every(word => !titleLower.includes(word));

    return hasAllIncludes && hasNoExcludes;
}

// Test cases
function runTests() {
    const testCases = [
        {
            title: "Pokemon TCG: Paldea Evolved ETB",
            keywords: "+pokemon,+ETB,-destined",
            expected: true,
            description: "Basic matching with include and exclude"
        },
        {
            title: "Pokemon TCG: Destined Forces ETB",
            keywords: "+pokemon,+ETB,-destined",
            expected: false,
            description: "Should fail due to excluded word"
        },
        {
            title: "Magic The Gathering Card Pack",
            keywords: "+pokemon,+ETB",
            expected: false,
            description: "Should fail due to missing required words"
        },
        {
            title: "Pokemon TCG: Scarlet & Violet ETB",
            keywords: "+pokemon,+ETB,-destined",
            expected: true,
            description: "Should match with multiple includes"
        },
        {
            title: "Pokemon TCG: Scarlet & Violet ETB",
            keywords: "",
            expected: true,
            description: "Empty keyword string should match everything"
        },
        {
            title: "",
            keywords: "+pokemon,+ETB",
            expected: false,
            description: "Empty title should never match"
        }
    ];

    console.log("Running keyword filter tests...\n");
    testCases.forEach((test, index) => {
        const result = matchesKeywords(test.title, test.keywords);
        const passed = result === test.expected;
        console.log(`Test ${index + 1}: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
        console.log(`Description: ${test.description}`);
        console.log(`Title: "${test.title}"`);
        console.log(`Keywords: "${test.keywords}"`);
        console.log(`Expected: ${test.expected}, Got: ${result}\n`);
    });
}

module.exports = {
    parseKeywords,
    matchesKeywords,
    runTests
}; 