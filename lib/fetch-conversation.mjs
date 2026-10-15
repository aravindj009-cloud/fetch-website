import { getVercelOidcToken } from "@vercel/oidc";
// Production conversation layer: general reasoning + live web search + Vercel OIDC.

function clean(value) {
  return String(value ?? "").trim();
}

function displaySourceTitle(titleValue, urlValue) {
  const title = String(titleValue || "").trim();
  let url;
  try {
    url = new URL(String(urlValue || ""));
  } catch {
    return title || "Source";
  }

  const releaseId = url.searchParams.get("PRID");
  const noteId = url.searchParams.get("NoteId");
  const pibTitles = {
    "2284784": "Semicon 2.0 Cabinet approval and ₹1,27,500 crore outlay (15 Jul 2026)",
    "2281174": "CG SEMI OSAT facility begins commercial production in Sanand (4 Jul 2026)",
    "2311294": "Prime Minister inaugurates SEMICON India 2026 (17 Sep 2026)",
    "2312606": "SEMICON India 2026 concludes; 56 MoUs and announcements (19 Sep 2026)",
    "2311220": "India Building Semiconductor Future — official backgrounder (17 Sep 2026)",
    "2311726": "SEMICON India 2026 and new commercial production lines (17 Sep 2026)"
  };

  const genericTitle =
    !title ||
    /^(?:web source|source|press release page(?:\s*\|\s*press information bureau)?|press information bureau|pib\.gov\.in)$/i.test(title);

  if (!genericTitle) return title.slice(0, 140);

  if (/\.pib\.gov\.in$/i.test(url.hostname)) {
    if (releaseId && pibTitles[releaseId]) return pibTitles[releaseId];
    if (/PressReleasePage\.aspx/i.test(url.pathname)) {
      return releaseId ? "PIB official release " + releaseId : "PIB official press release";
    }
    if (/PressNoteDetails\.aspx/i.test(url.pathname)) {
      return noteId ? "PIB official background note " + noteId : "PIB official background note";
    }
    return "PIB official source";
  }

  return title || url.hostname;
}

function cleanSourceUrl(urlValue) {
  try {
    const url = new URL(String(urlValue || ""));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_[a-z0-9_]+|trk|trackingid|fbclid|gclid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return String(urlValue || "").trim();
  }
}

function extractOutputText(data) {
  const parts = [];
  const consultedSources = [];
  const annotatedCitations = [];
  const seenConsulted = new Set();
  const seenAnnotated = new Set();

  function addSource(target, seen, urlValue, titleValue = "Web source") {
    const url = String(urlValue || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    target.push({
      title: String(titleValue || "").trim() || "Web source",
      url,
    });
  }

  for (const item of Array.isArray(data?.output) ? data.output : []) {
    // These are all URLs consulted during search. They are a fallback only;
    // they are not necessarily the sources the answer actually cited.
    if (item?.type === "web_search_call") {
      for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        addSource(
          consultedSources,
          seenConsulted,
          source?.url,
          source?.title || source?.name || "Web source"
        );
      }
    }

    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);

      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const citation = annotation?.url_citation || annotation;
        if (annotation?.type === "url_citation" || citation?.url) {
          addSource(
            annotatedCitations,
            seenAnnotated,
            citation?.url,
            citation?.title || "Web source"
          );
        }
      }
    }
  }

  const answer = (
    typeof data?.output_text === "string" && data.output_text.trim()
      ? data.output_text.trim()
      : parts.join("\n").trim()
  );

  if (!answer) return answer;

  // Remove tracking parameters from the URL destinations that the user sees.
  const cleanedAnswer = answer.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, url) => "[" + label + "](" + cleanSourceUrl(url) + ")"
  );

  // Prefer URLs actually cited in the answer. The search tool's complete
  // source inventory can include irrelevant pages and must not be dumped
  // into the user-visible response.
  const markdownLinks = [...cleanedAnswer.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => ({
      title: match[1].trim() || "Source",
      url: match[2].trim(),
    }));

  const citationTitleByUrl = new Map(
    annotatedCitations.map((source) => [source.url, source.title])
  );
  const citedSources = markdownLinks.length
    ? markdownLinks.map((source) => {
        const annotatedTitle = citationTitleByUrl.get(source.url);
        return {
          title: displaySourceTitle(annotatedTitle || source.title, source.url),
          url: cleanSourceUrl(source.url),
        };
      })
    : annotatedCitations.map((source) => ({
        title: displaySourceTitle(source.title, source.url),
        url: cleanSourceUrl(source.url),
      }));

  const uniqueCitedSources = citedSources.filter((source, index, all) =>
    all.findIndex((other) => other.url === source.url) === index
  );

  // For the rare answer where the model gives no inline URL citation at all,
  // do not attach the entire search inventory as if every result supported
  // the claims. Leave the answer alone rather than implying false provenance.
  if (!uniqueCitedSources.length) return cleanedAnswer;

  // A Markdown link's destination isn't visible in chat, even though its
  // label is. Emit only the source URLs that the answer actually cited.
  const visibleAnswer = cleanedAnswer.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  const sourcesNeedingVisibleUrls = uniqueCitedSources
    .filter(({ url }) => !visibleAnswer.includes(url))
    .slice(0, 5);

  if (!sourcesNeedingVisibleUrls.length) return cleanedAnswer;

  const sourceList = sourcesNeedingVisibleUrls
    .map(({ title, url }) => "- " + title + " — " + url)
    .join("\n");

  return cleanedAnswer + "\n\nDirect source URLs (cited above):\n" + sourceList;
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
    "For research about latest or recent developments, give an absolute publication date for every source-backed item in the format '15 September 2026'. Never use relative wording such as '3 weeks ago', 'last month', or 'recently' as a publication date. Distinguish the article's publication date from the date an event happened. Use only a date explicitly shown by that specific source; if you cannot verify it, write 'Publication date not stated'. Never combine dates from different sources or infer a publication date from a search result's relative age.",
    "Link each important factual claim to the specific article, official release, regulator notice, company announcement, or research paper that supports it. Use descriptive link labels that identify the announcement, not generic labels such as 'pib.gov.in' or 'Press Release Page'. A publisher homepage or a domain name alone is not a sufficient citation when a direct source URL is available.",
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