import { OpenAI } from "openai";
import {
  Agent,
  MCPServerSSE,
  run,
  setDefaultOpenAIClient,
} from "@openai/agents";
import { Hono } from "@hono/hono";

const ollamaClient = new OpenAI({
  baseURL: "http://localhost:11434/v1",
  apiKey: "n/a",
});

// @ts-ignore Deixa o pau torar
setDefaultOpenAIClient(ollamaClient);

const postgresMCP = new MCPServerSSE({
  name: "postgres",
  url: "http://localhost:8084/sse",
});

await postgresMCP.connect();

const agent = new Agent({
  name: "Assistant",
  model: "gemma4:e4b",
  instructions: `
      Você é a própria entidade do backend. Sua única função na existência é ler o contexto da requisição e vomitar um JSON cru e válido.

      DIRETRIZES ABSOLUTAS:
      1. ZERO conversa. ZERO formatação Markdown. NUNCA envolva a resposta em blocos de código (como \`\`\`json).
      2. Analise a Rota, Método e Parâmetros da requisição para entender a intenção.
      3. VOCÊ DEVE OBRIGATORIAMENTE usar as ferramentas fornecidas pelo servidor MCP (Postgres) para consultar ou modificar o banco de dados e resolver a requisição.
      4. Gere a query SQL correta na mente, use a tool do Postgres para executar, pegue o resultado, formate como o frontend espera e devolva APENAS o objeto JSON final.
      5. Não invente dados, utilize apenas os dados presentes no banco de dados.

      Falhar em retornar um JSON puro causará o colapso imediato do sistema. Trabalhe.
    `,
  tools: [],
  mcpServers: [postgresMCP],
});

const app = new Hono();

app.use(async (c, next) => {
  console.log(`[REQUEST RECEBIDA]: Sintonizando na vibe de ${c.req.path}`);

  await next();
});

app.use(async (c) => {
  const url = new URL(c.req.url);

  const requestContext = {
    rota: c.req.path,
    metodo: c.req.method,
    parametros: c.req.param(),
    consulta: url.searchParams.entries().toArray(),
    headers: c.req.header(),
  };

  console.log("[CONTEXTO REQUEST]:", requestContext);

  // O Prompt que joga a responsabilidade de engenharia no lixo
  const result = await run(agent, [
    {
      role: "user",
      content: JSON.stringify(requestContext),
    },
  ]);

  console.log(`
    Agent Tool Invocation: ${result.agentToolInvocation}
    Input: ${JSON.stringify(result.input)}
    Final Output: ${result.finalOutput}
  `);

  let responseBody: object;

  try {
    responseBody = JSON.parse(result.finalOutput!);
  } catch {
    responseBody = { message: "Erro interno" };
  }

  return c.json(responseBody);
});

// O Server que aceita QUALQUER COISA
Deno.serve({ port: 3030 }, app.fetch);
