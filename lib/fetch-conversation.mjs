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

async function liveUtilityAnswer(text) {
  const value = clean(text);

  const timeMatch = value.match(/\b(?:what(?:'s| is)\s+)?(?:the\s+)?time\s+in\s+([a-zA-Z][a-zA-Z .'-]+?)(?:\s+now)?[?.!]*$/i);
  if (timeMatch) {
    const city = clean(timeMatch[1]);
    const aliases = {
      bangalore: "Asia/Kolkata",
      bengaluru: "Asia/Kolkata",
      mumbai: "Asia/Kolkata",
      delhi: "Asia/Kolkata",
      "new delhi": "Asia/Kolkata",
      "thiruvananthapuram": "Asia/Kolkata",
      "trivandrum": "Asia/Kolkata",
      london: "Europe/London",
      "new york": "America/New_York",
      tokyo: "Asia/Tokyo",
      singapore: "Asia/Singapore",
      dubai: "Asia/Dubai",
      sydney: "Australia/Sydney",
      "los angeles": "America/Los_Angeles"
    };

    const timezone = aliases[city.toLowerCase()] || city.replace(/\s+/g, "_");
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-IN", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short"
      }).format(now);
      return `It’s ${formatted} in ${city} right now.`;
    } catch {
      return null;
    }
  }

  const weatherMatch = value.match(/\b(?:what(?:'s| is)\s+)?(?:the\s+)?weather\s+(?:in|at)\s+([a-zA-Z][a-zA-Z .'-]+?)[?.!]*$/i);
  if (weatherMatch) {
    const city = clean(weatherMatch[1]);

    try {
      const geoResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
        { headers: { Accept: "application/json" } }
      );

      if (!geoResponse.ok) return null;

      const geo = await geoResponse.json();
      const place = geo?.results?.[0];
      if (!place) return null;

      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
        { headers: { Accept: "application/json" } }
      );

      if (!weatherResponse.ok) return null;

      const weather = await weatherResponse.json();
      const current = weather?.current;
      if (!current) return null;

      const labels = {
        0: "clear sky",
        1: "mainly clear",
        2: "partly cloudy",
        3: "overcast",
        45: "foggy",
        48: "foggy",
        51: "light drizzle",
        53: "drizzle",
        55: "heavy drizzle",
        61: "light rain",
        63: "rain",
        65: "heavy rain",
        80: "rain showers",
        81: "rain showers",
        82: "heavy rain showers",
        95: "thunderstorms",
        96: "thunderstorms with hail",
        99: "thunderstorms with hail"
      };

      const condition = labels[current.weather_code] || "current conditions";
      return `Right now in ${place.name}, it’s ${Math.round(current.temperature_2m)}°C and ${condition}, with about ${Math.round(current.relative_humidity_2m)}% humidity and winds around ${Math.round(current.wind_speed_10m)} km/h.`;
    } catch (error) {
      console.error("FETCH WEATHER ERROR", error);
      return null;
    }
  }

  return null;
}

function deterministicConversationFallback(text) {
  const value = clean(text).toLowerCase();

  if (/\bwhat is an ai agent\b|\bexplain ai agent\b/.test(value)) {
    return "An AI agent is software that can understand what you want, decide what needs to happen, use the right tools or services, and complete the task for you. In Fetch, the idea is simple: you ask for the outcome, Fetch figures out the execution path, and you stay in control before anything consequential happens.";
  }

  if (/\bwhat should i eat\b|\bwhat can i eat\b|\bwhat do i eat\b/.test(value)) {
    return "If you want something easy tonight:\n\n• Kerala-style chicken biryani + raita\n• Dosa + chicken curry\n• A lighter option: grilled chicken + rice + vegetables\n\nIf you tell me your mood, budget, or whether you want veg/non-veg, I can narrow it down.";
  }

  if (/\bhelp me plan tomorrow\b|\bplan tomorrow\b/.test(value)) {
    return "Absolutely. A simple starting plan for tomorrow:\n\n1. Pick the one outcome that matters most.\n2. Block your most focused 90 minutes for it.\n3. Group calls/messages into one or two windows.\n4. Leave a buffer for unexpected work.\n5. End the day by setting up the first task for the following morning.\n\nTell me what you need to get done tomorrow and I’ll turn this into a specific schedule.";
  }

  if (/\bhello\b|\bhi\b|\bhey\b/.test(value)) {
    return "Hey — I’m Fetch. Tell me what you want done, and I’ll help you work out the next step.";
  }

  return "I’m here. Tell me what you want to get done, and I’ll help you figure it out.";
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
    const utilityAnswer = await liveUtilityAnswer(userText);
    if (utilityAnswer) {
      return utilityAnswer;
    }

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
      "FETCH CONVERSATION AUTH MISSING: using deterministic fallback"
    );
    return deterministicConversationFallback(userText);
  } catch (error) {
    console.error("FETCH CONVERSATION ERROR", error);
    return null;
  }
}
