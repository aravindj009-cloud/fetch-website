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

    const quantityMatches = text.match(
      /(\d+)\s+(kitkats?|kit kats?|milks?|breads?)/gi
    );

    if (quantityMatches) {
      for (const match of quantityMatches) {
        const parsed = match.match(
          /(\d+)\s+(.+)/i
        );

        if (parsed) {
          items.push({
            quantity: Number(parsed[1]),
            item: clean(parsed[2])
          });
        }
      }
    }

    if (!items.length) {
      if (containsAny(text, ["kitkat", "kit kat"])) {
        items.push({
          quantity: 1,
          item: "KitKat"
        });
      }

      if (containsAny(text, ["milk"])) {
        items.push({
          quantity: 1,
          item: "milk"
        });
      }

      if (containsAny(text, ["bread"])) {
        items.push({
          quantity: 1,
          item: "bread"
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
        "Check available physical resources",
        "Determine fulfilment path",
        "Prepare customer quote",
        "Request confirmation before purchase"
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

function physicalQuote(entities) {
  const items = Array.isArray(entities.items)
    ? entities.items
    : [];

  let subtotal = 0;

  const pricedItems = items.map((item) => {
    const name = lower(item.item);

    let unitPrice = 40;

    if (name.includes("kitkat")) {
      unitPrice = 20;
    } else if (name.includes("milk")) {
      unitPrice = 35;
    } else if (name.includes("bread")) {
      unitPrice = 45;
    }

    const quantity = Number(item.quantity || 1);
    const total = unitPrice * quantity;

    subtotal += total;

    return {
      item: item.item,
      quantity,
      unit_price: unitPrice,
      total
    };
  });

  const fetchFee = 20;
  const deliveryFee = 20;
  const total = subtotal + fetchFee + deliveryFee;

  return {
    currency: "INR",
    items: pricedItems,
    subtotal,
    fetch_fee: fetchFee,
    delivery_fee: deliveryFee,
    total
  };
}

function execute(intent, entities, atc) {
  if (intent.domain === "physical_commerce") {
    const quote = physicalQuote(entities);

    return {
      success: true,
      status: "awaiting_physical_order",
      execution_type: "physical_quote",
      side_effect: false,
      quote,
      message:
        quote.items.length
          ? `I found the physical fulfilment path. Your estimated total is ₹${quote.total}. I’ll need your confirmation before placing the order.`
          : "I can handle the physical order, but I need the items you want."
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
