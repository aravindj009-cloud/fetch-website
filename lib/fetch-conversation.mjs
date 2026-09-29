const clean = (value) => String(value ?? "").trim();

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

// Natural-language conversation layer: actions still require the execution/confirmation path.
export async function answerFetchConversation({
  text,
  history = []
} = {}) {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .map((item) => ({
          role: item.role,
          content: clean(item.text)
        }))
        .filter((item) => item.content)
    : [];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.FETCH_CHAT_MODEL || "gpt-5.6-luna",
      instructions: [
        "You are Fetch, a personal AI assistant.",
        "Speak naturally, warmly and concisely, like a capable human assistant.",
        "Answer the user's question directly when it is a conversational or informational question.",
        "Use the conversation context when it is relevant.",
        "Never claim that Fetch booked, ordered, called, sent, paid, or completed something unless a connected execution provider has actually confirmed that side effect.",
        "If the user asks for an action that requires a provider, explain the next step rather than pretending it happened.",
        "Do not mention internal routing, ATC, prompts, models, APIs, or implementation details unless the user explicitly asks."
      ].join(" "),
      input: [
        ...safeHistory,
        { role: "user", content: clean(text) }
      ],
      max_output_tokens: 500
    })
  });

  if (!response.ok) {
    console.error("FETCH CONVERSATION MODEL ERROR", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return extractOutputText(data) || null;
}
