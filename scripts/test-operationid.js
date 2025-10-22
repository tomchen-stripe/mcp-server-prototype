// Test the operationId parsing logic
function testOperationId(operationId) {
  const resourcePath = operationId.replace(/^(Get|Post|Put|Patch|Delete)/, '');
  const parts = resourcePath.split(/(?=[A-Z])/);

  // Check if second part is singular form of first part
  const firstPartSingular = parts[0].toLowerCase().replace(/s$/, '');
  const secondPart = parts[1]?.toLowerCase() || '';
  const isDetailOperation = parts.length > 1 && firstPartSingular === secondPart;

  // Determine the resource name for Stripe SDK
  let mainResource;
  if (isDetailOperation) {
    // Detail operation: use only first part (e.g., "CustomersCustomer" -> "customers")
    mainResource = parts[0].toLowerCase();
  } else {
    // Collection operation: convert all parts to camelCase (e.g., "SetupIntents" -> "setupIntents")
    mainResource = parts[0].toLowerCase() + parts.slice(1).join('');
  }

  console.log(`${operationId}:`);
  console.log(`  Parts: [${parts.join(', ')}]`);
  console.log(`  IsDetail: ${isDetailOperation}`);
  console.log(`  Resource: ${mainResource}`);
  console.log('');
}

console.log('Testing operationId parsing:\n');
testOperationId('PostCustomers');
testOperationId('PostCustomersCustomer');
testOperationId('GetCustomers');
testOperationId('GetCustomersCustomer');
testOperationId('DeleteCustomersCustomer');
testOperationId('PostCharges');
testOperationId('GetAccount');
testOperationId('PostSetupIntents');
testOperationId('GetSetupIntents');
testOperationId('PostPaymentIntents');
testOperationId('GetPaymentMethods');
