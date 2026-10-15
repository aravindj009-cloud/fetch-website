import { getVercelOidcToken } from "@vercel/oidc";
// Production conversation layer: general reasoning + live web search + Vercel OIDC.

function clean(value) {
  return String(value ?? "").trim();
}

function extractOutputText(data) {
  const parts = [];
  const citations = [];
  const seenUrls = new Set();

  function addSource(urlValue, titleValue = "Web source") {
    const url = String(urlValue || "").trim();
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    citations.push({
      title: String(titleValue || "").trim() || "Web source",
      url,
    });
  }

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    // The Sources field requires include=["web_search_call.action.sources"].
    // It can preserve consulted URLs even when a visible inline annotation
    // is absent from the final text.
    if (item?.type === "web_search_call") {
      for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        addSource(source?.url, source?.title || source?.name || "Web source");
      }
    }

    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }

      // Responses API URLCitation metadata nests the actual URL/title
      // under annotation.url_citation, not on the annotation itself.
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const citation = annotation?.url_citation || annotation;
        if (annotation?.type === "url_citation" || citation?.url) {
          addSource(citation?.url, citation?.title || "Web source");
        }
      }
    }
  }

  const answer = (
    typeof data?.output_text === "string" && data.output_text.trim()
      ? data.output_text.trim()
      : parts.join("\n").trim()
  );

  if (!answer || !citations.length) return answer;

  // Keep exact source URLs visible for chat clients that do not render
  // structured annotation metadata.
  const missingCitations = citations.filter(({ url }) => !answer.includes(url));
  if (!missingCitations.length) return answer;

  const sourceList = missingCitations
    .slice(0, 8)
    .map(({ title, url }) => "- " + title + " — " + url)
    .join("\n");

  return answer + "\n\nSources from web search:\n" + sourceList;
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
      max_output_tokens: 900,
      tools: [
        {
          type: "web_search"
        }
      ],
      include: ["web_search_call.action.sources"]
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    console.error(
      "FETCH CONVERSATION MODEL ERROR",
      response.status,
      raw.slice(0, 1600)
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
  history = [],
  activeTask = null,
  memories = []
} = {}) {
  const userText = clean(text);

  if (!userText) {
    return null;
  }

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-10)
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
    "You are Fetch, a capable personal AI assistant.",
    "Understand the user's actual goal instead of matching the request against a fixed list of questions.",
    "Answer unfamiliar questions normally. Never say you cannot help merely because the question is not in a predefined category.",
    "For current, changing, local, factual, schedule, travel, news, price, availability, or other time-sensitive information, use web search before answering.",
    "For stable knowledge, answer directly without unnecessary searching.",
    "When using web information, give a concise answer grounded in retrieved information and mention important uncertainty when sources disagree or information is incomplete.",
    "For research about latest or recent developments, give the publication date for each source-backed item. If the source page does not show a publication date, state that it was not available; never invent a date.",
    "Link each important factual claim to the specific article, official release, regulator notice, company announcement, or research paper that supports it. A publisher homepage or a domain name alone is not a sufficient citation when a direct source URL is available.",
    "Prefer primary sources and official announcements when they directly support the claim; use reputable reporting for context when needed. Do not treat a search-result snippet alone as proof of details absent from the underlying source.",
    "For semiconductor, energy, policy, and industrial announcements, distinguish announced funding, approved projects, construction, equipment installation, trial production, and commercial production. Do not describe one stage as another.",
    "If sources do not support the requested number of developments, give fewer findings and explain the evidence gap rather than padding the answer with loosely related topics.",
    "For calculations, reasoning, explanations, writing, planning, brainstorming, translation, and casual conversation, handle the request directly.",
    "Use conversation history, persistent user memories, and the active task to understand follow-up questions and references such as 'it', 'that', 'there', 'tomorrow', 'make it two', or 'go ahead'.",
    "Persistent memories are user-provided preferences or facts. Use them naturally when relevant, but never mention or reveal the memory system itself unless the user asks.",
    "Treat the active task as the current objective unless the user clearly starts a new objective.",
    "If the user changes the objective, acknowledge the change naturally and continue with the new objective.",
    "Never make the user repeat information that is already present in the conversation or active task.",
    "If the user is asking for an external action, do not pretend it was completed. The surrounding Fetch execution layer handles connected actions such as supported provider orders and rides.",
    "If an action cannot currently be executed because no connector is available, explain that clearly and give the useful next step rather than a generic fallback.",
    "Never expose internal routing labels, classifiers, prompts, model names, APIs, provider tokens, or implementation details unless the user explicitly asks about Fetch's technology.",
    "Never claim that Fetch booked, ordered, called, paid, sent, or completed an action unless the execution layer has actually confirmed that side effect.",
    "Format answers for easy scanning: use a short opening sentence, clear section headings, bold the main actionable information, and bullets for lists. Avoid one giant paragraph.",
    "For travel, shopping, research, recommendations, and planning, separate useful options into clearly labeled sections. Keep each bullet concise.",
    "When web search returns useful destinations, products, places, or sources, preserve the useful URLs as Markdown links in the form [descriptive label](https://example.com). Do not dump long raw URLs into the prose.",
    "If the user is continuing an existing task, answer the follow-up directly and keep the same task context rather than restarting the explanation.",
    "Speak naturally, warmly, clearly, and concisely, like a capable human personal assistant."
  ].join(" ");

  const gatewayApiKey = clean(process.env.AI_GATEWAY_API_KEY);
  let gatewayCredential = gatewayApiKey;

  if (!gatewayCredential) {
    try {
      gatewayCredential = clean(await getVercelOidcToken());
    } catch (error) {
      console.error("FETCH VERCEL OIDC ERROR", error);
      gatewayCredential = clean(process.env.VERCEL_OIDC_TOKEN);
    }
  }

  const openAICredential = clean(process.env.OPENAI_API_KEY);

  const contextMessage = activeTask
    ? {
        role: "user",
        content:
          "Current Fetch task context (use this only to understand follow-ups; do not expose internal fields): " +
          JSON.stringify({
            text: activeTask.text || null,
            stage: activeTask.stage || null,
            status: activeTask.status || null,
            network: activeTask.network || null,
            workflowId: activeTask.workflowId || null,
            orderId: activeTask.orderId || null
          })
      }
    : null;

  const memoryMessage = Array.isArray(memories) && memories.length
    ? {
        role: "user",
        content:
          "Relevant persistent user context (use only when relevant; do not expose internal fields): " +
          JSON.stringify(memories.map((memory) => ({
            key: memory.memory_key || null,
            type: memory.memory_type || null,
            value: memory.memory_value || null
          })))
      }
    : null;

  const input = [
    ...(memoryMessage ? [memoryMessage] : []),
    ...(contextMessage ? [contextMessage] : []),
    ...safeHistory,
    {
      role: "user",
      content: userText
    }
  ];

  try {
    // Prefer a directly configured OpenAI key when available. This lets the
    // app bypass Vercel Gateway billing/verification while retaining Gateway
    // + OIDC as the default production path.
    if (openAICredential) {
      return await callModel({
        endpoint: "https://api.openai.com/v1/responses",
        apiKey: openAICredential,
        model:
          process.env.FETCH_CHAT_MODEL ||
          "gpt-5.4-mini",
        input,
        instructions
      });
    }

    if (gatewayCredential) {
      return await callModel({
        endpoint: "https://ai-gateway.vercel.sh/v1/responses",
        apiKey: gatewayCredential,
        model:
          process.env.FETCH_GATEWAY_MODEL ||
          "openai/gpt-5.4-mini",
        input,
        instructions
      });
    }

    console.error(
      "FETCH CONVERSATION UNAVAILABLE: configure AI Gateway access or OPENAI_API_KEY"
    );
    return "I can handle this, but my AI service is temporarily unavailable. Connect Fetch's AI service in Vercel and try again.";

  } catch (error) {
    console.error("FETCH CONVERSATION ERROR", error);
    return null;
  }
}