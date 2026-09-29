/*
 * FETCH PROVIDER REGISTRY
 *
 * Fetch is the customer-facing AI layer.
 * Providers own the underlying commerce / mobility execution.
 *
 * The registry deliberately separates:
 *   - provider selection
 *   - provider transport
 *   - provider authentication
 *   - provider side effects
 *
 * This lets ATC add providers without changing the user experience.
 */

const PROVIDERS = [
  {
    id: "swiggy_instamart",
    name: "Instamart",
    company: "Swiggy",
    category: "commerce",
    capabilities: [
      "grocery_search",
      "cart",
      "checkout",
      "order_tracking"
    ],
    transport: "mcp",
    endpoint: "https://mcp.swiggy.com/im",
    web_url: "https://www.swiggy.com/instamart",
    auth: "oauth2_pkce",
    confirmation_required: true,
    enabled: true,
    keywords: [
      "instamart",
      "swiggy instamart",
      "groceries",
      "grocery",
      "milk",
      "bread",
      "eggs",
      "rice",
      "snacks",
      "biscuits",
      "kitkat",
      "munch",
      "water",
      "household"
    ]
  },
  {
    id: "uber",
    name: "Uber",
    company: "Uber",
    category: "mobility",
    capabilities: [
      "ride_estimate",
      "ride_request",
      "ride_tracking"
    ],
    transport: "rest_api",
    endpoint: "https://api.uber.com/v1.2",
    web_url: "https://www.uber.com/in/en/ride/",
    auth: "oauth2",
    connect_path: "/api/fetch/uber/connect.mjs",
    auth_env: ["UBER_CLIENT_ID", "UBER_CLIENT_SECRET"],
    confirmation_required: true,
    enabled: true,
    keywords: [
      "uber",
      "cab",
      "taxi",
      "ride",
      "uberx",
      "uber auto",
      "airport ride"
    ]
  },
  {
    id: "zomato",
    name: "Zomato",
    company: "Zomato",
    category: "food",
    capabilities: [
      "restaurant_search",
      "menu",
      "food_order"
    ],
    transport: "connector_pending",
    endpoint: null,
    web_url: "https://www.zomato.com/",
    auth: "pending",
    confirmation_required: true,
    enabled: false,
    keywords: [
      "zomato",
      "restaurant",
      "food delivery",
      "biryani",
      "pizza",
      "dinner",
      "lunch"
    ]
  },
  {
    id: "blinkit",
    name: "Blinkit",
    company: "Blinkit",
    category: "commerce",
    capabilities: [
      "grocery_search",
      "cart",
      "checkout",
      "order_tracking"
    ],
    transport: "connector_pending",
    endpoint: null,
    web_url: "https://blinkit.com/",
    auth: "pending",
    confirmation_required: true,
    enabled: false,
    keywords: [
      "blinkit"
    ]
  }
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function listProviders() {
  return PROVIDERS.map((provider) => ({ ...provider }));
}

export function getProvider(providerId) {
  const id = clean(providerId).toLowerCase();
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

export function detectProvider(text, intent = {}, entities = {}) {
  const input = normalize(text);

  if (!input) return null;

  /*
   * Explicit provider requests always win.
   */
  for (const provider of PROVIDERS) {
    const explicit = provider.keywords
      .filter((keyword) => keyword.length > 2)
      .some((keyword) => input.includes(normalize(keyword)));

    if (explicit) {
      return {
        provider: { ...provider },
        confidence: 0.98,
        reason: "explicit_provider_or_provider_specific_request"
      };
    }
  }

  /*
   * Intent-based routing when the user did not name an app.
   *
   * This is the important Fetch behaviour:
   * "get me groceries" -> ATC can choose Instamart.
   * "get me a cab" -> ATC can choose Uber.
   */
  if (
    intent?.domain === "physical_commerce" ||
    intent?.domain === "physical"
  ) {
    const shoppingSignals = [
      "grocery",
      "groceries",
      "milk",
      "bread",
      "eggs",
      "rice",
      "snack",
      "snacks",
      "biscuit",
      "biscuits",
      "kitkat",
      "munch",
      "water",
      "buy",
      "purchase"
    ];

    if (shoppingSignals.some((signal) => input.includes(signal))) {
      return {
        provider: { ...getProvider("swiggy_instamart") },
        confidence: 0.86,
        reason: "default_quick_commerce_provider"
      };
    }
  }

  if (
    /\b(cab|taxi|ride|airport)\b/i.test(input) ||
    intent?.domain === "mobility"
  ) {
    return {
      provider: { ...getProvider("uber") },
      confidence: 0.84,
      reason: "default_mobility_provider"
    };
  }

  if (
    intent?.domain === "restaurant" ||
    intent?.domain === "food"
  ) {
    return {
      provider: { ...getProvider("zomato") },
      confidence: 0.72,
      reason: "default_food_provider"
    };
  }

  return null;
}

export function providerConnectionStatus(provider, { accessToken = null } = {}) {
  if (!provider) return "unknown";

  if (!provider.enabled) return "not_enabled";

  if (provider.transport === "mcp") {
    return accessToken ? "connected" : "connection_required";
  }

  if (provider.transport === "rest_api") {
    return accessToken ? "connected" : "connection_required";
  }

  return "connector_pending";
}

export function buildProviderTask(provider, text, entities = {}) {
  if (!provider) return null;

  if (provider.id === "swiggy_instamart") {
    const items = Array.isArray(entities?.items)
      ? entities.items
      : [];

    const itemText = items.length
      ? items.map((item) => {
          const quantity = Math.max(1, Number(item?.quantity || 1));
          return `${quantity} x ${clean(item?.item)}`;
        }).join(", ")
      : clean(text);

    return [
      "Fetch is executing a grocery request through Swiggy Instamart.",
      `Customer request: ${clean(text)}`,
      `Requested items: ${itemText}`,
      "",
      "Execution policy:",
      "- Resolve the user's saved delivery address first.",
      "- Search Instamart for the requested products.",
      "- Build the cart with the requested quantities.",
      "- Read the live cart total and available payment methods.",
      "- Never checkout without explicit customer confirmation.",
      "- After confirmation, checkout using the customer's selected payment method.",
      "- Return the Instamart order id and tracking state."
    ].join("\n");
  }

  if (provider.id === "uber") {
    return [
      "Fetch is executing a mobility request through Uber.",
      `Customer request: ${clean(text)}`,
      "",
      "Execution policy:",
      "- Resolve pickup and destination.",
      "- Get a live ride estimate.",
      "- Show the user the ride option, ETA and fare.",
      "- Never request the ride without explicit customer confirmation.",
      "- After confirmation, request the ride through the authorized Uber integration.",
      "- Return the Uber request id and current status."
    ].join("\n");
  }

  return clean(text);
}
