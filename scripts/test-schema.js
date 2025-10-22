import { readFileSync } from 'fs';

const spec = JSON.parse(readFileSync('../data/spec3.clean.json', 'utf-8'));

function extractInputSchema(operation) {
  const properties = {};
  const required = [];

  // Extract query/path parameters
  if (operation.parameters) {
    for (const param of operation.parameters) {
      if (param.schema) {
        properties[param.name] = {
          ...param.schema,
          description: param.description || ''
        };
        if (param.required) {
          required.push(param.name);
        }
      }
    }
  }

  // Extract request body parameters (for POST/PUT/PATCH)
  if (operation.requestBody?.content) {
    const formContent = operation.requestBody.content['application/x-www-form-urlencoded'];
    if (formContent?.schema?.properties) {
      Object.assign(properties, formContent.schema.properties);
      if (formContent.schema.required) {
        required.push(...formContent.schema.required);
      }
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required })
  };
}

// Test PostCustomers
console.log('=== PostCustomers Schema ===');
const postCustomers = spec.paths['/v1/customers'].post;
const postCustomersSchema = extractInputSchema(postCustomers);
console.log('Properties count:', Object.keys(postCustomersSchema.properties).length);
console.log('Sample properties:', Object.keys(postCustomersSchema.properties).slice(0, 5));
console.log('Required:', postCustomersSchema.required || 'none');
console.log('');

// Test GetCustomers (with query params)
console.log('=== GetCustomers Schema ===');
const getCustomers = spec.paths['/v1/customers'].get;
const getCustomersSchema = extractInputSchema(getCustomers);
console.log('Properties count:', Object.keys(getCustomersSchema.properties).length);
console.log('Properties:', Object.keys(getCustomersSchema.properties));
console.log('Required:', getCustomersSchema.required || 'none');
console.log('');

// Test PostSetupIntents
console.log('=== PostSetupIntents Schema ===');
const postSetupIntents = spec.paths['/v1/setup_intents'].post;
const postSetupIntentsSchema = extractInputSchema(postSetupIntents);
console.log('Properties count:', Object.keys(postSetupIntentsSchema.properties).length);
console.log('Sample properties:', Object.keys(postSetupIntentsSchema.properties).slice(0, 5));
console.log('Required:', postSetupIntentsSchema.required || 'none');
