#!/usr/bin/env node

/**
 * Test script to verify streaming fixes
 */

// Test the advanced content extraction function
function extractNewContentAdvanced(currentText, previousText) {
  if (!previousText || previousText.trim() === '') {
    return currentText;
  }
  
  // Normalize texts for comparison (remove punctuation, lowercase, normalize spaces)
  const normalizeForComparison = (text) => {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim();
  };
  
  const currentNormalized = normalizeForComparison(currentText);
  const previousNormalized = normalizeForComparison(previousText);
  
  // If normalized texts are identical, no new content
  if (currentNormalized === previousNormalized) {
    console.log(`🔄 Advanced diff: Normalized texts are identical, no new content`);
    return '';
  }
  
  // Split into words for comparison
  const currentWords = currentNormalized.split(' ').filter(w => w.length > 0);
  const previousWords = previousNormalized.split(' ').filter(w => w.length > 0);
  
  // Find the longest common prefix
  let commonPrefixLength = 0;
  const minLength = Math.min(currentWords.length, previousWords.length);
  
  for (let i = 0; i < minLength; i++) {
    if (currentWords[i] === previousWords[i]) {
      commonPrefixLength = i + 1;
    } else {
      break;
    }
  }
  
  // Extract new words from after the common prefix
  const newWords = currentWords.slice(commonPrefixLength);
  
  // If we have new words, return them
  if (newWords.length > 0) {
    const newContent = newWords.join(' ');
    console.log(`🔍 Advanced diff: commonPrefix=${commonPrefixLength}, newWords=${newWords.length}, content="${newContent}"`);
    return newContent;
  }
  
  // Check if current text is shorter (word was removed/corrected)
  if (currentWords.length < previousWords.length) {
    console.log(`🔄 Advanced diff: Text shortened, no new content`);
    return '';
  }
  
  console.log(`🔄 Advanced diff: No meaningful changes detected`);
  return '';
}

// Test cases that were causing issues
console.log('🧪 Testing streaming fixes...\n');

// Test case 1: Punctuation differences
console.log('Test 1: Punctuation differences');
const result1 = extractNewContentAdvanced(
  "Okay. Now, let me remove", 
  "Okay. Now let me remove"
);
console.log(`Result: "${result1}"\n`);

// Test case 2: Case differences
console.log('Test 2: Case differences');
const result2 = extractNewContentAdvanced(
  "okay now let me remove", 
  "Okay Now Let Me Remove"
);
console.log(`Result: "${result2}"\n`);

// Test case 3: Actual new content
console.log('Test 3: Actual new content');
const result3 = extractNewContentAdvanced(
  "Okay. Now let me remove the old", 
  "Okay. Now let me remove"
);
console.log(`Result: "${result3}"\n`);

// Test case 4: Word by word streaming
console.log('Test 4: Word by word streaming');
let previous = "Okay now let";
const words = ["me", "remove", "the", "old", "function"];

words.forEach((word, i) => {
  const current = previous + " " + word;
  const newContent = extractNewContentAdvanced(current, previous);
  console.log(`Step ${i + 1}: "${previous}" -> "${current}" = "${newContent}"`);
  previous = current;
});

console.log('\n✅ Streaming fix tests completed!'); 