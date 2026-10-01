const PHYSICAL_NETWORK = "physical";
const DIGITAL_NETWORK = "digital";
const HUMAN_NETWORK = "human";

import { detectProvider, providerConnectionStatus, buildProviderTask } from "./fetch-provider-registry.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function makeId(prefix = "wf") {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function lower(value) {
  return clean(value).toLowerCase();
}

function containsAny(text, values) {
  const t = lower(text);
  return values.some((value) => t.includes(value));
}

function detectIntent(text) {
  const t = lower(text);

  if (
    containsAny(t, [
      "uber",
      "cab",
      "taxi",
      "ride",
      "uberx",
      "uber auto",
      "airport ride",
      "rapido",
      "bike taxi",
      "auto"
    ])
  ) {
    return {
      domain: "mobility",
      action: "request_ride",
      confidence: 0.95
    };
  }

  if (
    containsAny(t, [
      "kitkat",
      "kit kat",
      "milk",
      "bread",
      "groceries",
      "grocery",
      "buy",
      "get me",
      "bring me",
      "deliver",
      "order"
    ])
  ) {
    return {
      domain: "physical_commerce",
      action: "source_and_fulfil",
      confidence: 0.94
    };
  }

  if (
    containsAny(t, [
      "restaurant",
      "dinner",
      "lunch",
      "reservation",
      "table",
      "book a table"
    ])
  ) {
    return {
      domain: "restaurant",
      action: "find_or_reserve",
      confidence: 0.88
    };
  }

  if (
    containsAny(t, [
      "flight",
      "fly",
      "plane",
      "air ticket",
      "book a flight"
    ])
  ) {
    return {
      domain: "travel",
      action: "find_or_book",
      confidence: 0.87
    };
  }

  if (
    containsAny(t, [
      "remember",
      "don't forget",
      "prefer",
      "preference",
      "keep in mind"
    ])
  ) {
    return {
      domain: "memory",
      action: "store_preference",
      confidence: 0.96
    };
  }

  if (containsAny(t, ["weather", "temperature", "forecast", "rain", "raining"])) {
    return {
      domain: "weather",
      action: "get_weather",
      confidence: 0.96
    };
  }

  if (containsAny(t, ["what time", "current time", "time in", "time at", "clock"])) {
    return {
      domain: "time",
      action: "get_time",
      confidence: 0.96
    };
  }

  if (
    containsAny(t, [
      "latest",
      "news",
      "research",
      "find out",
      "look up",
      "search",
      "what happened"
    ])
  ) {
    return {
      domain: "research",
      action: "research_and_summarize",
      confidence: 0.91
    };
  }

  if (
    containsAny(t, [
      "call",
      "phone",
      "ring",
      "speak to"
    ])
  ) {
    return {
      domain: "communications",
      action: "make_phone_call",
      confidence: 0.83
    };
  }

  if (
    containsAny(t, [
      "send",
      "message",
      "text",
      "whatsapp",
      "email"
    ])
  ) {
    return {
      domain: "communications",
      action: "send_message",
      confidence: 0.85
    };
  }

  if (
    containsAny(t, [
      "remind me",
      "reminder",
      "remind"
    ])
  ) {
    return {
      domain: "productivity",
      action: "create_reminder",
      confidence: 0.92
    };
  }

  return {
    domain: "general_agent",
    action: "understand_and_assist",
    confidence: 0.62
  };
}

