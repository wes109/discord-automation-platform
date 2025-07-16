const { checkWebhookKeywords } = require('./utils/keyword_matcher');

// Test cases
const testCases = [
  {
    name: "Test 1: Should match +testing,-test",
    embeds: [{ title: "This is a testing product", description: "Great for testing purposes" }],
    keywords: ["+testing,-test"],
    expected: true
  },
  {
    name: "Test 2: Should NOT match +testing,-test (contains negative keyword)",
    embeds: [{ title: "This is a test product", description: "Great for testing purposes" }],
    keywords: ["+testing,-test"],
    expected: false
  },
  {
    name: "Test 3: Should match +first,-try",
    embeds: [{ title: "First product", description: "Amazing first item" }],
    keywords: ["+first,-try"],
    expected: true
  },
  {
    name: "Test 4: Should NOT match +first,-try (contains negative keyword)",
    embeds: [{ title: "First product", description: "Try this amazing first item" }],
    keywords: ["+first,-try"],
    expected: false
  },
  {
    name: "Test 5: Multiple keyword groups - should match second group",
    embeds: [{ title: "First product", description: "Amazing first item" }],
    keywords: ["+testing,-test", "+first,-try"],
    expected: true
  },
  {
    name: "Test 6: Complex embed with fields",
    embeds: [{
      title: "Pokemon ETB Box",
      description: "Amazing Pokemon Elite Trainer Box",
      fields: [
        { name: "Brand", value: "Pokemon" },
        { name: "Type", value: "ETB Box" }
      ]
    }],
    keywords: ["+ETB,-destined", "+pokemon,-fake"],
    expected: true
  }
];

console.log("Testing keyword matching functionality...\n");

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = checkWebhookKeywords(testCase.embeds, testCase.keywords);
  const matched = result !== null;
  
  if (matched === testCase.expected) {
    console.log(`✅ ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${matched}`);
    if (result) {
      console.log(`   Matched group: "${result.matchedGroup}"`);
    }
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log("🎉 All tests passed! Keyword matching is working correctly.");
} else {
  console.log("⚠️  Some tests failed. Please check the implementation.");
} 