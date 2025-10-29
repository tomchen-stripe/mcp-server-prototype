import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  ClientCapabilities,
  CompleteRequestSchema,
  CreateMessageRequest,
  CreateMessageResultSchema,
  ElicitResultSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  ReadResourceRequestSchema,
  Resource,
  RootsListChangedNotificationSchema,
  ServerNotification,
  ServerRequest,
  SubscribeRequestSchema,
  Tool,
  ToolSchema,
  UnsubscribeRequestSchema,
  type Root,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import JSZip from "jszip";
import Stripe from "stripe";
import dotenv from "dotenv";
import { HttpsProxyAgent } from "https-proxy-agent";

// Load environment variables from .env file
dotenv.config();

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

const GetApiEndpointSchemaSchema = z.object({
  operationId: z
    .string()
    .describe(
      "The operationId of the API endpoint to get the schema for (e.g., 'PostCustomers', 'GetCharges')"
    ),
});

const InvokeApiEndpointSchema = z.object({
  operationId: z
    .string()
    .describe("The operationId of the API endpoint to invoke"),
  parameters: z
    .record(z.any())
    .optional()
    .describe(
      "Parameters to pass to the endpoint. Structure depends on the specific endpoint - use get-api-endpoint-schema to see required/optional fields."
    ),
});

