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

### results

Manual testing:

✅ Prompt: `update the prices of all my products to be 10 dollars more than they are` (5-6 step workflow):
- [sample output](https://gist.github.com/tomchen-stripe/979642e8ff35a0299e7e675b597bfe48)

Next steps are to run more evals for this approach.

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

- on the same devbox in another terminal:
   - follow [this](https://trailhead.corp.stripe.com/docs/developer-ai/mcp/evaluating-agent-toolkit-and-mcp#how-to-run-evals) to set your `.env`
```bash
cd /pay/src/pay-server/lib/mcp_stripe/evals
nodenv local 24.9.0 && nodenv rehash
pay js install
npm run build

pay js:run eval --cwd=//lib/mcp_stripe/evals --local
```

### further areas of investigation for this approach

- will we run into token (context window or response size) limits
   - short answer: not for sota 2025+ models, but yes for older 2024- models, [results here](https://github.com/tomchen-stripe/mcp-server-response-token-sizes)
- running evals on how good newer/sota models are parsing and following complex OpenAPI schemas
- running evals on how good newer/sota models are at orchestrating the right tools in a world where there are hundred
   - if there are workflows that are hard for the LLM to orchestrate, can we just provide a MCP tool that does it?
- how do different sota models (gpt family, anthropic family, etc) perform?
- how do we guard more destructive calls with dynamic mcp tools 
- can we get this to work well with older models like gpt-4.1 or do we preserve the old experience for older models?