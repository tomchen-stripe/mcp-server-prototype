import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Load the spec
const specPath = join(process.cwd(), "data", "spec3.clean.json");
const spec = JSON.parse(readFileSync(specPath, "utf-8"));

// Constants for path matching (same as server.ts)
const topLevelRegex = /^\/v1\/[^\/]+$/;
const detailLevelRegex = /^\/v1\/[^\/]+\/\{[^}]+\}$/;
const httpMethods = ["get", "post", "put", "patch", "delete"];

interface Operation {
  operationId: string;
  description: string;
  path: string;
  method: string;
  parameters: any[];
  requestBody: any;
}

// Helper to list all operations from the spec
function listAllOperations(): Operation[] {
  const operations: Operation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    if (!topLevelRegex.test(path) && !detailLevelRegex.test(path)) continue;

    for (const method of httpMethods) {
      const operation = (pathItem as any)[method];
      if (operation && operation.operationId) {
        operations.push({
          operationId: operation.operationId,
          description: operation.description || "",
          path,
          method,
          parameters: operation.parameters || [],
          requestBody: operation.requestBody || null,
        });
      }
    }
  }

  return operations;
}

// Helper to convert path to Stripe SDK resource name
function pathToResourceName(path: string): string {
  // Extract resource name from path: /v1/resource_name or /v1/resource_name/{id}
  const match = path.match(/^\/v1\/([^/]+)/);
  if (!match) return "";

  const pathResource = match[1];

  // Convert snake_case to camelCase
  const camelCase = pathResource.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

  return camelCase;
}

// Helper to get the Stripe SDK type name for an operation
function getStripeTypeName(mainResource: string, method: string, isDetailPath: boolean, isSingleton: boolean): string {
  // Convert resource name to singular, PascalCase for type name
  const httpMethod = method.toLowerCase();

  // Determine the operation type
  let operationType = "";
  if (httpMethod === "get") {
    if (isSingleton || isDetailPath) {
      operationType = "Retrieve";
    } else {
      operationType = "List";
    }
  } else if (httpMethod === "post") {
    if (isDetailPath) {
      operationType = "Update";
    } else {
      operationType = "Create";
    }
  } else if (httpMethod === "delete") {
    // Special case: subscriptions use "Cancel" instead of "Delete"
    if (mainResource === "subscriptions") {
      operationType = "Cancel";
    } else {
      operationType = "Delete";
    }
  } else if (httpMethod === "patch" || httpMethod === "put") {
    operationType = "Update";
  }

  // Convert resource to singular PascalCase
  let resourceTypeName = mainResource;

  // Handle camelCase to PascalCase
  resourceTypeName = resourceTypeName.charAt(0).toUpperCase() + resourceTypeName.slice(1);

  // Remove trailing 's' for singular
  if (resourceTypeName.endsWith("s")) {
    // Check if it's a simple plural
    if (resourceTypeName.endsWith("ies")) {
      resourceTypeName = resourceTypeName.slice(0, -3) + "y";
    } else if (resourceTypeName.endsWith("ses")) {
      resourceTypeName = resourceTypeName.slice(0, -2);
    } else if (resourceTypeName.endsWith("xes")) {
      resourceTypeName = resourceTypeName.slice(0, -2);
    } else if (!resourceTypeName.endsWith("ss") && resourceTypeName.endsWith("s")) {
      // Special handling for compound words
      // balanceTransactions -> BalanceTransaction
      // paymentIntents -> PaymentIntent
      // setupIntents -> SetupIntent
      // paymentMethods -> PaymentMethod
      // ephemeralKeys -> EphemeralKey
      resourceTypeName = resourceTypeName.slice(0, -1);
    }
  }

  return `Stripe.${resourceTypeName}${operationType}Params`;
}