// Helper function to convert OpenAPI schema to a simple JSON schema for MCP
// This extracts parameters from both query parameters and request body
function extractInputSchema(operation: any): any {
  const properties: any = {};
  const required: string[] = [];

  // Extract query/path parameters
  if (operation.parameters) {
    for (const param of operation.parameters) {
      if (param.schema) {
        properties[param.name] = {
          ...param.schema,
          description: param.description || "",
        };
        if (param.required) {
          required.push(param.name);
        }
      }
    }
  }

  // Extract request body parameters (for POST/PUT/PATCH)
  if (operation.requestBody?.content) {
    const formContent =
      operation.requestBody.content["application/x-www-form-urlencoded"];
    if (formContent?.schema?.properties) {
      Object.assign(properties, formContent.schema.properties);
      if (formContent.schema.required) {
        required.push(...formContent.schema.required);
      }
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };
}

export const createServer = () => {
  console.error("[MCP DEBUG] createServer called");
  // Load instructions and spec
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const instructionsPath = join(__dirname, "instructions.txt");
  const instructions = readFileSync(instructionsPath, "utf-8");
  const specPath = join(__dirname, "data", "spec3.clean.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8"));
  console.error("[MCP DEBUG] Loaded spec and instructions");

  const server = new Server(
    {
      name: "mcp-server-prototype",
      title: "MCP Server Prototype",
      version: "0.0.1",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
        logging: {},
        completions: {},
      },
      instructions: instructions,
    }
  );
  console.error("[MCP DEBUG] Server instance created");

  // Initialize Stripe client with API key from environment and version from spec
  const apiKey = process.env.STRIPE_API_KEY || "";
  const apiVersion = spec.info.version as Stripe.LatestApiVersion;

  // Configure proxy if environment variables are set
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
  const stripeConfig: Stripe.StripeConfig = {
    apiVersion: apiVersion,
  };

  if (proxyUrl) {
    console.error(
      `[MCP DEBUG] Configuring Stripe client to use proxy: ${proxyUrl}`
    );
    stripeConfig.httpAgent = new HttpsProxyAgent(proxyUrl);
  }

  const stripe = new Stripe(apiKey, stripeConfig);
  console.error(
    `[MCP DEBUG] Stripe client initialized with API version ${apiVersion}`
  );

  // Constants for path matching
  const topLevelRegex = /^\/v1\/[^\/]+$/;
  const detailLevelRegex = /^\/v1\/[^\/]+\/\{[^}]+\}$/;
  const httpMethods = ["get", "post", "put", "patch", "delete"];

  // Helper to find an operation in the spec by operationId
  function findOperationById(operationId: string): {
    operation: any;
    path: string;
    method: string;
  } | null {
    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      if (!topLevelRegex.test(path) && !detailLevelRegex.test(path)) continue;

      for (const method of httpMethods) {
        const operation = (pathItem as any)[method];
        if (operation && operation.operationId === operationId) {
          return { operation, path, method };
        }
      }
    }
    return null;
  }

  // Helper to list all operation IDs from the spec
  function listAllOperationIds(): string[] {
    const operationIds: string[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      if (!topLevelRegex.test(path) && !detailLevelRegex.test(path)) continue;

      for (const method of httpMethods) {
        const operation = (pathItem as any)[method];
        if (operation && operation.operationId) {
          operationIds.push(operation.operationId);
        }
      }
    }

    return operationIds;
  }

  // Helper to get operation schema by operationId
  function getOperationSchema(operationId: string): {
    operationId: string;
    path: string;
    method: string;
    description: string;
    parameters: any[];
    requestBody: any;
    responses: any;
  } | null {
    const found = findOperationById(operationId);
    if (!found) return null;

    return {
      operationId,
      path: found.path,
      method: found.method.toUpperCase(),
      description: found.operation.description || "",
      parameters: found.operation.parameters || [],
      requestBody: found.operation.requestBody || null,
      responses: found.operation.responses || {},
    };
  }

  // Helper to invoke a Stripe API endpoint by OpenAPI operationId
  async function invokeStripeByOperationId(
    operationId: string,
    parameters: Record<string, any> = {}
  ): Promise<any> {
    // Find the operation by operationId
    const found = findOperationById(operationId);
    if (!found) {
      throw new Error(`Operation \"${operationId}\" not found`);
    }

    const {
      operation: foundOperation,
      path: foundPath,
      method: foundMethod,
    } = found;

    // Parse the operationId to determine the Stripe SDK resource and method
    const resourcePath = operationId.replace(
      /^(Get|Post|Put|Patch|Delete)/,
      ""
    );

    // Convert resource path to Stripe SDK format
    const parts = resourcePath.split(/(?=[A-Z])/);

    // Detect if this is a detail operation by checking if the operationId has repeated resource name
    const firstPartSingular = parts[0].toLowerCase().replace(/s$/, "");
    const secondPart = parts[1]?.toLowerCase() || "";
    const isDetailOperation =
      parts.length > 1 && firstPartSingular === secondPart;

    // Determine the resource name for Stripe SDK
    let mainResource: string;
    if (isDetailOperation) {
      mainResource = parts[0].toLowerCase();
    } else {
      mainResource = parts[0].toLowerCase() + parts.slice(1).join("");
    }

    // Check if this is a singleton resource (no 's' at the end) or collection
    const isSingleton =
      !mainResource.endsWith("s") ||
      mainResource === "balance" ||
      mainResource === "account";

    const resource = (stripe as any)[mainResource];
    if (!resource) {
      throw new Error(
        `Stripe SDK resource not found for: ${mainResource} (from operationId: ${operationId})`
      );
    }

    const params = { ...(parameters || {}) } as Record<string, any>;

    // Extract path parameter name from the operation's parameters
    let pathParamName: string | null = null;
    if (foundOperation.parameters) {
      const pathParam = foundOperation.parameters.find(
        (p: any) => p.in === "path"
      );
      if (pathParam) {
        pathParamName = pathParam.name;
      }
    }

    // Make the API call based on the method and operation type
    let result: any;
    if (foundMethod === "get") {
      if (isSingleton) {
        result = await resource.retrieve(params);
      } else if (isDetailOperation) {
        const id = pathParamName ? params[pathParamName] : params.id;
        if (pathParamName) delete params[pathParamName];
        else delete params.id;
        result = await resource.retrieve(id, params);
      } else {
        result = await resource.list(params);
      }
    } else if (foundMethod === "post") {
      if (isDetailOperation) {
        const id = pathParamName ? params[pathParamName] : params.id;
        if (pathParamName) delete params[pathParamName];
        else delete params.id;
        result = await resource.update(id, params);
      } else {
        result = await resource.create(params);
      }
    } else if (foundMethod === "delete") {
      const id = pathParamName ? params[pathParamName] : params.id;
      if (pathParamName) delete params[pathParamName];
      else delete params.id;
      result = await resource.del(id, params);
    } else if (foundMethod === "patch" || foundMethod === "put") {
      const id = pathParamName ? params[pathParamName] : params.id;
      if (pathParamName) delete params[pathParamName];
      else delete params.id;
      result = await resource.update(id, params);
    }

    return result;
  }

  // Log client info during initialization
  server.setRequestHandler(InitializeRequestSchema, async (request) => {
    console.error("[MCP DEBUG] Initialize request received");
    console.error("[MCP DEBUG] Client Info:", JSON.stringify(request.params.clientInfo, null, 2));

    // Return the default initialization response
    // The SDK will handle the actual initialization logic
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
        logging: {},
      },
      serverInfo: {
        name: "mcp-server-prototype",
        version: "0.0.1",
      },
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("[MCP DEBUG] ListTools request received");
    const tools: Tool[] = [
      {
        name: "list-api-endpoints",
        description: `Search available Stripe API endpoints. Returns matching endpoints with brief descriptions.

        Common categories: payments, customers, subscriptions, invoices, refunds, disputes, payouts,
        billing, checkout, terminal, identity, radar, documentation, search, launchpad.

        Use this tool to discover which endpoints are available before calling get-api-endpoint-schema
        to learn more about specific endpoints.`,
        inputSchema: zodToJsonSchema(z.object({})) as ToolInput,
      },
      {
        name: "get-api-endpoint-schema",
        description: `Get detailed schema and documentation for one or more API endpoints.

        Use this after discovering endpoints with list-api-endpoints to understand required/optional
        parameters before calling invoke-api-endpoint.

        Returns full parameter schemas, response schemas, example requests, and documentation URLs.`,
        inputSchema: zodToJsonSchema(GetApiEndpointSchemaSchema) as ToolInput,
      },
      {
        name: "invoke-api-endpoint",
        description: `Invoke a Stripe API endpoint with provided parameters.

        Use get-api-endpoint-schema first to understand required parameters.

        This executes real API calls against the Stripe account. The results are subject to
        the same authentication, rate limiting, and permissions as direct tool calls.`,
        inputSchema: {
          type: "object",
          properties: {
            operationId: {
              type: "string",
              description: "The operationId of the API endpoint to invoke",
            },
            parameters: {
              type: "object",
              description:
                "Parameters to pass to the endpoint. Structure depends on the specific endpoint - use get-api-endpoint-schema to see required/optional fields.",
              additionalProperties: true,
            },
          },
          required: ["operationId", "parameters"],
          additionalProperties: false,
        } as ToolInput,
      },
    ];

    console.error(`[MCP DEBUG] Returning ${tools.length} tools`);
    return { tools };
  });

  // Helper to handle the list-api-endpoints tool
  function handleListApiEndpointsTool() {
    console.error("[MCP DEBUG] handleListApiEndpointsTool called");
    const operationIds = listAllOperationIds();
    console.error(`[MCP DEBUG] Found ${operationIds.length} operation IDs`);
    return {
      content: [
        {
          type: "text",
          text: `Available API endpoints (${
            operationIds.length
          } total): ${operationIds.sort().join(", ")}`,
          description: `Use the get-api-endpoint-schema tool to get the schema for a given API endpoint as input into invoke-api-endpoint. Call this before invoke-api-endpoint.`,
        },
      ],
    };
  }

  // Helper to handle the get-api-endpoint-schema tool
  function handleGetApiEndpointSchemaTool(args: any) {
    console.error(
      "[MCP DEBUG] handleGetApiEndpointSchemaTool called with:",
      args
    );
    const operationIdToFind = args?.operationId;

    if (!operationIdToFind) {
      return {
        content: [
          {
            type: "text",
            text: 'Error: operationId parameter is required. Example: {"operationId": "PostCustomers"}',
          },
        ],
      };
    }

    const schema = getOperationSchema(operationIdToFind);
    if (!schema) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Operation "${operationIdToFind}" not found. Use list-api-endpoints to see available operations.`,
          },
        ],
      };
    }

    // Extract parameter names from the schema to create an example invocation
    const requestBodyProps =
      schema.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema
        ?.properties || {};
    const requiredParameters =
      schema.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema
        ?.required;
    const exampleParameters: Record<string, string> = {};

    Object.keys(requestBodyProps).forEach((key) => {
      exampleParameters[key] = `<provide_${key}_value>`;
    });

    // console.error("[MCP DEBUG] schema:", JSON.stringify(schema, null, 2));

    // Add the example invocation to help the LLM understand how to call invoke-api-endpoint
    const schemaWithExample = {
      ...schema,
      example_invocation: {
        tool: "invoke-api-endpoint",
        operationId: operationIdToFind,
        parameters: exampleParameters,
        required_parameters: requiredParameters,
        note: "Replace the placeholder values (e.g., <provide_name_value>) with actual values from the user's request. IMPORTANT: The required parameters must be included in the parameters object.",
      },
    };

    console.error("[MCP DEBUG] schemaWithExample:", schemaWithExample);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(schemaWithExample, null, 2),
        },
      ],
    };
  }

  // Helper to handle the invoke-api-endpoint tool
  async function handleInvokeApiEndpointTool(args: any) {
    console.error("[MCP DEBUG] handleInvokeApiEndpointTool called with:", args);
    try {
      const validatedArgs = InvokeApiEndpointSchema.parse(args) as {
        operationId: string;
        parameters?: Record<string, any>;
      };
      console.error(
        `[MCP DEBUG] Invoking Stripe API: ${validatedArgs.operationId}`
      );
      const result = await invokeStripeByOperationId(
        validatedArgs.operationId,
        validatedArgs.parameters || {}
      );
      console.error(
        `[MCP DEBUG] Stripe API call succeeded for ${validatedArgs.operationId}`
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
            description: `The result of the API call.`,
          },
        ],
      };
    } catch (error: any) {
      console.error("[MCP DEBUG] Error in handleInvokeApiEndpointTool:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error calling Stripe API: ${error.message}\n\nStack: ${error.stack}`,
          },
        ],
      };
    }
  }

  // Helper to handle fallback tool invocation (operationId as tool name)
  async function handleFallbackToolInvocation(name: string, args: any) {
    try {
      const result = await invokeStripeByOperationId(name, args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      if (
        typeof error?.message === "string" &&
        error.message.includes("not found")
      ) {
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Error calling Stripe API: ${error.message}\n\nStack: ${error.stack}`,
          },
        ],
      };
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error(`[MCP DEBUG] CallTool request received for tool: ${name}`);

    let result;
    switch (name) {
      case "list-api-endpoints":
        result = handleListApiEndpointsTool();
        break;
      case "get-api-endpoint-schema":
        result = handleGetApiEndpointSchemaTool(args);
        break;
      case "invoke-api-endpoint":
        result = await handleInvokeApiEndpointTool(args);
        break;
      default:
        result = await handleFallbackToolInvocation(name, args);
        break;
    }
    console.error(
      `[MCP DEBUG] CallTool handler for ${name} completed, returning result`
    );
    return result;
  });

  console.error("[MCP DEBUG] All request handlers registered");
  return { server };
};
