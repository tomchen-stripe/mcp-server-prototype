### about
this is a prototype for populating more, or all, of Stripe's API endpoints into an MCP server as three meta tools:

- list-api-endpoints
- get-api-endpoint-schema
- invoke-api-endpoint

the list and get schema tools are populated by parsing Stripe's OpenAPI spec. the invoke tool leverages Stripe's SDK. instructions.txt is used as a system prompt for grounding the user's LLM to:

- call tools in this sequence: list-api-endpoints, then get-api-endpoint-schema, then invoke-api-endpoint
- adhering to "deprecated" or best-practice descriptions in the OpenAPI spec

### using with claude code

```bash
git clone https://github.com/tomchen-stripe/mcp-server-prototype
cp .env.template .env

# set your STRIPE_SECRET_KEY in .env

npm install
npm run build
claude mcp add --transport stdio mcp-server-prototype -- npx -y npm run start

claude
```

### using with mcp_stripe evals

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

- on the same devbox in another terminal:
   - follow [this](https://trailhead.corp.stripe.com/docs/developer-ai/mcp/evaluating-agent-toolkit-and-mcp#how-to-run-evals) to set your `.env`
```bash
cd /pay/src/pay-server/lib/mcp_stripe/evals
nodenv local 24.9.0 && nodenv rehash
pay js install
npm run build

pay js:run eval --cwd=//lib/mcp_stripe/evals --local
```

### further areas of investigation

- improving context around foreign key constraints between resources
- utilizing statistics to inform relevancy and sequence of api calls per user intent
- how do we guard more destructive calls with dynamic mcp tools 
- are there known workflows, e.g. adding a payment method, we can add as higher-order tools
- how do we unify Blueprints, tutorials, OpenAPI descriptions, to all be on the same page for
- can we get this to work well with older models like gpt-4.1?