// Helper to generate TypeScript interface from OpenAPI parameters
function generateInlineParamsType(operation: Operation, typeName: string): string {
  const { parameters, requestBody } = operation;

  const properties: string[] = [];

  // Add path parameters
  if (parameters) {
    for (const param of parameters) {
      if (param.schema) {
        const required = param.required ? "" : "?";
        let type = "any";
        if (param.schema.type === "string") type = "string";
        else if (param.schema.type === "integer" || param.schema.type === "number") type = "number";
        else if (param.schema.type === "boolean") type = "boolean";
        else if (param.schema.type === "array") type = "any[]";

        const description = param.description ? `  /** ${param.description} */\n` : "";
        properties.push(`${description}  ${param.name}${required}: ${type};`);
      }
    }
  }

  // Add request body parameters
  if (requestBody?.content) {
    const formContent = requestBody.content["application/x-www-form-urlencoded"];
    if (formContent?.schema?.properties) {
      for (const [propName, propSchema] of Object.entries(formContent.schema.properties)) {
        const schema = propSchema as any;
        const required = formContent.schema.required?.includes(propName) ? "" : "?";
        let type = "any";

        if (schema.type === "string") type = "string";
        else if (schema.type === "number" || schema.type === "integer") type = "number";
        else if (schema.type === "boolean") type = "boolean";
        else if (schema.type === "array") type = "any[]";
        else if (schema.type === "object") type = "Record<string, any>";

        const description = schema.description ? `  /** ${schema.description.replace(/\*\//g, '*\\/')} */\n` : "";
        properties.push(`${description}  ${propName}${required}: ${type};`);
      }
    }
  }

  if (properties.length === 0) {
    return `interface ${typeName} {\n  [key: string]: any;\n}`;
  }

  return `interface ${typeName} {\n${properties.join("\n")}\n}`;
}

