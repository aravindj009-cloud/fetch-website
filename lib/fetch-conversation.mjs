function clean(value) {
  return String(value ?? "").trim();
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function isActionRequest(text) {
  const value = clean(text).toLowerCase();

  return [
    /\b(uber|rapido|cab|taxi|ride|bike taxi|auto|airport ride)\b/,
    /\b(book|request|schedule|reserve)\b.*\b(ride|cab|taxi|uber|rapido)\b/,
    /\b(buy|get me|bring me|fetch me|deliver|order|purchase)\b.*\b(milk|bread|eggs|grocer|grocery|kitkat|rice|water|snack|biscuit)\b/,
    /\b(send|text|email|call)\b.*\b(to|my|him|her|them)\b/
  ].some((pattern) => pattern.test(value));
}

async function callModel({
  endpoint,
  apiKey,
  model,
  input,
  instructions
}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 600
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    console.error(
      "FETCH CONVERSATION MODEL ERROR",
      response.status,
      raw.slice(0, 1200)
    );
    return null;
  }

  let data;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("FETCH CONVERSATION JSON ERROR", error);
    return null;
  }

  return extractOutputText(data) || null;
}

export async function answerFetchConversation({
  text,
  history = []
} = {}) {
  const userText = clean(text);

  if (!userText || isActionRequest(userText)) {
    return null;
  }

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .filter(
          (item) =>
            item &&
            (item.role === "user" || item.role === "assistant")
        )
        .map((item) => ({
          role: item.role,
          content: clean(item.text)
        }))
        .filter((item) => item.content)
    : [];

  const instructions = [
    "You are Fetch, a personal AI assistant.",
    "Speak naturally, warmly, clearly and concisely, like a capable human assistant.",
    "Answer the user's question directly instead of describing what you are doing internally.",
    "For casual conversation, respond conversationally.",
    "For informational questions, explain the answer clearly and accurately.",
    "Use the conversation context when relevant.",
    "Never claim that Fetch booked, ordered, called, paid, sent, or completed an action unless a connected execution provider has actually confirmed that side effect.",
    "If a request is an action that requires a provider, let the execution layer handle it.",
    "Never mention ATC, routing, classifiers, prompts, models, APIs, providers, or implementation details unless the user explicitly asks.",
    "Do not expose internal status labels such as RESOURCE_MATCHED or GENERAL_AGENT.",
    "The user should feel like they are talking to a personal assistant, not a developer console."
  ].join(" ");

  /*
   * Prefer Vercel AI Gateway when available. Vercel deployments can expose
   * a short-lived OIDC credential, while AI_GATEWAY_API_KEY can be supplied
   * explicitly. Fall back to a direct OpenAI API key for local/legacy setups.
   */
  const gatewayCredential = clean(
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN
  );

  const openAICredential = clean(process.env.OPENAI_API_KEY);

  const input = [
    ...safeHistory,
    {
      role: "user",
      content: userText
    }
  ];

  try {
    if (gatewayCredential) {
      return await callModel({
        endpoint: "https://ai-gateway.vercel.sh/v1/responses",
        apiKey: gatewayCredential,
        model:
          process.env.FETCH_GATEWAY_MODEL ||
          "openai/gpt-5.6-luna",
        input,
        instructions
      });
    }

    if (openAICredential) {
      return await callModel({
        endpoint: "https://api.openai.com/v1/responses",
        apiKey: openAICredential,
        model:
          process.env.FETCH_CHAT_MODEL ||
          "gpt-5.6-luna",
        input,
        instructions
      });
    }

    console.error(
      "FETCH CONVERSATION AUTH MISSING: set AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or OPENAI_API_KEY"
    );
    return null;
  } catch (error) {
    console.error("FETCH CONVERSATION ERROR", error);
    return null;
  }
}
