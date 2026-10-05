// FETCH MOBILITY BUILD 2026-10-01-PROD-REFRESH
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const starters = [
  "Get me a cab to Technopark",
  "Book me an Uber to the airport",
  "Get me a Rapido to Kowdiar",
  "What can you help me with?"
];

const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function displayMessage(value, fallback = "I’m working on that.") {
  if (typeof value === "string") return value.trim() || fallback;
  if (value == null) return fallback;

  if (typeof value === "object") {
    const candidates = [
      value.text,
      value.message,
      value.content,
      value.output_text,
      value.error?.message
    ];

    const readable = candidates.find(
      (item) => typeof item === "string" && item.trim()
    );

    if (readable) return readable.trim();

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return fallback;
    }
  }

  return String(value);
}

const API_URL =
  typeof window !== "undefined" && /(^|\.)tryfetch\.in$/.test(window.location.hostname)
    ? "https://www.tryfetch.in/api/fetch/agent.mjs"
    : "/api/fetch/agent.mjs";

const FETCH_BUILD = "2026-10-01-api-fix-0a8dadc2";
if (typeof document !== "undefined") {
  document.documentElement.dataset.fetchBuild = FETCH_BUILD;
}
async function readApiJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    const excerpt = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
    throw new Error(
      `Fetch API returned ${response.status} instead of JSON at ${response.url}. ` +
      `Check that /api/fetch/agent.mjs is deployed on this domain. ${excerpt}`
    );
  }
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error(`Fetch API returned invalid JSON (HTTP ${response.status}) at ${response.url}`);
  }
}

const ACTIVE_ORDER_KEY = "fetch_active_order_id";
const ORDER_POLL_INTERVAL_MS = 3000;
const MAX_ORDER_CHECKS = 100;

function getSwiggyConnectionState() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("swiggy");
  } catch {
    return null;
  }
}

function getConversationId() {
  // This function runs during the initial React render. Nothing here should
  // ever be able to crash the entire application (for example when browser
  // storage is blocked, unavailable, or full).
  try {
    const returned = new URLSearchParams(window.location.search).get("conversationId");

    if (returned) {
      try {
        localStorage.setItem("fetch_conversation_id", returned);
      } catch {
        // Storage is optional; the conversation can still run in memory.
      }
      return returned;
    }

    try {
      const existing = localStorage.getItem("fetch_conversation_id");
      if (existing) return existing;
    } catch {
      // Continue with an in-memory conversation id.
    }
  } catch {
    // Continue with an in-memory conversation id.
  }

  const created = `web:${makeId()}`;

  try {
    localStorage.setItem("fetch_conversation_id", created);
  } catch {
    // Storage is optional.
  }

  return created;
}


function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function getInstamartCartData(cart) {
  return cart?.data?.data || cart?.data || cart || {};
}

function getInstamartPricing(cart) {
  const data = getInstamartCartData(cart);
  const source = data?.pricing || data?.bill || data || {};
  return {
    ...source,
    item_total: source?.item_total ?? source?.itemTotal ?? source?.subtotal ?? source?.itemsTotal ?? source?.items_total ?? null,
    delivery_charge: source?.delivery_charge ?? source?.deliveryCharge ?? source?.deliveryFee ?? source?.delivery_fee ?? null,
    taxes_and_charges: source?.taxes_and_charges ?? source?.taxesAndCharges ?? source?.taxes ?? source?.taxAmount ?? source?.tax_amount ?? null,
    to_pay: source?.to_pay ?? source?.billToPay ?? source?.total ?? source?.totalAmount ?? source?.grandTotal ?? source?.payableAmount ?? source?.payable_amount ?? null
  };
}

function getInstamartPaymentMethods(paymentOptions, cart) {
  const source =
    paymentOptions?.data?.data ||
    paymentOptions?.data ||
    paymentOptions ||
    getInstamartCartData(cart)?.paymentOptions ||
    getInstamartCartData(cart)?.availablePaymentMethods ||
    {};

  const direct =
    Array.isArray(source?.allMethods) ? source.allMethods :
    Array.isArray(source?.availablePaymentMethods) ? source.availablePaymentMethods :
    Array.isArray(source?.upiMethods) ? source.upiMethods :
    Array.isArray(source?.methods) ? source.methods :
    Array.isArray(source?.allGroups)
      ? source.allGroups.flatMap((group) => Array.isArray(group?.methods) ? group.methods : [])
      : Array.isArray(source) ? source : [];

  const normalized = direct.map((method) => {
    if (typeof method === "string") {
      return { id: method, groupName: method, displayName: method };
    }
    return {
      ...method,
      id: method?.id || method?.methodId || method?.paymentMethod || method?.groupName,
      groupName: method?.groupName || method?.type || method?.paymentMethod || method?.id,
      displayName: method?.displayName || method?.name || method?.label || method?.groupName || method?.id
    };
  });

  return normalized.filter((method) => method?.id && method.enabled !== false);
}

function flowNodeClass(task, index) {
  if (!task) return index === 0 ? "active" : "waiting";

  const status = String(task.status || "").toLowerCase();
  const stage = String(task.stage || "").toLowerCase();

  if (status === "error" || stage === "error") {
    return index === 0 ? "error" : "waiting";
  }

  if (
    ["done", "order_placed", "delivered", "completed"].includes(status) ||
    ["done", "order placed", "delivered", "demo order placed"].includes(stage)
  ) {
    return "complete";
  }

  let activeIndex = 0;
  if (["understanding"].includes(stage)) activeIndex = 0;
  else if (["planning", "coordinating", "finding partner store", "finding shopper", "location needed", "needs input"].includes(stage)) activeIndex = 1;
  else if (["partner store contacted", "price ready for approval", "cart ready for approval", "products ready", "address selection"].some((value) => stage.includes(value))) activeIndex = 2;
  else if (["shopping", "shopper assigned", "picked up", "out for delivery", "order placed", "cart ready for approval"].some((value) => stage.includes(value))) activeIndex = 3;

  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "waiting";
}