function extractEntities(text, intent) {
  const entities = {
    raw_text: clean(text)
  };

  if (intent.domain === "mobility") {
    const normalized = clean(text);
    const destinationMatch = normalized.match(/\b(?:to|towards|for)\s+(.+?)(?:\s+(?:tomorrow|today|tonight|at\s+\d|by\s+\d|from\s+here|from\s+)\b|$)/i);
    const fromMatch = normalized.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+(?:tomorrow|today|tonight|at\s+\d|by\s+\d)\b|$)/i);
    entities.destination = fromMatch
      ? clean(fromMatch[2]).replace(/[.,!?]+$/, "")
      : destinationMatch
        ? clean(destinationMatch[1]).replace(/[.,!?]+$/, "")
        : null;
    entities.pickup = fromMatch ? clean(fromMatch[1]) : "current_location";
    const timeMatch = normalized.match(/\b(?:at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    entities.requested_time = timeMatch ? clean(timeMatch[1]) : null;
    entities.provider_preference = /\brapido\b/i.test(normalized)
      ? "rapido"
      : /\buber\b/i.test(normalized)
        ? "uber"
        : null;
  }

  if (intent.domain === "weather" || intent.domain === "time") {
    const normalized = clean(text);
    const match =
      normalized.match(/\b(?:in|at|for)\s+([^?]+?)(?:\?|$)/i) ||
      normalized.match(/\b(?:weather|time)\s+(?:of|for)\s+([^?]+?)(?:\?|$)/i);

    entities.location = match
      ? clean(match[1]).replace(/[.,!?]+$/, "")
      : null;
  }

  if (intent.domain === "physical_commerce") {
    /*
     * Generic commerce extraction.
     *
     * The old MVP parser only recognized KitKat, milk and bread. That meant
     * perfectly valid requests such as "2 kgs of red banana" produced an
     * empty entities.items array and the provider was called with no query.
     *
     * Fetch should understand the requested item first and let the selected
     * provider decide whether it exists, what variants are available, and
     * what it costs. Do not maintain a hard-coded grocery catalogue here.
     */
    const normalized = clean(text)
      .replace(/[“”"]/g, "")
      .replace(/\b(?:please\s+)?(?:i\s+)?(?:need|want|give\s+me|get\s+me|bring\s+me|buy|order|fetch)\b/gi, " ")
      .replace(/\b(?:from|on|via)\s+(?:instamart|swiggy|zepto|blinkit|bigbasket|amazon\s+fresh|dmart)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const chunks = normalized
      .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
      .map((chunk) => clean(chunk))
      .filter(Boolean);

    const units = "(?:kg|kgs|kilogram|kilograms|g|gram|grams|l|ltr|liter|litre|litres|ml|milliliter|millilitre|pack|packs|packet|packets|bottle|bottles|box|boxes|pcs|pc|pieces|piece)";
    const items = [];

    for (const chunk of chunks) {
      const match = chunk.match(
        new RegExp("^(?:(\\d+(?:\\.\\d+)?)\\s*)?(" + units + ")?\\s*(?:of\\s+)?(.+)$", "i")
      );

      if (!match) continue;

      const quantity = match[1] ? Number(match[1]) : 1;
      const unit = clean(match[2]).toLowerCase();
      let itemName = clean(match[3])
        .replace(/\b(?:for|at|in)\s+(?:today|tonight|tomorrow)\b.*$/i, "")
        .replace(/\s+/g, " ")
        .replace(/^[,.;:-]+|[,.;:-]+$/g, "")
        .trim();

      if (!itemName) continue;

      // Remove a trailing provider/location phrase that survived the first pass.
      itemName = itemName
        .replace(/\s+(?:from|on|via)\s+(?:instamart|swiggy|zepto|blinkit|bigbasket|amazon\s+fresh|dmart)\s*$/i, "")
        .trim();

      if (!itemName) continue;

      const existing = items.find((item) => lower(item.item) === lower(itemName));
      if (existing) {
        existing.quantity += quantity;
        if (!existing.unit && unit) existing.unit = unit;
      } else {
        items.push({
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          unit: unit || null,
          item: itemName
        });
      }
    }

    entities.items = items;
  }

  return entities;
}

function buildPlan(intent, entities) {
  switch (intent.domain) {
    case "mobility":
      return [
        "Understand pickup and destination",
        "Route the ride through Fetch ATC",
        "Fetch available ride options",
        "Show fare and ETA",
        "Request customer confirmation before requesting the ride"
      ];

    case "physical_commerce":
      return [
        "Understand requested items",
        "Route request through Fetch ATC",
        "Check available partner stores",
        "Get real item availability and price",
        "Calculate delivery after fulfilment source is known",
        "Request customer confirmation before purchase"
      ];

    case "weather":
      return [
        "Identify the requested location",
        "Fetch current weather conditions",
        "Return temperature and useful conditions"
      ];

    case "time":
      return [
        "Identify the requested location",
        "Resolve the location timezone",
        "Return the current local time"
      ];

    case "research":
      return [
        "Identify research question",
        "Gather relevant information",
        "Evaluate results",
        "Summarize findings"
      ];

    case "restaurant":
      return [
        "Understand location and timing",
        "Find suitable restaurants",
        "Check availability",
        "Request confirmation before reservation"
      ];

    case "travel":
      return [
        "Understand destination and timing",
        "Search available options",
        "Compare options",
        "Request confirmation before booking"
      ];

    case "memory":
      return [
        "Extract preference",
        "Store preference in conversation context"
      ];

    case "communications":
      return [
        "Identify recipient",
        "Prepare communication",
        "Request confirmation before sending"
      ];

    case "productivity":
      return [
        "Understand reminder",
        "Determine timing",
        "Create reminder"
      ];

    default:
      return [
        "Understand request",
        "Determine required capability",
        "Plan execution"
      ];
  }
}

function routeWithATC(intent, entities) {
  if (intent.domain === "physical_commerce") {
    return {
      status: "resource_matched",
      network: PHYSICAL_NETWORK,
      resource_type: "partner_store",
      reason:
        "Physical goods require the Fetch physical fulfilment network."
    };
  }

  if (intent.domain === "weather") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "weather",
      reason: "Current weather can be fetched through a live weather capability."
    };
  }

  if (intent.domain === "time") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "time",
      reason: "Current local time can be resolved through a live time capability."
    };
  }

  if (intent.domain === "research") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "web_research",
      reason:
        "Research can be handled through Fetch's digital execution network."
    };
  }

  if (intent.domain === "communications") {
    return {
      status: "resource_matched",
      network: HUMAN_NETWORK,
      resource_type: "communications_agent",
      reason:
        "Communication requires an external communication capability."
    };
  }

  if (intent.domain === "restaurant") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "restaurant_reservation",
      reason:
        "Restaurant discovery and reservations belong to the digital execution network."
    };
  }

  if (intent.domain === "travel") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "travel_search",
      reason:
        "Travel discovery belongs to the digital execution network."
    };
  }

  if (intent.domain === "memory") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "memory",
      reason:
        "Memory is handled internally by Fetch."
    };
  }

  if (intent.domain === "productivity") {
    return {
      status: "resource_matched",
      network: DIGITAL_NETWORK,
      resource_type: "reminder",
      reason:
        "Reminders are handled by Fetch's productivity layer."
    };
  }

  return {
    status: "resource_matched",
    network: DIGITAL_NETWORK,
    resource_type: "general_agent",
    reason:
      "Fetch will determine the appropriate digital capability."
  };
}

