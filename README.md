### about
this is a prototype of an mcp server that dynamically populates 176 (out of 572) of Stripe's APIs through [three MCP metatools](https://www.stainless.com/blog/lessons-from-openapi-to-mcp-server-conversion#handling-large-apis-dynamically):

- list-api-endpoints
- get-api-endpoint-schema
- invoke-api-endpoint

176 APIs are programmatically parsed from top-level APIs in [Stripe's OpenAPI spec](https://raw.githubusercontent.com/stripe/openapi/refs/heads/master/openapi/spec3.json).

* [Included APIs](https://github.com/tomchen-stripe/mcp-server-response-token-sizes/blob/main/apis/included.csv)
* [Not-included APIs](https://github.com/tomchen-stripe/mcp-server-response-token-sizes/blob/main/apis/not-included.csv)
* [All APIs](https://github.com/tomchen-stripe/mcp-server-response-token-sizes/blob/main/apis/all.csv)

[instructions.txt](instructions.txt) is used as a system prompt for grounding the user's LLM to:

- call tools in this sequence: list-api-endpoints, then get-api-endpoint-schema, then invoke-api-endpoint
- adhering to "deprecated" or best-practice descriptions in the OpenAPI spec

### example

Prompt: `update the prices of all my products to be 10 dollars more than they are` (5-6 step workflow):
- [sample output](https://gist.github.com/tomchen-stripe/979642e8ff35a0299e7e675b597bfe48)

### using with claude code (laptop or devbox)

```bash
git clone https://github.com/tomchen-stripe/mcp-server-prototype
cp .env.template .env

# set your STRIPE_SECRET_KEY in .env

npm install
npm run build
claude mcp add --transport stdio mcp-server-prototype -- npx -y npm run start

claude
```

### using with mcp_stripe evals (devbox)

- apply this PR as a patch: https://git.corp.stripe.com/stripe-internal/pay-server/pull/1235888
- on a devbox:
```bash
cd ~/stripe
git clone https://github.com/tomchen-stripe/mcp-server-prototype
cp .env.template .env

# set your STRIPE_SECRET_KEY in .env

npm install
npm run build
npm run start streamableHttp
```

Then follow: https://stripe.sourcegraphcloud.com/stripe-internal/pay-server/-/blob/lib/mcp_stripe/evals/README.md

### usage arguments

```bash
npm run start <stdio|streamableHttp> <static|dynamic>
```

`<stdio|streamableHttp>`: protocol to talk to MCP server (default: stdio)

`<static|dynamic|code>`: 
   * static (default): all 176 tools are listed statically during `tools/list` response
   * dynamic: all 176 tools are returned in a response from the static `list-api-endpoints` tool during `tools/list` response
   * code: [code execution](https://www.anthropic.com/engineering/code-execution-with-mcp)