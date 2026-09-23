const PHYSICAL_NETWORK = "physical";
const DIGITAL_NETWORK = "digital";
const HUMAN_NETWORK = "human";

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

  if (intent.domain === "physical_commerce") {
    const items = [];

    /*
     * This parser is intentionally lightweight.
     * It extracts known MVP grocery items without assigning prices.
     *
     * Examples:
     *   "2 KitKats and milk"
     *   "3 bread and 2 milk"
     *   "KitKat and milk"
     */

    const normalized = clean(text);

    const knownItems = [
      {
        patterns: [/\bkit\s*kats?\b/i, /\bkitkats?\b/i],
        name: "KitKat"
      },
      {
        patterns: [/\bmilks?\b/i],
        name: "milk"
      },
      {
        patterns: [/\bbreads?\b/i],
        name: "bread"
      }
    ];

    for (const itemDef of knownItems) {
      let match = null;

      for (const pattern of itemDef.patterns) {
        match = pattern.exec(normalized);
        if (match) break;
      }

      if (!match) continue;

      const before = normalized.slice(0, match.index);

      /*
       * Look immediately before the item for a quantity.
       * If there is no quantity, default to 1.
       */
      const quantityMatch = before.match(/(?:^|[\s,;]|and)\s*(\d+)\s*$/i);
      const quantity = quantityMatch
        ? Number(quantityMatch[1])
        : 1;

      /*
       * Avoid duplicate extraction if multiple aliases match
       * the same item.
       */
      if (!items.some((x) => lower(x.item) === lower(itemDef.name))) {
        items.push({
          quantity,
          item: itemDef.name
        });
      }
    }

    entities.items = items;
  }

  return entities;
}

function buildPlan(intent, entities) {
  switch (intent.domain) {
    case "physical_commerce":
      return [
        "Understand requested items",
        "Route request through Fetch ATC",
        "Check available partner stores",
        "Get real item availability and price",
        "Calculate delivery after fulfilment source is known",
        "Request customer confirmation before purchase"
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

function execute(intent, entities, atc) {
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

export async function executeUniversalFetchRequest({
  text,
  customerId = null,
  conversationId = null,
  channel = "web",
  activeTaskId = null,
  suppliedIntent = null,
  suppliedContext = {}
} = {}) {
  const workflowId = makeId("fetch");

  const cleanText = clean(text);

  if (!cleanText) {
    return {
      success: false,
      status: "needs_clarification",
      workflow_id: workflowId,
      message: "Tell me what you need done."
    };
  }

  const intent =
    suppliedIntent || detectIntent(cleanText);

  const entities = extractEntities(
    cleanText,
    intent
  );

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

  const execution = execute(
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