function parseResearchResults(text) {
  const raw = decodeEntities(text);

  if (!/here[’']s what i found for/i.test(raw)) {
    return null;
  }

  const results = [];
  const itemPattern = /(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/g;
  let match;

  while ((match = itemPattern.exec(raw)) !== null) {
    const number = Number(match[1]);
    let content = match[2].trim();

    const urlMatch = content.match(/https?:\/\/\S+/i);
    const url = urlMatch ? urlMatch[0].replace(/[),.;]+$/, "") : "";

    if (urlMatch) {
      content = content.replace(urlMatch[0], " ").trim();
    }

    let published = "";
    let source = "";

    const sourceDateMatch = content.match(
      /\s+Source:\s*(.*?)\s*[·|-]\s*(\d{1,2}\s+[A-Za-z]{3,4}\s+\d{4})\s*$/i
    );

    if (sourceDateMatch) {
      source = sourceDateMatch[1].trim();
      published = sourceDateMatch[2].trim();
      content = content.slice(0, sourceDateMatch.index).trim();
    } else {
      const dateMatch = content.match(/(\d{1,2}\s+[A-Za-z]{3,4}\s+\d{4})\s*$/i);
      if (dateMatch) {
        published = dateMatch[1];
        content = content.slice(0, dateMatch.index).trim();
      }

      const sourceMatch = content.match(/\s+Source:\s*(.+)$/i);
      if (sourceMatch) {
        source = sourceMatch[1].trim();
        content = content.slice(0, sourceMatch.index).trim();
      }
    }

    if (!source && url) {
      source = getHost(url);
    }

    // RSS titles often contain the headline followed by the publisher's
    // repeated headline/context. Use the first clean headline and retain
    // only a short context sentence when available.
    const separators = /\s+(?:–|—)\s+/;
    const parts = content.split(separators).map((part) => part.trim()).filter(Boolean);

    let title = parts[0] || content;
    let summary = parts.slice(1).join(" — ");

    // Remove duplicated headline text caused by Google News RSS.
    const lowerTitle = title.toLowerCase();
    if (summary.toLowerCase().startsWith(lowerTitle)) {
      summary = summary.slice(title.length).trim();
    }

    // Keep cards compact. The complete article is available through the link.
    title = title.replace(/\s+/g, " ").trim();
    summary = summary.replace(/\s+/g, " ").trim();

    // RSS feeds often contain several related headlines in one item.
    // Do not dump that noisy feed text into the customer chat.
    if (summary.length > 160) {
      summary = summary.slice(0, 157).trimEnd() + "…";
    }

    results.push({
      number,
      title: title.slice(0, 180),
      summary: summary.slice(0, 240),
      source: source || "Web",
      published,
      url
    });

    if (results.length >= 8) break;
  }

  return results.length ? results : null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/\`([^\`]+?)\`/g, "<code>$1</code>");
  return html;
}

function AssistantMessage({ text }) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  const normalized = raw
    .replace(/\s+(#{1,3}\s+)/g, "\n\n$1")
    .replace(/\s+((?:[-*•]|\d+\.)\s+)/g, "\n$1")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return null;

  return (
    <div className="assistantMessage">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);

        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
          const content = lines[0].replace(/^#{1,3}\s+/, "");
          return <h4 key={index} dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(content) }} />;
        }

        const listLines = lines.filter((line) => /^(?:[-*•]|\d+\.)\s+/.test(line));
        if (listLines.length === lines.length && listLines.length > 0) {
          const ordered = /^\d+\./.test(lines[0]);
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {lines.map((line, i) => (
                <li key={i} dangerouslySetInnerHTML={{
                  __html: formatInlineMarkdown(line.replace(/^(?:[-*•]|\d+\.)\s+/, ""))
                }} />
              ))}
            </Tag>
          );
        }

        return (
          <p key={index} dangerouslySetInnerHTML={{
            __html: formatInlineMarkdown(lines.join(" "))
          }} />
        );
      })}
    </div>
  );
}

function ResearchResults({ text }) {
  const results = parseResearchResults(text);

  if (!results) {
    return <>{text}</>;
  }

  return (
    <div className="researchResults">
      <div className="researchIntro">
        <strong>Here’s what I found</strong>
        <span>Latest web results</span>
      </div>

      <div className="researchList">
        {results.map((result) => (
          <article
            className="researchCard"
            key={`${result.number}-${result.url || result.title}`}
          >
            <div className="researchNumber">
              {String(result.number).padStart(2, "0")}
            </div>

            <div className="researchBody">
              <h3>{result.title}</h3>

              {result.summary && <p>{result.summary}</p>}

              <div className="researchMeta">
                <span>{result.source}</span>
                {result.published && <span>· {result.published}</span>}
              </div>

              {result.url && (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="researchLink"
                >
                  Open source ↗
                </a>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="researchDisclaimer">
        Fetch found these live web results. The underlying claims have not been independently verified by Fetch.
      </div>
    </div>
  );
}

class FetchErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("FETCH CLIENT RENDER ERROR", error, info);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error?.message || "Fetch could not load the application.";
      return (
        <div style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "32px",
          fontFamily: "Inter, system-ui, sans-serif",
          background: "#f7f7f4",
          color: "#111"
        }}>
          <div style={{ maxWidth: "640px" }}>
            <div style={{ fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.55 }}>
              FETCH · CLIENT ERROR
            </div>
            <h1 style={{ fontSize: "36px", margin: "12px 0" }}>
              Fetch hit a browser-side error.
            </h1>
            <p style={{ lineHeight: 1.6, opacity: 0.75 }}>
              The application did not silently fail. Refresh once and, if this
              remains, send this error to the Fetch team:
            </p>
            <pre style={{
              whiteSpace: "pre-wrap",
              padding: "16px",
              borderRadius: "12px",
              background: "#fff",
              border: "1px solid #ddd",
              overflowX: "auto"
            }}>{message}</pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function formatRequestedQuantity(option) {
  const quantity = Number(option?.quantity || 1);
  const pack = String(option?.pack || "").trim();

  if (!Number.isFinite(quantity)) return "Matches your request";

  const match = pack.match(/(\\d+(?:\\.\\d+)?)\\s*(kg|kgs|g|gram|grams|l|ltr|litre|litres|ml)\\b/i);
  if (match) {
    const packQty = Number(match[1]);
    const unit = match[2].toLowerCase();
    const total = quantity * packQty;
    return `${quantity} × ${packQty} ${unit} = ${total} ${unit}`;
  }

  return `${quantity} × this variant`;
}

export default function App() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi, I’m Fetch. Tell me what you need done.",
      meta: null
    }
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [task, setTask] = useState(null);
  const [instamartDemo, setInstamartDemo] = useState(null);
  const [instamartLive, setInstamartLive] = useState(null);
  const [uberLive, setUberLive] = useState(null);
  const [selectedSpins, setSelectedSpins] = useState({});
  const [selectedPayment, setSelectedPayment] = useState("");
  const [selectedIntentApp, setSelectedIntentApp] = useState("");
  const [selectedGenerateUPIQR, setSelectedGenerateUPIQR] = useState(false);
  const [showInstamartConfirmation, setShowInstamartConfirmation] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState(null);
  const [activeNav, setActiveNav] = useState("chat");
  const [connectedPlugins, setConnectedPlugins] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fetch_connected_plugins") || "{}"); }
    catch { return {}; }
  });
  const [recentChats, setRecentChats] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("fetch_recent_chats") || "[]");
    } catch {
      return [];
    }
  });

  const activeWatchRef = useRef(null);
  const lastOrderMessageRef = useRef(new Map());

  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const conversationRef = useRef(getConversationId());

  async function send(rawText) {
    const text = String(rawText || "").trim();

    if (!text || busy) {
      return;
    }

    // Natural-language address selection should use the same saved address
    // ID as the visible Instamart address buttons.
    let conversationalInstamartAddressId = instamartLive?.addressId || null;
    if (
      !conversationalInstamartAddressId &&
      instamartLive?.status === "address_selection_required" &&
      Array.isArray(instamartLive?.addresses)
    ) {
      const normalizeAddress = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const requestedAddress = normalizeAddress(text);
      const requestedTokens = new Set(requestedAddress.split(" ").filter(Boolean));

      const match = instamartLive.addresses
        .map((address) => {
          const candidates = [
            address?.label,
            address?.name,
            address?.address,
            address?.formattedAddress,
            address?.addressLine,
            address?.addressLine2,
            address?.city,
            address?.landmark
          ].map(normalizeAddress).filter(Boolean);

          let bestScore = 0;
          for (const candidate of candidates) {
            const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
            let overlap = 0;
            for (const token of requestedTokens) {
              if (candidateTokens.has(token)) overlap += 1;
            }

            bestScore = Math.max(
              bestScore,
              requestedAddress === candidate ? 1000 :
              candidate.includes(requestedAddress) ? 800 + requestedAddress.length :
              requestedAddress.includes(candidate) ? 700 + candidate.length :
              (overlap / Math.max(1, requestedTokens.size)) * 100
            );
          }

          return { address, score: bestScore };
        })
        .sort((a, b) => b.score - a.score)[0];

      const matchedAddress = match?.score >= 55 ? match.address : null;

      conversationalInstamartAddressId =
        matchedAddress?.id || matchedAddress?.addressId || null;
    }

    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "user",
        text,
        meta: null
      }
    ]);

    setInput("");
    setBusy(true);

    // A typed saved address is an explicit Instamart workflow action.
    // Route it through the same prepare endpoint as the address buttons,
    // rather than allowing the general conversation model to reinterpret it.
    if (
      conversationalInstamartAddressId &&
      instamartLive?.status === "address_selection_required"
    ) {
      try {
        const response = await fetch("/api/fetch/swiggy/execute.mjs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            action: "prepare",
            conversationId: conversationRef.current,
            addressId: conversationalInstamartAddressId,
            items: (instamartLive?.requestedItems || []).map((item) => ({
              item: item.item || item.name,
              quantity: item.quantity || 1
            }))
          })
        });

        const data = await readApiJson(response);
        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || data?.error || "Could not prepare Instamart."
          );
        }

        setInstamartLive(data);
        setSelectedSpins({});
        setSelectedPayment("");
        setSelectedIntentApp("");
        setTask((current) => ({
          ...(current || {}),
          text: current?.text || text,
          latestText: text,
          stage:
            data.status === "awaiting_product_selection"
              ? "products ready"
              : data.status === "awaiting_checkout_confirmation"
                ? "cart ready for approval"
                : "coordinating",
          status: data.status,
          network: "Instamart",
          provider: { id: "swiggy_instamart", name: "Instamart" }
        }));
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text:
              data.message ||
              "Address selected. I’m checking live Instamart availability now.",
            meta: { status: data.status, network: "Instamart" }
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text:
              error?.message ||
              "I couldn't continue the Instamart request with that address.",
            meta: { status: "error", network: "Instamart" }
          }
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    // Once a live provider workflow exists, conversational follow-ups must
    // stay inside that workflow. Never send them back to the general agent.
    if (
      instamartLive?.status === "awaiting_product_selection" &&
      instamartLive?.addressId
    ) {
      const confirmationOnly = /^(ok|okay|yes|yeah|yep|sure|go ahead|continue|proceed|fine|that works|sounds good)[.! ]*$/i.test(text);

      try {
        const requestedItems = Array.isArray(instamartLive.requestedItems)
          ? instamartLive.requestedItems
          : [];

        const refinedItems = confirmationOnly
          ? requestedItems
          : requestedItems.length
            ? requestedItems.map((item, index) =>
                index === 0
                  ? {
                      item: text,
                      quantity: item.quantity || 1
                    }
                  : item
              )
            : [{ item: text, quantity: 1 }];

        const response = await fetch("/api/fetch/swiggy/execute.mjs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            action: "prepare",
            conversationId: conversationRef.current,
            addressId: instamartLive.addressId,
            items: refinedItems.map((item) => ({
              item: item.item || item.name,
              quantity: item.quantity || 1
            }))
          })
        });

        const data = await readApiJson(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || data?.error || "Could not continue the Instamart request.");
        }

        setInstamartLive(data);
        setSelectedSpins({});
        setSelectedPayment("");
        setSelectedIntentApp("");
        setTask((current) => ({
          ...(current || {}),
          latestText: text,
          status: data.status,
          stage:
            data.status === "awaiting_product_selection"
              ? "products ready"
              : data.status === "awaiting_checkout_confirmation"
                ? "cart ready for approval"
                : "coordinating",
          network: "Instamart",
          provider: { id: "swiggy_instamart", name: "Instamart" }
        }));

        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text:
              data.message ||
              "I’ve updated the Instamart request. Review the live matches.",
            meta: { status: data.status, network: "Instamart" }
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            text: error?.message || "I couldn't continue the live Instamart request.",
            meta: { status: "error", network: "Instamart" }
          }
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    // If Fetch is waiting for an address, don't let an unrelated follow-up
    // restart the entire shopping workflow.
    if (instamartLive?.status === "address_selection_required") {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: "Please choose one of the saved delivery addresses above so I can continue the Instamart order.",
          meta: { status: "address_selection_required", network: "Instamart" }
        }
      ]);
      setBusy(false);
      return;
    }

    setTask({
      text,
      stage: "understanding",
      status: "working"
    });

    try {
      const isPhysicalRequest =
        /\b(buy|get|fetch|bring|pick up|pickup|purchase|deliver|delivery|order|need|source|find)\b/i.test(text) &&
        !/\b(news|restaurant|weather|remember|calendar|book a flight|research|explain)\b/i.test(text);

      const isMobilityRequest =
        /\b(uber|rapido|cab|taxi|ride|bike taxi|auto|uberx|uber auto|airport ride)\b/i.test(text);

      const isProviderCandidate =
        /\b(instamart|swiggy|grocery|groceries|milk|bread|eggs|rice|snacks|biscuits|kitkat|munch|water|cab|taxi|ride|uber|rapido|bike taxi|auto)\b/i.test(text);

      let latitude = null;
      let longitude = null;

      if ((isPhysicalRequest && !isProviderCandidate || isMobilityRequest) && navigator.geolocation) {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 60000
            }
          );
        }).catch(() => null);

        if (position?.coords) {
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        }
      }

      const response = await fetch(
        API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            text,
            conversationId: conversationRef.current,
            channel: "web",
            latitude,
            longitude,
            suppliedContext: {
              instamart_payment_method: selectedPayment || null,
              instamart_intent_app: selectedIntentApp || null,
              instamart_address_id: conversationalInstamartAddressId
            },
            activeTask: task,
            history: messages
              .slice(-10)
              .map((item) => ({ role: item.role, text: item.text }))
          })
        }
      );

      const data = await readApiJson(response);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || data?.error || "Fetch request failed"
        );
      }

      const isConversation =
        data?.fetch?.intent?.domain === "general_agent" ||
        data?.execution?.execution_type === "general_agent";

      const route =
        data?.provider?.name ||
        data?.atc?.provider_name ||
        (!isConversation ? (data?.atc?.resource_type || data?.atc?.network || data?.fetch?.intent?.domain) : null) ||
        "conversation";

      const stage =
        data.status === "completed"
          ? "done"
          : data.status === "needs_clarification"
            ? "needs input"
            : data.status === "needs_location"
              ? "location needed"
              : data.status === "partner_offered"
                ? "partner store contacted"
                : data.status === "awaiting_customer_price_confirmation"
                  ? "price ready for approval"
                  : data.status === "finding_shopper"
                    ? "finding shopper"
                    : data.status === "shopper_assigned"
                      ? "shopper assigned"
                      : data.status === "shopping"
                        ? "shopping"
                        : data.status === "out_for_delivery"
                          ? "out for delivery"
                          : data.status === "delivered"
                            ? "delivered"
                            : isConversation
                              ? "conversation"
                              : "coordinating";

      const isExecution =
        !isConversation &&
        !!(
          data?.provider?.id ||
          data?.provider?.connect_url ||
          data?.provider?.action_url ||
          data?.execution?.side_effect ||
          data?.execution?.confirmation_required ||
          [
            "provider_ready",
            "provider_connection_required",
            "needs_clarification",
            "awaiting_location",
            "partner_offered",
            "awaiting_customer_price_confirmation",
            "finding_shopper",
            "shopper_assigned",
            "shopping",
            "picked_up",
            "out_for_delivery",
            "delivered",
            "order_placed"
          ].includes(data?.status)
        );

      if (data?.active_task) {
        setTask(data.active_task);
      } else if (isExecution) {
        setTask({
          text,
          latestText: text,
          objective: task?.objective || text,
          stage,
          status: data.status,
          domain: data?.fetch?.intent?.domain || null,
          intent: data?.fetch?.intent || null,
          entities: data?.fetch?.entities || null,
          plan: data?.fetch?.plan || null,
          network: route,
          workflowId: data.workflow_id,
          orderId: data.orderId || data.order_id || null,
          lastResponse: displayMessage(data.message)
        });
      } else {
        setTask(null);
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: displayMessage(data.message),
          meta:
            data?.provider?.connect_url ||
            data?.provider?.action_url ||
            data?.status === "awaiting_customer_price_confirmation"
              ? {
                  status: data.status,
                  network: route,
                  connect_url: data?.provider?.connect_url || null,
                  provider_name: data?.provider?.name || null,
                  provider_id: data?.provider?.id || null,
                  action_url: data?.provider?.action_url || null,
                  action_label: data?.provider?.action_label || null,
                  options: Array.isArray(data?.atc?.candidates)
                    ? data.atc.candidates.map((candidate) => ({
                        id: candidate.id || null,
                        name: candidate.name || candidate.id || "Option",
                        capabilities: candidate.capabilities || []
                      }))
                    : []
                }
              : null
        }
      ]);

      if (data?.provider?.id === "swiggy_instamart" && data?.instamart_preview) {
        setInstamartLive({ ...data.instamart_preview, requestedItems: data.instamart_preview.requestedItems || data.instamart_preview.searches?.map((s) => ({ item: s.requested, quantity: s.quantity })) || [] });
        setSelectedSpins({});
        setSelectedPayment("");
        setSelectedIntentApp("");
        setInstamartDemo(null);
      }

      if (data?.provider?.id === "uber" && data?.uber_preview) {
        setUberLive(data.uber_preview);
        setInstamartLive(null);
        setInstamartDemo(null);
      }

      const resolvedOrderId =
        data.orderId || data.order_id || null;

      if (resolvedOrderId) {
        localStorage.setItem(ACTIVE_ORDER_KEY, resolvedOrderId);
        watchOrder(resolvedOrderId, text);
      }
    } catch (error) {
      console.error("FETCH UI ERROR", error);

      setTask({
        text,
        stage: "error",
        status: "error"
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text:
            error?.message ||
            "I couldn’t process that right now.",
          meta: {
            status: "error"
          }
        }
      ]);
    } finally {
      setBusy(false);

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }

  async function runUberAction(action) {
    if (!uberLive || busy) return;

    setBusy(true);
    try {
      if (action === "checkout") {
        const response = await fetch("/api/fetch/uber/execute.mjs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            action: "checkout",
            conversationId: conversationRef.current,
            preview: uberLive,
            confirmed: true
          })
        });

        const data = await readApiJson(response);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || data?.error || "Uber could not request the ride.");
        }

        setUberLive((current) => ({ ...(current || {}), ...data, request_id: data.request_id }));
        setTask((current) => ({
          ...(current || {}),
          stage: "ride requested",
          status: data.status,
          network: "Uber",
          requestId: data.request_id
        }));
        setMessages((current) => [...current, {
          id: makeId(),
          role: "assistant",
          text: "Done — I’ve requested the Uber. I’ll keep you posted on the ride status.",
          meta: { status: data.status, network: "Uber" }
        }]);
      } else if (action === "track") {
        const response = await fetch("/api/fetch/uber/execute.mjs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            action: "track",
            conversationId: conversationRef.current,
            requestId: uberLive.request_id
          })
        });
        const data = await readApiJson(response);
        if (!response.ok || !data?.success) throw new Error(data?.message || data?.error || "Could not load the ride.");
        setUberLive((current) => ({ ...(current || {}), ...data, tracking: data.data }));
      }
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(),
        role: "assistant",
        text: error?.message || "I couldn't complete that Uber step.",
        meta: { status: "error", network: "Uber" }
      }]);
    } finally {
      setBusy(false);
    }
  }

  async function chooseInstamartAddress(addressId) {
    if (!addressId || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/fetch/swiggy/execute.mjs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "prepare",
          conversationId: conversationRef.current,
          addressId,
          autoSelect: instamartLive?.shoppingMode === "auto",
          items: (instamartLive?.requestedItems || []).map((item) => ({
            item: item.item || item.name,
            quantity: item.quantity || 1,
            ...(item.unit ? { unit: item.unit } : {})
          }))
        })
      });
      const data = await readApiJson(response);
      if (!response.ok || !data?.success) throw new Error(data?.message || data?.error || "Could not prepare Instamart.");
      setInstamartLive(data);
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(), role: "assistant",
        text: error?.message || "Could not select that address.",
        meta: { status: "error", network: "Instamart" }
      }]);
    } finally { setBusy(false); }
  }

  async function refreshInstamartTracking(orderId) {
    if (!orderId) return;
    try {
      const response = await fetch("/api/fetch/swiggy/execute.mjs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "track",
          conversationId: conversationRef.current,
          orderId
        })
      });
      const data = await readApiJson(response);
      if (response.ok && data?.success) {
        setInstamartLive((current) => ({
          ...(current || {}),
          tracking: data?.data || data?.text || data
        }));
      }
    } catch (error) {
      console.warn("FETCH INSTAMART TRACKING ERROR", error);
    }
  }

  function addAssistantMessage(text, meta = null) {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant" && last?.text === text) return current;
      return [...current, { id: makeId(), role: "assistant", text, meta }];
    });
  }

  async function runInstamartLiveAction(action) {
    if (!instamartLive || busy) return;

    setBusy(true);

    try {
      let payload;

      if (action === "selection") {
        const options = Array.isArray(instamartLive.productOptions)
          ? instamartLive.productOptions
          : [];

        const items = Object.values(selectedSpins)
          .map((spinId) => {
            const option = options.find((item) => item.spinId === spinId);
            return option ? { spinId: option.spinId, ...(option.skuId ? { skuId: option.skuId } : {}), quantity: option.quantity } : null;
          })
          .filter(Boolean);

        if (!items.length) throw new Error("Choose at least one product before building the cart.");

        payload = {
          action: "selection",
          conversationId: conversationRef.current,
          addressId: instamartLive.addressId,
          items
        };
      } else if (action === "checkout") {
        if (!selectedPayment) throw new Error("Choose a payment method before checkout.");

        payload = {
          action: "checkout",
          conversationId: conversationRef.current,
          addressId: instamartLive.addressId,
          paymentMethod: selectedPayment,
          ...(selectedPayment === "UPI" && selectedIntentApp && !selectedGenerateUPIQR ? { intentApp: selectedIntentApp } : {}),
          ...(selectedPayment === "UPI" && selectedGenerateUPIQR ? { generateUPIQR: true } : {}),
          confirmed: true
        };
      } else if (action === "payment_status") {
        const payment = instamartLive?.payment || {};
        const paasId = payment?.paasId || payment?.data?.paasId;
        if (!paasId) throw new Error("I don't have a valid payment reference yet. Please start payment again.");
        payload = {
          action: "payment_status",
          conversationId: conversationRef.current,
          paasId,
          orderId: payment?.orderId || instamartLive?.orderId || payment?.data?.orderId || undefined
        };
      } else {
        throw new Error("Unknown Instamart action.");
      }

      const response = await fetch("/api/fetch/swiggy/execute.mjs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await readApiJson(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || data?.error?.message || data?.error || "Instamart action failed");
      }

      setInstamartLive((current) => ({ ...(current || {}), ...data }));

      if (action === "selection") {
        setShowInstamartConfirmation(false);
        setTask((current) => ({ ...(current || {}), stage: "payment", status: data.status, network: "Instamart" }));
        addAssistantMessage(
          "Perfect. I’ve selected that exact product and prepared your order. Review the total and choose how you’d like to pay.",
          { status: data.status, network: "Instamart" }
        );
      } else {
        const orderId = data?.data?.orderId || data?.orderId || data?.order?.orderId || null;
        const pendingPayment = data.status === "awaiting_payment" || String(data?.data?.status || "").toUpperCase() === "PENDING_PAYMENT";

        if (action === "payment_status" && data.status === "payment_failed") {
          setTask((current) => ({ ...(current || {}), stage: "payment failed", status: data.status, network: "Instamart" }));
          setInstamartLive((current) => ({ ...(current || {}), status: "awaiting_checkout_confirmation", payment: null }));
          addAssistantMessage("The payment didn’t go through. Your order has not been placed. Choose another payment method and try again.", { status: "payment_failed", network: "Instamart" });
        } else if (pendingPayment) {
          setTask((current) => ({ ...(current || {}), stage: "payment pending", status: data.status, network: "Instamart", orderId }));
          setInstamartLive((current) => ({ ...(current || {}), payment: data.payment || data.data, orderId }));
          addAssistantMessage("Your order is ready for payment. Complete the payment below; Fetch will only mark it placed after payment succeeds.", { status: data.status, network: "Instamart" });
        } else if (action === "payment_status" && data.status === "order_placed") {
          setTask((current) => ({ ...(current || {}), stage: "order placed", status: data.status, network: "Instamart", orderId }));
          setInstamartLive((current) => ({ ...(current || {}), status: "order_placed", orderId, payment: data.payment || data.data }));
          addAssistantMessage("Payment received. Your Instamart order is confirmed.", { status: "order_placed", network: "Instamart" });
          if (orderId) void refreshInstamartTracking(orderId);
        } else {
          setTask((current) => ({ ...(current || {}), stage: "order placed", status: data.status, network: "Instamart", orderId }));
          setMessages((current) => [...current, {
            id: makeId(),
            role: "assistant",
            text: data?.message || "Instamart order placed successfully.",
            meta: { status: data.status, network: "Instamart" }
          }]);
          if (orderId) {
            setInstamartLive((current) => ({ ...(current || {}), orderId }));
            void refreshInstamartTracking(orderId);
          }
        }
      }
    } catch (error) {
      setMessages((current) => [...current, {
        id: makeId(),
        role: "assistant",
        text: error?.message || "The Instamart action failed.",
        meta: { status: "error", network: "Instamart" }
      }]);
    } finally {
      setBusy(false);
    }
  }

  async function runInstamartDemoAction(action) {
    if (!instamartDemo || busy) return;

    setBusy(true);
    setTask((current) => ({
      ...(current || {}),
      stage: action === "checkout" ? "placing demo order" : "building demo cart",
      status: "working",
      network: "Instamart · local demo"
    }));

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          text: task?.text || "Get me groceries",
          conversationId: conversationRef.current,
          channel: "web",
          demoAction: action,
          suppliedContext: { local_demo: true }
        })
      });

      const data = await readApiJson(response);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || data?.error || "Demo action failed");
      }

      if (data.instamart_preview) {
        setInstamartDemo(data.instamart_preview);
      }

      setTask((current) => ({
        ...(current || {}),
        stage: action === "checkout" ? "demo order placed" : "cart ready for approval",
        status: data.status,
        network: "Instamart · local demo"
      }));

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: data.message || "The demo step is ready.",
          meta: { status: data.status, network: "Instamart · local demo" }
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: error?.message || "The demo step failed.",
          meta: { status: "error", network: "Instamart · local demo" }
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function approveOrder() {
    const orderId = task?.orderId || localStorage.getItem(ACTIVE_ORDER_KEY);

    if (!orderId || busy) return;

    setBusy(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          action: "approve_order",
          orderId,
          conversationId: conversationRef.current
        })
      });

      const data = await readApiJson(response);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || data?.error || "Could not approve the order."
        );
      }

      setTask((current) => ({
        ...(current || {}),
        orderId,
        stage: "finding shopper",
        status: data.status,
        network: "shopper"
      }));

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: data.message || "Approved. Fetch is finding a shopper now.",
          meta: {
            status: data.status,
            network: "shopper"
          }
        }
      ]);

      void watchOrder(orderId, task?.text || "Your Fetch order");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: error?.message || "I couldn't approve that order.",
          meta: { status: "error", network: "Fetch" }
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function watchOrder(orderId, originalText = "") {
    if (!orderId) return;

    // Never create two polling loops for the same order.
    if (activeWatchRef.current === orderId) {
      return;
    }

    activeWatchRef.current = orderId;
    lastOrderMessageRef.current.delete(orderId);

    for (let check = 0; check < MAX_ORDER_CHECKS; check += 1) {
      if (check > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, ORDER_POLL_INTERVAL_MS)
        );
      }

      // The user may have started a different order while this one was
      // running. Stop this watcher rather than allowing old state to
      // overwrite the new conversation.
      const currentStoredOrder =
        localStorage.getItem(ACTIVE_ORDER_KEY);

      if (currentStoredOrder && currentStoredOrder !== orderId) {
        break;
      }

      try {
        const response = await fetch(
          `${API_URL}?orderId=${encodeURIComponent(orderId)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json"
            }
          }
        );

        const data = await readApiJson(response);

        if (!response.ok || !data?.success || !data?.order) {
          continue;
        }

        const order = data.order;
        const status = String(order.status || "unknown").toLowerCase();

        const route =
          [
            "finding_shopper",
            "shopper_assigned",
            "shopping",
            "picked_up",
            "out_for_delivery"
          ].includes(status)
            ? "shopper"
            : [
                "finding_partner",
                "partner_offered",
                "awaiting_customer_price_confirmation"
              ].includes(status)
              ? "partner_store"
              : "agent";

        let stage = "coordinating";

        if (status === "finding_partner") {
          stage = "finding partner store";
        } else if (status === "partner_offered") {
          stage = "partner store contacted";
        } else if (status === "awaiting_customer_price_confirmation") {
          stage = "price ready for approval";
        } else if (status === "finding_shopper") {
          stage = "finding shopper";
        } else if (status === "shopper_assigned") {
          stage = "shopper assigned";
        } else if (status === "shopping") {
          stage = "shopping";
        } else if (status === "picked_up") {
          stage = "picked up";
        } else if (status === "payment_pending") {
          stage = "payment pending";
        } else if (status === "out_for_delivery") {
          stage = "out for delivery";
        } else if (status === "delivered") {
          stage = "delivered";
        } else if (status === "cancelled") {
          stage = "cancelled";
        }

        setTask((current) => ({
          ...(current || {}),
          text: originalText || current?.text || "Fetch order",
          stage,
          status: order.status,
          network: route,
          workflowId: current?.workflowId || null,
          orderId
        }));

        const message = displayMessage(data.message, "").trim();
        const messageKey = `${status}::${message}`;
        const previousMessageKey =
          lastOrderMessageRef.current.get(orderId);

        if (message && messageKey !== previousMessageKey) {
          lastOrderMessageRef.current.set(orderId, messageKey);

          setMessages((current) => [
            ...current,
            {
              id: makeId(),
              role: "assistant",
              text: message,
              meta: {
                status: order.status,
                network: route
              }
            }
          ]);
        }

        if (data.terminal) {
          localStorage.removeItem(ACTIVE_ORDER_KEY);
          break;
        }
      } catch (error) {
        console.error("FETCH ORDER WATCH ERROR", error);
        // A temporary polling failure must not terminate the workflow.
      }
    }

    if (activeWatchRef.current === orderId) {
      activeWatchRef.current = null;
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("uber") === "connected"
      ? "Uber"
      : params.get("swiggy") === "connected"
        ? "Swiggy"
        : null;
    const returnedConversationId = params.get("conversationId");
    const swiggyConnected = params.get("swiggy") === "connected";
    const instamartConnected = params.get("instamart") === "connected";

    // Restore the exact Fetch conversation that initiated OAuth.
    if (returnedConversationId) {
      conversationRef.current = returnedConversationId;
      localStorage.setItem("fetch_conversation_id", returnedConversationId);
    }

    if (provider || swiggyConnected || instamartConnected) {
      setConnectedPlugins((current) => {
        const next = { ...current };
        if (provider) next[provider] = "connected";
        if (swiggyConnected || instamartConnected) {
          next.Swiggy = "connected";
          next.Instamart = "connected";
        }
        try { localStorage.setItem("fetch_connected_plugins", JSON.stringify(next)); } catch {}
        return next;
      });
      setConnectionNotice(
        swiggyConnected || instamartConnected
          ? "Swiggy and Instamart are connected to Fetch. Your next request can use either execution path."
          : provider + " is connected to Fetch. Your next request can use it directly."
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const savedOrderId = localStorage.getItem(ACTIVE_ORDER_KEY);

    if (!savedOrderId) return;

    // Resume an in-flight order after a page refresh.
    watchOrder(savedOrderId, "Your Fetch order");
  }, []);

  function startVoice() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Voice input is not supported in this browser yet."
      );
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onresult = (event) => {
      let transcript = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        transcript +=
          event.results[i][0].transcript;
      }

      setInput(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function saveRecentConversation(conversationId, conversationMessages) {
    const usable = Array.isArray(conversationMessages)
      ? conversationMessages.filter((message) => message.role === "user" || message.id === "welcome")
      : [];
    const title = usable.find((message) => message.role === "user")?.text || "New Fetch chat";
    if (!usable.some((message) => message.role === "user")) return;

    const record = {
      id: conversationId,
      title: title.slice(0, 72),
      messages: conversationMessages,
      updatedAt: Date.now()
    };

    setRecentChats((current) => {
      const next = [record, ...current.filter((item) => item.id !== conversationId)].slice(0, 12);
      try { localStorage.setItem("fetch_recent_chats", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function openRecentChat(chat) {
    if (!chat?.id || !Array.isArray(chat.messages)) return;
    activeWatchRef.current = null;
    conversationRef.current = chat.id;
    try { localStorage.setItem("fetch_conversation_id", chat.id); } catch {}
    setMessages(chat.messages);
    setTask(null);
    setInstamartDemo(null);
    setInstamartLive(null);
    setUberLive(null);
    setSelectedSpins({});
    setSelectedPayment("");
    setSelectedIntentApp("");
    setActiveNav("chat");
    setInput("");
  }

  function connectPlugin(name) {
    const conversationId = conversationRef.current;
    const routes = {
      Swiggy: { url: "/api/fetch/swiggy/connect.mjs?conversationId=" + encodeURIComponent(conversationId), mode: "connect" },
      Uber: { url: "/api/fetch/uber/connect.mjs?conversationId=" + encodeURIComponent(conversationId), mode: "connect" },
      Rapido: { url: null, mode: "pending" },
      Zomato: { url: null, mode: "pending" },
      Email: { url: "/api/fetch/gmail/connect.mjs?conversationId=" + encodeURIComponent(conversationId), mode: "connect" },
      Calendar: { url: null, mode: "pending" }
    };

    const route = routes[name];
    if (!route) return;

    if (route.mode === "pending") {
      setConnectionNotice(
        name + " is not connected to Fetch yet. We will enable this plugin once its live Fetch connector is ready."
      );
      return;
    }

    if (route.mode === "open") {
      window.open(route.url, "_blank", "noopener,noreferrer");
      return;
    }

    setConnectedPlugins((current) => {
      const next = { ...current, [name]: "connecting" };
      try { localStorage.setItem("fetch_connected_plugins", JSON.stringify(next)); } catch {}
      return next;
    });
    window.location.href = route.url;
  }

  function selectPartnerCategory(category) {
    setActiveNav("chat");
    setInput("Find a " + category.toLowerCase() + " service for me");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (messages.some((message) => message.role === "user")) {
      saveRecentConversation(conversationRef.current, messages);
    }
  }, [messages]);

  function clearConversation() {
    activeWatchRef.current = null;
    localStorage.removeItem(ACTIVE_ORDER_KEY);

    saveRecentConversation(conversationRef.current, messages);

    const newConversation = `web:${makeId()}`;

    localStorage.setItem(
      "fetch_conversation_id",
      newConversation
    );

    conversationRef.current = newConversation;

    setMessages([
      {
        id: makeId(),
        role: "assistant",
        text: "Fresh start. What do you need done?",
        meta: null
      }
    ]);

    setTask(null);
    setInstamartDemo(null);
    setInstamartLive(null);
    setSelectedSpins({});
    setSelectedPayment("");
    setInput("");

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }

  const hasUserMessage = messages.some(
    (message) => message.role === "user"
  );

  return (
    <div className="app">

      <style>{`
        .instamartLiveCard { margin-top:14px; padding:14px; border:1px solid #e6e6e6; border-radius:14px; background:#fff; }
        .liveBadge { font-size:9px; font-weight:800; letter-spacing:.08em; opacity:.55; margin-bottom:10px; }
        .liveProduct { display:flex; gap:10px; align-items:flex-start; padding:10px 0; border-bottom:1px solid #eee; }
        .liveProduct input { margin-top:4px; }
        .liveProductInfo { flex:1; display:flex; flex-direction:column; gap:3px; font-size:12px; }
        .liveProductInfo small { opacity:.55; }
        .paymentBox { margin-top:12px; padding:10px; border-radius:10px; background:#f7f7f7; }
        .paymentBox label { display:flex; gap:8px; align-items:center; font-size:12px; padding:7px 0; }
        .liveAddress { font-size:11px; opacity:.65; margin-bottom:8px; }
        .liveCartTotal { display:flex; justify-content:space-between; padding:12px 0 2px; font-size:14px; font-weight:800; }
        .instamartDemoCard {
          margin-top: 14px;
          padding: 14px;
          border: 1px solid #e8e8e8;
          border-radius: 14px;
          background: #fafafa;
        }
        .demoBadge { font-size: 9px; font-weight: 800; letter-spacing: .08em; margin-bottom: 8px; opacity: .55; }
        .demoAddress { font-size: 11px; margin-bottom: 10px; opacity: .65; }
        .demoProduct, .demoTotal { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid #ededed; font-size:12px; }
        .demoProduct span { display:flex; flex-direction:column; gap:2px; }
        .demoProduct small { opacity:.55; }
        .demoTotal.grand { border-bottom:0; padding-top:12px; font-size:14px; }
        .demoTracking { display:flex; flex-direction:column; gap:4px; margin-top:12px; padding:10px; border-radius:10px; background:#fff; font-size:11px; }
        .demoTracking span { opacity:.65; }
        .approvalButton {
          margin-top: 12px;
          width: 100%;
          border: 0;
          border-radius: 12px;
          padding: 11px 14px;
          background: #111;
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .approvalButton:hover { opacity: .88; }
        .approvalButton:disabled { opacity: .5; cursor: default; }
      `}</style>

      <aside className="fetchSidebar">
        <div className="fetchSidebarBrand">
          <button className="fetchSidebarLogo" onClick={() => setActiveNav("chat")}>F.</button>
          <div>
            <strong>Fetch</strong>
            <small>Personal assistant</small>
          </div>
        </div>

        <button className="fetchNewChat" onClick={() => { clearConversation(); setActiveNav("chat"); }}>
          <span>＋</span> New chat
        </button>

        <nav className="fetchNavSection">
          <button className={activeNav === "chat" ? "active" : ""} onClick={() => setActiveNav("chat")}>
            <span>⌂</span> Chat
          </button>
          <button className={activeNav === "recent" ? "active" : ""} onClick={() => setActiveNav("recent")}>
            <span>◷</span> Recent chats
          </button>
          <button className={activeNav === "plugins" ? "active" : ""} onClick={() => setActiveNav("plugins")}>
            <span>◈</span> Plugins
          </button>
          <button className={activeNav === "partners" ? "active" : ""} onClick={() => setActiveNav("partners")}>
            <span>⌁</span> Fetch Partners
          </button>
        </nav>

        {activeNav === "recent" && (
          <div className="fetchSidebarPanel">
            <small className="fetchPanelLabel">RECENT CHATS</small>
            {recentChats.length ? recentChats.map((chat) => (
              <button className="fetchRecentChat" key={chat.id} onClick={() => openRecentChat(chat)}>
                <span>{chat.title}</span>
                <small>{new Date(chat.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small>
              </button>
            )) : (
              <p className="fetchEmptyPanel">Your recent conversations will appear here.</p>
            )}
          </div>
        )}

        {activeNav === "plugins" && (
          <div className="fetchSidebarPanel fetchPluginMarketplace">
            <small className="fetchPanelLabel">FETCH CONNECTORS</small>
            <p className="fetchPluginIntro">Connect the services you already use. Fetch chooses the right one when you ask.</p>

            {[
              {
                category: "🍔 Food & Grocery",
                items: [
                  ["Swiggy", "Food & grocery"],
                  ["Zomato", "Food delivery"],
                  ["Instamart", "Instant grocery"]
                ]
              },
              {
                category: "🛍️ Shopping",
                items: [
                  ["Amazon", "Everything you need"],
                  ["Flipkart", "Online shopping"],
                  ["Myntra", "Fashion & lifestyle"]
                ]
              },
              {
                category: "✈️ Travel",
                items: [
                  ["Booking.com", "Hotels & stays"],
                  ["Skyscanner", "Flights & travel search"],
                  ["ixigo", "Flights, trains & buses"]
                ]
              },
              {
                category: "🚕 Mobility",
                items: [
                  ["Uber", "Rides & mobility"],
                  ["Rapido", "Bike, auto & cab"]
                ]
              },
              {
                category: "📧 Productivity",
                items: [
                  ["Email", "Send & manage email"],
                  ["Calendar", "Schedule & manage events"]
                ]
              }
            ].map((group) => (
              <div className="fetchPluginGroup" key={group.category}>
                <div className="fetchPluginCategory">{group.category}</div>
                {group.items.map(([name, description]) => {
                  const status =
                    connectedPlugins[name] === "connected" ? "Connected" :
                    ["Swiggy", "Uber", "Email"].includes(name) ? "Connect" : "Coming soon";
                  return (
                    <button className="fetchPluginRow" key={name} onClick={() => connectPlugin(name)}>
                      <span className="fetchPluginIcon">{name === "Booking.com" ? "B" : name === "Skyscanner" ? "S" : name === "ixigo" ? "i" : name.slice(0, 1)}</span>
                      <span><strong>{name}</strong><small>{description}</small></span>
                      <b>{status}</b>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {activeNav === "partners" && (
          <div className="fetchSidebarPanel">
            <small className="fetchPanelLabel">FETCH PARTNERS</small>
            {[
              ["🏪", "Local Commerce", "Grocery, bakery, pharmacy, restaurants"],
              ["🔧", "Home Services", "Plumber, electrician, AC repair"],
              ["🚕", "Mobility", "Local taxi & drivers"],
              ["❤️", "Assisted Services", "Elder care"]
            ].map(([icon, name, description]) => (
              <button className="fetchPartnerRow" key={name} onClick={() => selectPartnerCategory(name)}>
                <span className="fetchPartnerIcon">{icon}</span>
                <span><strong>{name}</strong><small>{description}</small></span>
                <b>→</b>
              </button>
            ))}
          </div>
        )}
      </aside>

      <header>
        <button
          className="brand"
          onClick={clearConversation}
        >
          fetch<span>.</span>
        </button>

        <div className="top">
          <span className="ready">
            <i />
            Fetch is ready
          </span>

          <button onClick={clearConversation}>
            New
          </button>
        </div>
      </header>

      <main>

        <section className="intro">
          <small>PERSONAL AI AGENT</small>

          <h1>
            Tell Fetch what you need.
            <br />
            <em>Fetch figures out the rest.</em>
          </h1>

          <p>
            Text naturally. Fetch understands the task,
            chooses the right service and executes the work
            for you.
          </p>
        </section>

        <section className="workspace">

          <div className="chat">

            <div className="chatHead">

              <div className="identity">

                <b>F.</b>

                <span>
                  <strong>Fetch</strong>
                  <small>Personal assistant</small>
                </span>

              </div>

              <label>
                PRIVATE SESSION
              </label>

            </div>

            <div className="messages">

              {messages.map((message) => (

                <div
                  className={`row ${message.role}`}
                  key={message.id}
                >

                  {message.role === "assistant" && (
                    <b className="tiny">
                      F.
                    </b>
                  )}

                  <div
                    className={`bubble ${message.role}`}
                  >

                    {message.role === "assistant" ? (
                      <AssistantMessage text={message.text} />
                    ) : (
                      message.text
                    )}

                    {message.role === "assistant" &&
                      Array.isArray(message.meta?.options) &&
                      message.meta.options.length > 0 && (
                        <div className="fetchOptionList">
                          {message.meta.options.map((option) => (
                            <button
                              key={option.id || option.name}
                              type="button"
                              className="fetchOptionButton"
                              onClick={() => send(option.name)}
                              disabled={busy}
                            >
                              <span>
                                <strong>{option.name}</strong>
                                <small>
                                  {option.capabilities?.length
                                    ? option.capabilities.join(" · ")
                                    : "Continue with this option"}
                                </small>
                              </span>
                              <b>Choose →</b>
                            </button>
                          ))}
                        </div>
                      )}

                    {message.id === messages[messages.length - 1]?.id && uberLive && (
                      <div className="instamartLiveCard uberLiveCard">
                        <div className="liveBadge">LIVE UBER · FETCH EXECUTION</div>
                        <div style={{fontSize:"13px",fontWeight:800,marginTop:"8px"}}>
                          {uberLive.pickup?.label || "Current location"} → {uberLive.destination?.label || "Destination"}
                        </div>

                        {uberLive.status === "order_placed" || uberLive.request_id ? (
                          <>
                            <div style={{fontSize:"12px",fontWeight:800,marginTop:"12px"}}>Ride requested ✓</div>
                            <div className="demoTotal">
                              <span>Status</span><b>{uberLive.status || "processing"}</b>
                            </div>
                            <div className="demoTotal">
                              <span>Request</span><b>{uberLive.request_id || "—"}</b>
                            </div>
                            {uberLive.tracking && (
                              <div className="demoTracking">
                                <strong>Live ride</strong>
                                <span>{uberLive.tracking?.status || "Updating…"}</span>
                              </div>
                            )}
                            <button type="button" className="approvalButton" onClick={() => runUberAction("track")} disabled={busy}>
                              Refresh ride status
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="demoProduct">
                              <span>
                                <strong>{uberLive.product?.display_name || "Uber"}</strong>
                                <small>{uberLive.trip?.duration_estimate ? Math.round(Number(uberLive.trip.duration_estimate) / 60) + " min trip" : "Ride estimate"}</small>
                              </span>
                              <b>{uberLive.fare?.display || (uberLive.fare?.value != null ? "₹" + uberLive.fare.value : "Fare shown by Uber")}</b>
                            </div>
                            <div className="demoTotal">
                              <span>Pickup ETA</span>
                              <b>{uberLive.pickup_estimate != null ? uberLive.pickup_estimate + " min" : "—"}</b>
                            </div>
                            <div className="demoTotal">
                              <span>Destination</span>
                              <b>{uberLive.destination?.label || "—"}</b>
                            </div>
                            <button type="button" className="approvalButton" onClick={() => runUberAction("checkout")} disabled={busy}>
                              Confirm & request Uber
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {message.id === messages[messages.length - 1]?.id && instamartLive && (
                      <div className="instamartLiveCard">
                        <div className="liveBadge">LIVE INSTAMART · FETCH EXECUTION</div>

                        {instamartLive.address && (
                          <div className="liveAddress">
                            Deliver to: {instamartLive.address?.label || instamartLive.address?.address || "Saved Swiggy address"}
                          </div>
                        )}

                        {instamartLive.status === "address_selection_required" ? (
                          <>
                            <div className="instamartSectionTitle">Where should I deliver it?</div>
                            <div className="instamartAddressList">
                              {(instamartLive.addresses || []).map((address) => {
                                const id = address?.id || address?.addressId;
                                return (
                                  <button
                                    type="button"
                                    className="instamartAddressButton"
                                    key={id}
                                    onClick={() => chooseInstamartAddress(id)}
                                    disabled={busy}
                                  >
                                    <span className="instamartAddressText">
                                      <strong>{address?.label || address?.name || "Saved address"}</strong>
                                      <small>{address?.address || address?.formattedAddress || address?.addressLine || ""}</small>
                                    </span>
                                    <span className="instamartAddressArrow">→</span>
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        ) : instamartLive.status === "awaiting_product_selection" && !instamartLive.productOptions?.length ? (
                          <div className="instamartEmptyState">
                            <strong>No live matches returned</strong>
                            <span>{instamartLive.message || "Instamart did not return a usable product match."}</span>
                            {Array.isArray(instamartLive.requestedItems) && instamartLive.requestedItems.length > 0 && (
                              <small>
                                Searched for: {instamartLive.requestedItems.map((item) => (item.quantity || 1) + " × " + (item.item || item.name)).join(" · ")}
                              </small>
                            )}
                          </div>
                        ) : instamartLive.status === "order_placed" ? (
                          <>
                            <div style={{fontSize:"12px",fontWeight:800}}>Order placed ✓</div>
                            <div style={{fontSize:"11px",opacity:.65,marginTop:"8px"}}>
                              Fetch completed the Instamart checkout. Order ID:
                            </div>
                            <div className="liveCartTotal">
                              <span>Order</span>
                              <span>{instamartLive.orderId || instamartLive.data?.orderId || "Confirmed"}</span>
                            </div>
                            {instamartLive.tracking && (
                              <div className="demoTracking">
                                <strong>Live status</strong>
                                <span>{instamartLive.tracking?.message || instamartLive.tracking?.status || instamartLive.tracking}</span>
                              </div>
                            )}
                          </>
                        ) : instamartLive.status === "awaiting_product_selection" && instamartLive.productOptions?.length ? (
                          <>
                            {Object.entries(
                              instamartLive.productOptions.reduce((groups, item) => {
                                const key = item.requested || item.name;
                                groups[key] = groups[key] || [];
                                groups[key].push(item);
                                return groups;
                              }, {})
                            ).map(([requested, options]) => (
                              <div key={requested} className="instamartProductGroup">
                                <div className="instamartRequestHeader">
                                  <strong>{requested}</strong>
                                  <span>{formatRequestedQuantity(options[0])}</span>
                                </div>
                                <div className="instamartMatchHint">Choose the exact product you want. I’ll add the selected item and the required quantity to your live cart.</div>
                                {options.map((option) => (
                                  <label className="instamartProductOption" key={option.spinId}>
                                    <input
                                      type="radio"
                                      name={`fetch-product-${requested}`}
                                      checked={selectedSpins[requested] === option.spinId}
                                      disabled={option.inStock === false || busy}
                                      onChange={() => setSelectedSpins((current) => ({ ...current, [requested]: option.spinId }))}
                                    />
                                    <span className="instamartProductCopy">
                                      <span className="instamartProductTop">
                                        <strong>{option.name || requested}</strong>
                                        {option.inStock === false ? <em>Out of stock</em> : <em>Available</em>}
                                      </span>
                                      <span className="instamartProductMeta">
                                        {option.pack ? <span>{option.pack}</span> : null}
                                        {option.price != null ? <span>₹{option.price}</span> : <span>Price unavailable</span>}
                                      </span>
                                      <span className="instamartProductMatch">For your request: {formatRequestedQuantity(option)}</span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ))}
                            <button
                              type="button"
                              className="approvalButton"
                              onClick={() => setShowInstamartConfirmation(true)}
                              disabled={busy || !Object.keys(selectedSpins).length}
                            >
                              Review & continue
                            </button>
                          </>
                        ) : ["awaiting_checkout_confirmation", "awaiting_payment"].includes(instamartLive.status) && instamartLive.cart ? (
                          <>
                            {instamartLive.status === "awaiting_payment" && (
                              <div className="instamartEmptyState" style={{marginBottom:"12px"}}>
                                <strong>Payment is required to finish this order</strong>
                                <span>Fetch has prepared and verified the live cart. The order will not be marked placed until payment succeeds.</span>
                              </div>
                            )}
                            <div style={{fontSize:"12px",fontWeight:800}}>Live cart</div>
                            <div style={{fontSize:"11px",opacity:.65,marginTop:"8px"}}>
                              Your order is ready. Review the items, delivery address and total before paying.
                            </div>
                            {(() => {
                              const cartData = getInstamartCartData(instamartLive.cart);
                              const pricing = getInstamartPricing(instamartLive.cart);
                              const cartItems = Array.isArray(cartData?.items)
                                ? cartData.items
                                : Array.isArray(cartData?.cartItems)
                                  ? cartData.cartItems
                                  : [];
                              const total = pricing?.to_pay ?? cartData?.to_pay ?? cartData?.billToPay ?? "—";
                              return (
                                <>
                                  {cartItems.length > 0 && (
                                    <div style={{marginTop:"10px"}}>
                                      {cartItems.map((item, index) => (
                                        <div className="demoProduct" key={item.spinId || item.id || item.name || index}>
                                          <span>
                                            <strong>{item.quantity || 1} × {item.name || "Instamart item"}</strong>
                                            <small>₹{item.final_price ?? item.price ?? item.subtotal ?? "—"}</small>
                                          </span>
                                          <b>₹{item.total ?? item.subtotal ?? item.final_price ?? "—"}</b>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="demoTotal">
                                    <span>Items</span><b>₹{pricing?.item_total ?? pricing?.subtotal ?? "—"}</b>
                                  </div>
                                  <div className="demoTotal">
                                    <span>Delivery</span><b>₹{pricing?.delivery_charge ?? pricing?.deliveryCharge ?? "—"}</b>
                                  </div>
                                  <div className="demoTotal">
                                    <span>Taxes & charges</span><b>₹{pricing?.taxes_and_charges ?? pricing?.taxes ?? "—"}</b>
                                  </div>
                                  <div className="liveCartTotal">
                                    <span>Total to pay</span>
                                    <span>₹{total}</span>
                                  </div>
                                </>
                              );
                            })()}

                            {instamartLive.status === "awaiting_payment" && (
                              <div className="fetchPaymentStatusCard">
                                <div className="fetchPaymentStatusTitle">Payment in progress</div>
                                <div className="fetchPaymentStatusText">
                                  Complete the payment using the option below. Fetch will confirm the order only after the payment succeeds.
                                </div>
                                {instamartLive.payment?.upiIntentUrl && (
                                  <a
                                    href={instamartLive.payment.upiIntentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="approvalButton"
                                    style={{display:"block",textAlign:"center",textDecoration:"none",marginTop:"10px"}}
                                  >
                                    Open UPI payment
                                  </a>
                                )}
                                {instamartLive.payment?.isQrFlow && (
                                  <div className="fetchPaymentQrHint">
                                    Scan the payment QR shown by your payment provider to complete the order.
                                  </div>
                                )}
                              </div>
                            )}

                            {instamartLive.status === "awaiting_payment" && instamartLive.payment && (
                              <div className="fetchPaymentStatusCard">
                                <strong>Payment is waiting for you</strong>
                                <span>Complete the payment below. Fetch will confirm the order only after payment succeeds.</span>
                                {instamartLive.payment?.upiIntentUrl && (
                                  <a
                                    href={instamartLive.payment.upiIntentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="approvalButton"
                                    style={{display:"block",textAlign:"center",textDecoration:"none",marginTop:"10px"}}
                                  >
                                    Open UPI payment
                                  </a>
                                )}
                                {instamartLive.payment?.isQrFlow && (
                                  <div className="fetchPaymentQrHint">
                                    Scan the UPI QR provided by the payment flow to complete payment.
                                  </div>
                                )}
                                <button
                                  type="button"
                                  className="approvalButton fetchPaymentCheckButton"
                                  onClick={() => runInstamartLiveAction("payment_status")}
                                  disabled={busy}
                                >
                                  I’ve paid — check my order
                                </button>
                              </div>
                            )}

                            <div className="paymentBox">
                              <strong style={{fontSize:"11px"}}>How would you like to pay?</strong>
                              {getInstamartPaymentMethods(instamartLive.paymentOptions, instamartLive.cart).length ? (
                                <>
                                  {getInstamartPaymentMethods(instamartLive.paymentOptions, instamartLive.cart).map((method) => {
                                    const group = String(method?.groupName || method?.id || "");
                                    const isUpi = group.toUpperCase() === "UPI";
                                    return (
                                      <label className="fetchPaymentChoice" key={method.id || group}>
                                        <input
                                          type="radio"
                                          name="fetch-payment"
                                          value={group}
                                          checked={selectedPayment === group && (!isUpi || (!selectedGenerateUPIQR && selectedIntentApp === method.id))}
                                          onChange={() => {
                                            setSelectedPayment(group);
                                            if (isUpi) {
                                              setSelectedIntentApp(method.id || "");
                                              setSelectedGenerateUPIQR(false);
                                            } else {
                                              setSelectedIntentApp("");
                                              setSelectedGenerateUPIQR(false);
                                            }
                                          }}
                                        />
                                        <span>
                                          <strong>{method.displayName || (isUpi ? "UPI" : group === "Cash" || group === "COD" ? "Cash on delivery" : group)}</strong>
                                          <small>{isUpi ? "Pay securely with UPI" : "Use the payment method available for this order"}</small>
                                        </span>
                                      </label>
                                    );
                                  })}
                                  {getInstamartPaymentMethods(instamartLive.paymentOptions, instamartLive.cart).some((method) => String(method?.groupName || method?.id || "").toUpperCase() === "UPI") && (
                                    <label className="fetchPaymentChoice">
                                      <input
                                        type="radio"
                                        name="fetch-payment"
                                        value="UPI-QR"
                                        checked={selectedPayment === "UPI" && selectedGenerateUPIQR}
                                        onChange={() => {
                                          setSelectedPayment("UPI");
                                          setSelectedIntentApp("");
                                          setSelectedGenerateUPIQR(true);
                                        }}
                                      />
                                      <span>
                                        <strong>Scan UPI QR</strong>
                                        <small>Best option on desktop</small>
                                      </span>
                                    </label>
                                  )}
                                </>
                              ) : (
                                <div className="instamartEmptyState">
                                  <strong>Payment options unavailable</strong>
                                  <span>Fetch couldn't retrieve the live payment methods for this cart. The order has not been placed.</span>
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              className="approvalButton"
                              onClick={() => runInstamartLiveAction("checkout")}
                              disabled={busy || !selectedPayment}
                            >
                              Continue to payment
                            </button>
                          </>
                        ) : (
                          <div className="instamartLoadingState">
                            <span className="instamartSpinner" aria-hidden="true" />
                            <span>Loading live Instamart results…</span>
                          </div>
                        )}
                      </div>
                    )}

                    {message.id === messages[messages.length - 1]?.id && instamartDemo && (
                      <div className="instamartDemoCard">
                        <div className="demoBadge">LOCAL SWIGGY DEMO · NO REAL ORDER</div>
                        <div className="demoAddress">{instamartDemo.address}</div>
                        {instamartDemo.products?.map((item) => (
                          <div className="demoProduct" key={item.requested}>
                            <span>
                              <strong>{item.quantity} × {item.name}</strong>
                              <small>{item.pack} · ₹{item.price}</small>
                            </span>
                            <b>₹{item.line_total}</b>
                          </div>
                        ))}
                        <div className="demoTotal">
                          <span>Items</span><b>₹{instamartDemo.subtotal}</b>
                        </div>
                        <div className="demoTotal">
                          <span>Delivery</span><b>₹{instamartDemo.delivery_fee}</b>
                        </div>
                        <div className="demoTotal grand">
                          <span>Total</span><b>₹{instamartDemo.total}</b>
                        </div>
                        {instamartDemo.order_id ? (
                          <div className="demoTracking">
                            <strong>Demo order {instamartDemo.order_id}</strong>
                            <span>{instamartDemo.tracking}</span>
                          </div>
                        ) : instamartDemo.subtotal != null ? (
                          <button
                            type="button"
                            className="approvalButton"
                            onClick={() =>
                              runInstamartDemoAction(
                                task?.stage === "cart ready for approval" ||
                                task?.status === "awaiting_checkout_confirmation"
                                  ? "checkout"
                                  : "cart"
                              )
                            }
                            disabled={busy}
                          >
                            {task?.stage === "cart ready for approval" ||
                            task?.status === "awaiting_checkout_confirmation"
                              ? "Place demo order"
                              : "Build cart"}
                          </button>
                        ) : null}
                      </div>
                    )}

                    {message.meta?.action_url && (
                      <div className="providerConnectCard">
                        <div>
                          <strong>Continue with Rapido</strong>
                          <span>Fetch has prepared the handoff. Confirm your trip details in Rapido before booking.</span>
                        </div>
                        <a
                          className="approvalButton"
                          href={message.meta.action_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {message.meta.action_label || "Open service"}
                        </a>
                      </div>
                    )}

                    {message.meta?.connect_url && (
                      <div className="providerConnectCard">
                        <div>
                          <strong>One-time connection</strong>
                          <span>Connect {message.meta?.provider_name || "this service"} to Fetch so I can execute this task for you.</span>
                        </div>
                        <button
                          type="button"
                          className="approvalButton"
                          onClick={() => window.location.href = message.meta.connect_url}
                          disabled={busy}
                        >
                          Connect {message.meta?.provider_name || "service"}
                        </button>
                      </div>
                    )}

                    {message.meta?.status === "awaiting_customer_price_confirmation" && (
                      <button
                        type="button"
                        className="approvalButton"
                        onClick={approveOrder}
                        disabled={busy}
                      >
                        Approve order
                      </button>
                    )}

                    {message.meta?.status === "error" && (
                      <small className="meta">
                        Something went wrong. Please try again.
                      </small>
                    )}

                  </div>

                </div>

              ))}

              {busy && (

                <div className="row assistant">

                  <b className="tiny">
                    F.
                  </b>

                  <div className="bubble assistant thinking">

                    <i />
                    <i />
                    <i />

                    <small>
                      Figuring it out…
                    </small>

                  </div>

                </div>

              )}

            </div>

            <div className="composeArea">

              {!hasUserMessage && (

                <div className="starters">

                  {starters.map((starter) => (

                    <button
                      key={starter}
                      onClick={() =>
                        send(starter)
                      }
                    >
                      {starter}
                    </button>

                  ))}

                </div>

              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(input);
                }}
              >

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) =>
                    setInput(event.target.value)
                  }
                  onKeyDown={(event) => {

                    if (
                      event.key === "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      send(input);
                    }

                  }}
                  placeholder="Tell Fetch what you need…"
                  rows="1"
                  disabled={busy}
                />

                <button
                  type="button"
                  className={
                    listening ? "listen" : ""
                  }
                  onClick={startVoice}
                  aria-label="Voice input"
                >
                  {listening ? "●" : "⌕"}
                </button>

                <button
                  className="send"
                  disabled={
                    !input.trim() || busy
                  }
                  aria-label="Send"
                >
                  ↑
                </button>

              </form>

              <small className="hint">
                Enter to send · Fetch may ask for
                confirmation before an action
              </small>

            </div>

          </div>

          <aside>

            <small>FETCH · EXECUTION LAYER</small>

            <h2>
              You ask.
              <br />
              <em>Fetch acts.</em>
            </h2>

            <p>
              You don't need to know which app to use.
              Fetch decides the execution path and handles
              the handoff behind the scenes.
            </p>

            <div className="flow">

              {[
                [
                  "01",
                  "Understand",
                  "Intent + context"
                ],
                [
                  "02",
                  "Plan",
                  "Task + workflow"
                ],
                [
                  "03",
                  "ATC",
                  "Choose service"
                ],
                [
                  "04",
                  "Act",
                  "Execute + confirm"
                ]
              ].map((item, index) => (

                <React.Fragment key={item[0]}>

                  <div
                    className={`node ${
                      index === 0
                        ? "active"
                        : ""
                    }`}
                  >

                    <b>{item[0]}</b>

                    <span>
                      <strong>
                        {item[1]}
                      </strong>

                      <small>
                        {item[2]}
                      </small>
                    </span>

                  </div>

                  {index < 3 && (
                    <i className="line" />
                  )}

                </React.Fragment>

              ))}

            </div>

            {task && (

              <div className="live">

                <small>
                  LIVE TASK · {task.stage}
                </small>

                <p>
                  {task.text}
                </p>

                {task.network && (
                  <span>
                    Route{" "}
                    <b>{task.network}</b>
                  </span>
                )}

              </div>

            )}

            <div className="networks">

              <b>
                ◌
                <small>
                  Digital
                </small>
              </b>

              <b>
                ◇
                <small>
                  Physical
                </small>
              </b>

              <b>
                ⌁
                <small>
                  Human
                </small>
              </b>

            </div>

            <p className="note">
              Internal routing stays behind Fetch.
              Ask once. Fetch coordinates the service,
              executes the task and keeps you updated.
            </p>

          </aside>

        </section>

        <section className="statement">

          <small>THE IDEA</small>

          <h2>
            Don’t learn another app.
            <br />
            <em>Delegate the task.</em>
          </h2>

        </section>

        {showInstamartConfirmation && instamartLive?.productOptions?.length > 0 && (
          <div className="fetchModalBackdrop" role="presentation">
            <div className="fetchConfirmModal" role="dialog" aria-modal="true" aria-labelledby="fetch-confirm-title">
              <div className="fetchModalEyebrow">FETCH · CONFIRM YOUR SELECTION</div>
              <h2 id="fetch-confirm-title">Is this the order you want?</h2>
              <p className="fetchModalIntro">
                Review the selected Instamart items before Fetch builds your live cart.
              </p>

              <div className="fetchConfirmSummary">
                {Object.values(selectedSpins).map((spinId) => {
                  const option = (instamartLive.productOptions || []).find((item) => item.spinId === spinId);
                  if (!option) return null;
                  return (
                    <div className="fetchConfirmItem" key={spinId}>
                      <div>
                        <strong>{option.name || option.requested}</strong>
                        <span>{formatRequestedQuantity(option)}</span>
                      </div>
                      <b>{option.price != null ? `₹${option.price}` : "Price shown in cart"}</b>
                    </div>
                  );
                })}
              </div>

              <div className="fetchConfirmAddress">
                <span>Deliver to</span>
                <strong>{instamartLive.address?.label || instamartLive.address?.address || "Saved Instamart address"}</strong>
              </div>

              <div className="fetchModalActions">
                <button type="button" className="fetchModalSecondary" onClick={() => setShowInstamartConfirmation(false)} disabled={busy}>
                  Change selection
                </button>
                <button type="button" className="fetchModalPrimary" onClick={() => runInstamartLiveAction("selection")} disabled={busy}>
                  Confirm & continue to payment
                </button>
              </div>
            </div>
          </div>
        )}

      </main>

    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(
  <FetchErrorBoundary>
    <App />
  </FetchErrorBoundary>
);