async function execute(intent, entities, atc) {
  if (intent.domain === "weather") {
    const location = clean(entities.location);

    if (!location) {
      return {
        success: false,
        status: "needs_clarification",
        execution_type: "weather",
        side_effect: false,
        message: "Which location should I check the weather for?"
      };
    }

    try {
      const geoResponse = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?name=" +
          encodeURIComponent(location) +
          "&count=1&language=en&format=json"
      );
      const geo = await geoResponse.json();
      const place = Array.isArray(geo?.results) ? geo.results[0] : null;

      if (!place) {
        return {
          success: false,
          status: "not_found",
          execution_type: "weather",
          side_effect: false,
          message: "I couldn't find that location."
        };
      }

      const weatherResponse = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=" +
          encodeURIComponent(place.latitude) +
          "&longitude=" +
          encodeURIComponent(place.longitude) +
          "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto"
      );
      const weather = await weatherResponse.json();
      const current = weather?.current;

      if (!current) throw new Error("Weather data unavailable");

      return {
        success: true,
        status: "completed",
        execution_type: "weather",
        side_effect: false,
        message:
          `In ${place.name}, it's ${Math.round(Number(current.temperature_2m))}°C, feels like ${Math.round(Number(current.apparent_temperature))}°C. Wind is ${Math.round(Number(current.wind_speed_10m))} km/h.`,
        data: {
          location: place.name,
          country: place.country,
          timezone: weather.timezone,
          temperature_c: current.temperature_2m,
          apparent_temperature_c: current.apparent_temperature,
          humidity_percent: current.relative_humidity_2m,
          wind_kmh: current.wind_speed_10m,
          weather_code: current.weather_code
        }
      };
    } catch (error) {
      console.error("FETCH WEATHER ERROR", error);
      return {
        success: false,
        status: "unavailable",
        execution_type: "weather",
        side_effect: false,
        message: "I couldn't retrieve live weather right now."
      };
    }
  }

  if (intent.domain === "time") {
    const location = clean(entities.location);

    if (!location) {
      return {
        success: false,
        status: "needs_clarification",
        execution_type: "time",
        side_effect: false,
        message: "Which city should I check the time for?"
      };
    }

    try {
      const geoResponse = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?name=" +
          encodeURIComponent(location) +
          "&count=1&language=en&format=json"
      );
      const geo = await geoResponse.json();
      const place = Array.isArray(geo?.results) ? geo.results[0] : null;

      if (!place?.timezone) throw new Error("Timezone unavailable");

      const now = new Date().toLocaleString("en-US", {
        timeZone: place.timezone,
        dateStyle: "medium",
        timeStyle: "short"
      });

      return {
        success: true,
        status: "completed",
        execution_type: "time",
        side_effect: false,
        message: `It's ${now} in ${place.name}, ${place.country}.`,
        data: {
          location: place.name,
          country: place.country,
          timezone: place.timezone,
          local_time: now
        }
      };
    } catch (error) {
      console.error("FETCH TIME ERROR", error);
      return {
        success: false,
        status: "unavailable",
        execution_type: "time",
        side_effect: false,
        message: "I couldn't resolve that city's local time right now."
      };
    }
  }
  /*
   * IMPORTANT:
   *
   * Physical commerce deliberately does NOT calculate a quote here.
   *
   * The WhatsApp physical-shopping engine is the source of truth for:
   *   customer -> ATC -> partner store -> real price/availability
   *   -> delivery calculation -> customer approval -> shopper
   *
   * This universal layer only identifies the physical network and hands
   * the request back to that engine.
   */
  if (intent.domain === "physical_commerce") {
    return {
      success: true,
      status: "awaiting_physical_order",
      execution_type: "physical_network_handoff",
      side_effect: false,
      message:
        "Physical commerce request routed to the Fetch physical fulfilment engine."
    };
  }

  if (intent.domain === "research") {
    return {
      success: true,
      status: "resource_matched",
      execution_type: "digital_research",
      side_effect: false,
      message:
        "I can research that for you. The digital research capability is ready to be connected."
    };
  }

  if (intent.domain === "restaurant") {
    return {
      success: true,
      status: "resource_matched",
      execution_type: "restaurant_reservation",
      side_effect: false,
      message:
        "I can handle the restaurant search and reservation path. The reservation connector still needs to be connected."
    };
  }

  if (intent.domain === "travel") {
    return {
      success: true,
      status: "resource_matched",
      execution_type: "travel",
      side_effect: false,
      message:
        "I can handle the flight-search path. The live booking connector still needs to be connected."
    };
  }

  if (intent.domain === "memory") {
    return {
      success: true,
      status: "completed",
      execution_type: "memory",
      side_effect: false,
      message:
        "Got it. I’ll keep that preference in this Fetch conversation."
    };
  }

  if (intent.domain === "communications") {
    return {
      success: true,
      status: "resource_matched",
      execution_type: "communication",
      side_effect: false,
      message:
        "I found the communication path. A live messaging or calling connector needs to be connected before I can send or call."
    };
  }

  if (intent.domain === "productivity") {
    return {
      success: true,
      status: "resource_matched",
      execution_type: "reminder",
      side_effect: false,
      message:
        "I understand the reminder request. The live reminder scheduler will be connected next."
    };
  }

  return {
    success: true,
    status: "resource_matched",
    execution_type: "general_agent",
    side_effect: false,
    message:
      "I understand the request. I’m determining the capability needed to complete it."
  };
}

