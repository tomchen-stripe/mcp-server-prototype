import { readFileSync, writeFileSync } from 'fs';

// Function to strip HTML tags and clean text
function sanitizeText(text) {
  if (typeof text !== 'string') return text;

  // Remove HTML tags
  let cleaned = text.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Replace newlines with spaces
  cleaned = cleaned.replace(/\n+/g, ' ');

  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

// Recursively sanitize all description fields in an object
function sanitizeDescriptions(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeDescriptions(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'description' && typeof value === 'string') {
      result[key] = sanitizeText(value);
    } else if (typeof value === 'object') {
      result[key] = sanitizeDescriptions(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Read the spec file
console.log('Reading ../data/spec3.json...');
const spec = JSON.parse(readFileSync('../data/spec3.json', 'utf-8'));

// Sanitize all descriptions
console.log('Sanitizing descriptions...');
const cleanedSpec = sanitizeDescriptions(spec);

// Write the cleaned spec
console.log('Writing ../data/spec3.clean.json...');
writeFileSync('../data/spec3.clean.json', JSON.stringify(cleanedSpec, null, 2));

console.log('Done! Created ../data/spec3.clean.json');
