### about
this is a prototype for populating more, or all, of Stripe's API endpoints into an MCP server as three meta tools:

- list-api-endpoints
- get-api-endpoint-schema
- invoke-api-endpoint

the list and get schema tools are populated by parsing Stripe's OpenAPI spec. the invoke tool leverages Stripe's SDK. instructions.txt is used as a system prompt for grounding the user's LLM to:

- call tools in this sequence: list-api-endpoints, then get-api-endpoint-schema, then invoke-api-endpoint
- adhering to "deprecated" or best-practice descriptions in the OpenAPI spec

### further areas of investigation

- improving context around foreign key constraints between resources
- utilizing statistics to inform relevancy and sequence of api calls per user intent
- how do we guard more destructive calls with dynamic mcp tools 
- are there known workflows, e.g. adding a payment method, we can add as higher-order tools
- how do we unify Blueprints, tutorials, OpenAPI descriptions, to all be on the same page for