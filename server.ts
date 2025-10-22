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

// Load environment variables from .env file
dotenv.config();

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

const EchoSchema = z.object({
  message: z.string().describe("Message to echo"),
});

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
    .describe("The parameters to pass to the API endpoint"),
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
  // Load instructions and spec
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const instructionsPath = join(__dirname, "instructions.txt");
  const instructions = readFileSync(instructionsPath, "utf-8");
  const specPath = join(__dirname, "data", "spec3.clean.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8"));

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

  // Initialize Stripe client with API key from environment and version from spec
  const apiKey = process.env.STRIPE_API_KEY || "";
  const apiVersion = spec.info.version as Stripe.LatestApiVersion;
  const stripe = new Stripe(apiKey, {
    apiVersion: apiVersion,
  });

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

    const { operation: foundOperation, path: foundPath, method: foundMethod } = found;

    // Parse the operationId to determine the Stripe SDK resource and method
    const resourcePath = operationId.replace(/^(Get|Post|Put|Patch|Delete)/, "");

    // Convert resource path to Stripe SDK format
    const parts = resourcePath.split(/(?=[A-Z])/);

    // Detect if this is a detail operation by checking if the operationId has repeated resource name
    const firstPartSingular = parts[0].toLowerCase().replace(/s$/, "");
    const secondPart = parts[1]?.toLowerCase() || "";
    const isDetailOperation = parts.length > 1 && firstPartSingular === secondPart;

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
      const pathParam = foundOperation.parameters.find((p: any) => p.in === "path");
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

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      {
        name: "echo",
        description: "Echoes back the input",
        inputSchema: zodToJsonSchema(EchoSchema) as ToolInput,
      },
      {
        name: "list-api-endpoints",
        description: "List all API endpoints. Next, use get-api-endpoint-schema to get the schema for a given API endpoint",
        inputSchema: zodToJsonSchema(z.object({})) as ToolInput,
      },
      {
        name: "get-api-endpoint-schema",
        description:
          "Get the OpenAPI schema for a given API endpoint by operationId. Next, use invoke-api-endpoint to invoke the API endpoint with the appropriate parameters",
        inputSchema: zodToJsonSchema(GetApiEndpointSchemaSchema) as ToolInput,
      },
      {
        name: "invoke-api-endpoint",
        description:
          "Invoke a given API endpoint with the appropriate parameters",
        inputSchema: zodToJsonSchema(InvokeApiEndpointSchema) as ToolInput,
      },
    ];

    // Extract all operations from top-level /v1/{resource} and /v1/{resource}/{id} paths
    // Note: Currently commented out to limit the number of tools
    // const operationIds = listAllOperationIds();
    // for (const operationId of operationIds) {
    //   const schema = getOperationSchema(operationId);
    //   if (!schema) continue;
    //
    //   console.error('[log] adding tool: ', operationId);
    //
    //   // Build description from operation
    //   const description = schema.description
    //     ? schema.description.replace(/<[^>]*>/g, '').substring(0, 200)
    //     : `${schema.method} ${schema.path}`;
    //
    //   // Extract the input schema from OpenAPI spec
    //   const inputSchema = extractInputSchema(schema);
    //
    //   // tools.push({
    //   //   name: operationId,
    //   //   description: description,
    //   //   inputSchema: inputSchema as ToolInput,
    //   // });
    // }

    return { tools };
  });

  // Helper to handle the echo tool
  function handleEchoTool(args: any) {
    const validatedArgs = EchoSchema.parse(args);
    return {
      content: [{ type: "text", text: `Echo: ${validatedArgs.message}` }],
    };
  }

  // Helper to handle the list-api-endpoints tool
  function handleListApiEndpointsTool() {
    const operationIds = listAllOperationIds();
    return {
      content: [
        {
          type: "text",
          text: `Available API endpoints (${
            operationIds.length
          } total):\n\n${operationIds.sort().join("\n")}`,
          description: `Use the get-api-endpoint-schema tool to get the schema for a given API endpoint`,
        },
      ],
    };
  }

  // Helper to handle the get-api-endpoint-schema tool
  function handleGetApiEndpointSchemaTool(args: any) {
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(schema, null, 2),
        },
      ],
    };
  }

  // Helper to handle the invoke-api-endpoint tool
  async function handleInvokeApiEndpointTool(args: any) {
    try {
      const validatedArgs = InvokeApiEndpointSchema.parse(args) as {
        operationId: string;
        parameters?: Record<string, any>;
      };
      const result = await invokeStripeByOperationId(
        validatedArgs.operationId,
        validatedArgs.parameters || {}
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
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
      if (typeof error?.message === "string" && error.message.includes("not found")) {
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

    switch (name) {
      case "echo":
        return handleEchoTool(args);
      case "list-api-endpoints":
        return handleListApiEndpointsTool();
      case "get-api-endpoint-schema":
        return handleGetApiEndpointSchemaTool(args);
      case "invoke-api-endpoint":
        return await handleInvokeApiEndpointTool(args);
      default:
        return await handleFallbackToolInvocation(name, args);
    }
  });

  return { server };
};