// Generate wrapper function code for an operation
function generateOperationWrapper(operation: Operation): string {
  const { operationId, description, method, parameters, path } = operation;

  // Check if this is a detail path (has {param})
  const isDetailPath = path.includes("{");

  // Extract resource name from the path (most reliable method)
  let mainResource = pathToResourceName(path);

  // Special case mappings for resources that don't match exactly
  const specialCases: Record<string, string> = {
    'invoiceitems': 'invoiceItems',
    'account': method.toLowerCase() === 'get' && !isDetailPath ? 'accounts' : 'account',
    'linkAccountSessions': 'accountSessions',
    'linkedAccounts': 'accounts', // linkedAccounts maps to accounts
    'externalAccounts': 'accounts.externalAccounts', // external accounts is a nested resource
  };

  if (specialCases[mainResource]) {
    mainResource = specialCases[mainResource];
  }

  // Check if this is a singleton resource
  const singletonResources = ["balance", "account"];
  const isSingleton = singletonResources.includes(mainResource) ||
                      (mainResource === "accounts" && method.toLowerCase() === "get" && !isDetailPath && operationId === "GetAccount");

  // Extract path parameter name
  let pathParamName: string | null = null;
  if (parameters) {
    const pathParam = parameters.find((p: any) => p.in === "path");
    if (pathParam) {
      pathParamName = pathParam.name;
    }
  }

  // Get the Stripe SDK type name
  let paramsType = getStripeTypeName(mainResource, method, isDetailPath, isSingleton);

  // For detail operations, we need to add the ID field to the params type
  if (isDetailPath) {
    const idParam = pathParamName || "id";
    paramsType = `${paramsType} & { ${idParam}: string }`;
  }

  // Special handling for operations that don't follow standard patterns
  const specialImplementations: Record<string, string> = {
    'GetBalanceSettings': `  // Note: balanceSettings doesn't have a standard list method
  // Use retrieve instead
  return await stripe.balanceSettings.retrieve(params as any);`,
    'PostBalanceSettings': `  // Note: balanceSettings doesn't have a standard create method
  // This endpoint updates balance settings
  return await stripe.balanceSettings.update(params as any);`,
    'GetLinkAccountSessionsSession': `  // Note: Link account sessions don't have standard retrieve method
  // This endpoint may require special handling
  const session = (params as any).session;
  const { session: _, ...options } = params as any;
  return await (stripe as any).accountSessions.retrieve(session, options);`,
    'PostExternalAccountsId': `  // Note: External accounts are nested under accounts
  const id = (params as any).id;
  const accountId = (params as any).account || (params as any).accountId;
  const { id: _id, account: _account, accountId: _accountId, ...options } = params as any;
  return await stripe.accounts.updateExternalAccount(accountId, id, options as any);`,
  };

  // Generate the function implementation
  let implementation = "";

  if (specialImplementations[operationId]) {
    implementation = specialImplementations[operationId];
  } else {
    const httpMethod = method.toLowerCase();

    if (httpMethod === "get") {
      if (isSingleton) {
        implementation = `  return await stripe.${mainResource}.retrieve(params as any);`;
      } else if (isDetailPath) {
        const idParam = pathParamName || "id";
        implementation = `  const ${idParam} = (params as any).${idParam};
  const { ${idParam}: _, ...options } = params as any;
  return await stripe.${mainResource}.retrieve(${idParam}, options as any);`;
      } else {
        implementation = `  return await stripe.${mainResource}.list(params as any);`;
      }
    } else if (httpMethod === "post") {
      if (isDetailPath) {
        const idParam = pathParamName || "id";
        implementation = `  const ${idParam} = (params as any).${idParam};
  const { ${idParam}: _, ...options } = params as any;
  return await stripe.${mainResource}.update(${idParam}, options as any);`;
      } else {
        implementation = `  return await stripe.${mainResource}.create(params as any);`;
      }
    } else if (httpMethod === "delete") {
      const idParam = pathParamName || "id";
      if (mainResource === 'subscriptions') {
        implementation = `  const ${idParam} = (params as any).${idParam};
  const { ${idParam}: _, ...options } = params as any;
  return await stripe.${mainResource}.cancel(${idParam}, options as any);`;
      } else {
        implementation = `  const ${idParam} = (params as any).${idParam};
  const { ${idParam}: _, ...options } = params as any;
  return await stripe.${mainResource}.del(${idParam}, options as any);`;
      }
    } else if (httpMethod === "patch" || httpMethod === "put") {
      const idParam = pathParamName || "id";
      implementation = `  const ${idParam} = (params as any).${idParam};
  const { ${idParam}: _, ...options } = params as any;
  return await stripe.${mainResource}.update(${idParam}, options as any);`;
    }
  }

  const escapedDescription = description.replace(/\*\//g, '*\\/');

  // Generate inline type definition
  const paramsTypeName = `${operationId}Params`;
  const inlineType = generateInlineParamsType(operation, paramsTypeName);

  return `import Stripe from "stripe";

${inlineType}

/**
 * ${escapedDescription}
 *
 * @param stripe - Stripe client instance
 * @param params - Parameters for the operation
 * @returns Promise resolving to the API response
 */
export async function ${operationId}(
  stripe: Stripe,
  params: ${paramsTypeName} = {} as ${paramsTypeName}
): Promise<any> {
${implementation}
}
`;
}

// Main generation logic
function main() {
  console.log("Generating code tools...");

  const operations = listAllOperations();
  console.log(`Found ${operations.length} operations`);

  // Create code_tools directory
  const codeToolsDir = join(process.cwd(), "mock_sandbox","code_tools");
  mkdirSync(codeToolsDir, { recursive: true });

  // Generate a file for each operation
  const exportStatements: string[] = [];
  for (const operation of operations) {
    const fileName = `${operation.operationId}.ts`;
    const filePath = join(codeToolsDir, fileName);
    const code = generateOperationWrapper(operation);
    writeFileSync(filePath, code, "utf-8");
    exportStatements.push(`export { ${operation.operationId} } from "./${operation.operationId}.js";`);
  }

  // Generate simple index.ts that just exports all operations
  const indexPath = join(codeToolsDir, "index.ts");
  const indexContent = `// Export all operation functions
// Each file is self-contained with its own inline type definitions
${exportStatements.sort().join("\n")}
`;

  writeFileSync(indexPath, indexContent, "utf-8");

  console.log(`✓ Generated ${operations.length} self-contained operation wrappers`);
  console.log(`✓ Created index.ts with all exports`);
  console.log(`✓ Code tools available in ${codeToolsDir}`);
}

main();