function extractContextLocation(text) {
  const value = clean(text);
  const patterns = [
    /\b(?:in|at|for)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?:\s+(?:tomorrow|today|tonight|next week|this week)\b|[?.!,]|$)/i,
    /\b(?:to|towards)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?:\s+(?:tomorrow|today|tonight|next week|this week)\b|[?.!,]|$)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function enrichFollowupContext(text, intent, activeTaskContext = {}) {
  const current = clean(text);
  const prior = clean(activeTaskContext?.text);
  const history = Array.isArray(activeTaskContext?.history)
    ? activeTaskContext.history.map((item) => clean(item?.text)).filter(Boolean).join(" ")
    : "";
  const combined = [prior, history].filter(Boolean).join(" ");

  if (!combined) return current;

  if (
    ["weather", "time"].includes(intent?.domain) &&
    !extractContextLocation(current)
  ) {
    const inherited = extractContextLocation(combined);
    if (inherited) {
      return current + " in " + inherited;
    }
  }

  if (
    intent?.domain === "mobility" &&
    /^(uber|rapido|use uber|use rapido)$/i.test(current) &&
    /\b(?:to|towards)\b/i.test(combined)
  ) {
    return combined + " " + current;
  }
  return current;
}

export async function executeUniversalFetchRequest({
  text,
  customerId = null,
  conversationId = null,
  channel = "web",
  activeTaskId = null,
  suppliedIntent = null,
  suppliedContext = {},
  activeTaskContext = null
} = {}) {
  const workflowId = makeId("fetch");

  const cleanText = clean(text);
  const initialIntent = suppliedIntent || detectIntent(cleanText);
  const contextualText = enrichFollowupContext(
    cleanText,
    initialIntent,
    activeTaskContext || {}
  );

  if (!cleanText) {
    return {
      success: false,
      status: "needs_clarification",
      workflow_id: workflowId,
      message: "Tell me what you need done."
    };
  }

  const intent = initialIntent;

  const entities = extractEntities(
    contextualText,
    intent
  );

  // Provider-aware ATC: Fetch can sit above existing apps instead of
  // requiring every fulfilment capability to be owned by Fetch.
  const providerMatch = detectProvider(cleanText, intent, entities);

  /*
   * Mobility requests without an explicit provider are intentionally
   * conversational. Fetch asks the customer to choose rather than
   * silently deciding between Uber and Rapido.
   */
  if (
    intent?.domain === "mobility" &&
    !providerMatch?.provider &&
    providerMatch?.reason === "mobility_provider_choice_required"
  ) {
    return {
      success: true,
      status: "needs_clarification",
      workflow_id: workflowId,
      fetch: {
        channel,
        customer_id: customerId,
        conversation_id: conversationId,
        decisions: [{
          intent,
          entities,
          plan: buildPlan(intent, entities),
          decision: {
            reason: providerMatch.reason,
            confirmation_required: true
          }
        }],
        context: suppliedContext
      },
      atc: {
        status: "provider_choice_required",
        network: "mobility",
        resource_type: "connected_app",
        candidates: [
          { id: "uber", name: "Uber", capabilities: ["ride_estimate", "ride_request", "ride_tracking"] },
          { id: "rapido", name: "Rapido", capabilities: ["ride_options", "bike_taxi", "auto", "cab", "ride_tracking"] }
        ],
        confidence: providerMatch.confidence,
        reason: providerMatch.reason,
        confirmation_required: true
      },
      execution: {
        success: false,
        status: "needs_clarification",
        execution_type: "mobility_provider_choice",
        side_effect: false,
        confirmation_required: true,
        message: "Sure. I can arrange that. Would you like Uber or Rapido?"
      }
    };
  }

  const provider = providerMatch?.provider || null;
  const providerAccessToken = provider
    ? (suppliedContext?.provider_access_tokens?.[provider.id] || suppliedContext?.provider_access_token || null)
    : null;
  const providerConnection = provider
    ? providerConnectionStatus(provider, { accessToken: providerAccessToken })
    : null;

  if (provider) {
    const providerTask = buildProviderTask(provider, cleanText, entities);

    const providerAtc = {
      status: "provider_selected",
      network: provider.category,
      resource_type: "connected_app",
      provider_id: provider.id,
      provider_name: provider.name,
      provider_company: provider.company,
      provider_transport: provider.transport,
      provider_endpoint: provider.endpoint,
      connection_status: providerConnection,
      confidence: providerMatch.confidence,
      reason: providerMatch.reason,
      confirmation_required: Boolean(provider.confirmation_required),
      capabilities: provider.capabilities,
    };

    return {
      success: true,
      status: providerConnection === "connected"
        ? "provider_ready"
        : "provider_connection_required",
      workflow_id: workflowId,
      fetch: {
        channel,
        customer_id: customerId,
        conversation_id: conversationId,
        active_task_id: activeTaskId,
        decisions: [{
          intent,
          entities,
          plan: buildPlan(intent, entities),
          decision: {
            reason: providerAtc.reason,
            provider_id: provider.id,
            network: provider.category,
            resource_type: "connected_app",
            confirmation_required: Boolean(provider.confirmation_required),
          },
        }],
        context: suppliedContext,
      },
      atc: providerAtc,
      provider: {
        id: provider.id,
        name: provider.name,
        company: provider.company,
        category: provider.category,
        capabilities: provider.capabilities,
        transport: provider.transport,
        connection_status: providerConnection,
        connect_path: provider.connect_path || null,
        auth: provider.auth || null,
        task: providerTask,
        web_url: provider.web_url,
      },
      execution: {
        success: false,
        status: providerConnection === "connected" ? "ready_for_confirmation" : "connection_required",
        execution_type: "connected_app",
        side_effect: false,
        confirmation_required: Boolean(provider.confirmation_required),
        message: providerConnection === "connected"
          ? `I found ${provider.name}. I’m ready to prepare the order, but I’ll ask before the final purchase.`
          : `I found ${provider.name} as the service that can fulfil this. Connect ${provider.name} to Fetch before I can place the order.`,
      },
    };
  }

  if (
    intent.domain === "physical_commerce" &&
    (!entities.items || entities.items.length === 0)
  ) {
    return {
      success: true,
      status: "needs_clarification",
      workflow_id: workflowId,
      fetch: {
        decisions: [
          {
            intent,
            entities,
            plan: buildPlan(intent, entities),
            decision: {
              reason:
                "I understand that you want something sourced or delivered, but I need to know what item or items you want."
            }
          }
        ]
      },
      atc: null,
      execution: null
    };
  }

  const plan = buildPlan(intent, entities);

  const atc = routeWithATC(
    intent,
    entities
  );

  const execution = await execute(
    intent,
    entities,
    atc
  );

  return {
    success: true,
    status: execution.status,
    workflow_id: workflowId,

    fetch: {
      channel,
      customer_id: customerId,
      conversation_id: conversationId,
      active_task_id: activeTaskId,

      decisions: [
        {
          intent,
          entities,
          plan,
          decision: {
            reason: atc.reason
          }
        }
      ],

      context: suppliedContext
    },

    atc,

    execution
  };
}
