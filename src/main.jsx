// FETCH MOBILITY BUILD 2026-09-29
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

const API_URL = "/api/fetch/agent.mjs";
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
  const existing = localStorage.getItem("fetch_conversation_id");

  if (existing) {
    return existing;
  }

  const created = `web:${makeId()}`;
  localStorage.setItem("fetch_conversation_id", created);

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
  return data?.pricing || data?.bill || {};
}

function getInstamartPaymentMethods(paymentOptions, cart) {
  const source =
    paymentOptions?.data ||
    paymentOptions ||
    getInstamartCartData(cart)?.paymentOptions ||
    {};

  const methods = Array.isArray(source?.allMethods)
    ? source.allMethods
    : Array.isArray(source?.availablePaymentMethods)
      ? source.availablePaymentMethods.map((id) => ({ id, groupName: id, displayName: id }))
      : [];

  return methods.filter((method) => method && (method.enabled !== false));
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
  const [connectionNotice, setConnectionNotice] = useState(null);

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
            suppliedContext: {},
            history: messages
              .slice(-8)
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

      const route =
        data?.provider?.name ||
        data?.atc?.provider_name ||
        data?.atc?.resource_type ||
        data?.atc?.network ||
        data?.fetch?.intent?.domain ||
        "agent";

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
                            : "coordinating";

      setTask({
        text,
        stage,
        status: data.status,
        network: route,
        workflowId: data.workflow_id,
        orderId: data.orderId || data.order_id || null
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: displayMessage(data.message),
          meta: {
            status: data.status,
            network: route,
            connect_url: data?.provider?.connect_url || null,
            provider_name: data?.provider?.name || null,
            provider_id: data?.provider?.id || null,
            action_url: data?.provider?.action_url || null,
            action_label: data?.provider?.action_label || null
          }
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
          items: (instamartLive?.requestedItems || []).map((item) => ({
            item: item.item || item.name,
            quantity: item.quantity || 1
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
          ...(selectedPayment === "UPI" && selectedIntentApp ? { intentApp: selectedIntentApp } : {}),
          confirmed: true
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
        setTask((current) => ({ ...(current || {}), stage: "cart ready for approval", status: data.status, network: "Instamart" }));
        setMessages((current) => [...current, {
          id: makeId(),
          role: "assistant",
          text: "Your live Instamart cart is ready. Review the total, delivery address and payment method before I place it.",
          meta: { status: data.status, network: "Instamart" }
        }]);
      } else {
        const orderId = data?.data?.orderId || data?.orderId || data?.order?.orderId || null;
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
    const provider = params.get("uber") === "connected" ? "Uber" : params.get("swiggy") === "connected" ? "Instamart" : null;
    if (provider) {
      setConnectionNotice(`${provider} is connected to Fetch. Your next request can use it directly.`);
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

  function clearConversation() {
    activeWatchRef.current = null;
    localStorage.removeItem(ACTIVE_ORDER_KEY);

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
                      <ResearchResults text={message.text} />
                    ) : (
                      message.text
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
                            <div style={{fontSize:"12px",fontWeight:800,marginBottom:"8px"}}>Where should I deliver it?</div>
                            {(instamartLive.addresses || []).map((address) => {
                              const id = address?.id || address?.addressId;
                              return (
                                <button
                                  type="button"
                                  className="approvalButton"
                                  key={id}
                                  onClick={() => chooseInstamartAddress(id)}
                                  disabled={busy}
                                  style={{textAlign:"left",background:"#f4f4f4",color:"#111"}}
                                >
                                  <strong>{address?.label || address?.name || "Saved address"}</strong>
                                  <br />
                                  <span style={{fontWeight:400,opacity:.65}}>{address?.address || address?.formattedAddress || address?.addressLine || ""}</span>
                                </button>
                              );
                            })}
                          </>
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
                        ) : instamartLive.productOptions?.length ? (
                          <>
                            {Object.entries(
                              instamartLive.productOptions.reduce((groups, item) => {
                                const key = item.requested || item.name;
                                groups[key] = groups[key] || [];
                                groups[key].push(item);
                                return groups;
                              }, {})
                            ).map(([requested, options]) => (
                              <div key={requested}>
                                <div style={{fontSize:"11px",fontWeight:800,margin:"10px 0 4px"}}>{requested}</div>
                                {options.map((option) => (
                                  <label className="liveProduct" key={option.spinId}>
                                    <input
                                      type="radio"
                                      name={`fetch-product-${requested}`}
                                      checked={selectedSpins[requested] === option.spinId}
                                      disabled={option.inStock === false || busy}
                                      onChange={() => setSelectedSpins((current) => ({ ...current, [requested]: option.spinId }))}
                                    />
                                    <span className="liveProductInfo">
                                      <strong>{option.name}</strong>
                                      <small>{option.pack || "Variant"} · ₹{option.price ?? "—"} · {option.inStock === false ? "Out of stock" : "Available"}</small>
                                    </span>
                                  </label>
                                ))}
                              </div>
                            ))}
                            <button
                              type="button"
                              className="approvalButton"
                              onClick={() => runInstamartLiveAction("selection")}
                              disabled={busy}
                            >
                              Build live cart
                            </button>
                          </>
                        ) : instamartLive.cart ? (
                          <>
                            <div style={{fontSize:"12px",fontWeight:800}}>Live cart</div>
                            <div style={{fontSize:"11px",opacity:.65,marginTop:"8px"}}>
                              Live cart retrieved from Swiggy. Review the total and payment method below.
                            </div>
                            {(() => {
                              const cartData = getInstamartCartData(instamartLive.cart);
                              const pricing = getInstamartPricing(instamartLive.cart);
                              const cartItems = Array.isArray(cartData?.items) ? cartData.items : [];
                              const total = pricing?.to_pay ?? pricing?.billToPay ?? cartData?.to_pay ?? "—";
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

                            <div className="paymentBox">
                              <strong style={{fontSize:"11px"}}>Payment method</strong>
                              {getInstamartPaymentMethods(instamartLive.paymentOptions, instamartLive.cart).length ? (
                                getInstamartPaymentMethods(instamartLive.paymentOptions, instamartLive.cart).map((method) => {
                                  const group = method?.groupName || method?.id;
                                  const isUpi = group === "UPI";
                                  return (
                                    <div key={method.id || group} style={{padding:"6px 0"}}>
                                      <label>
                                        <input
                                          type="radio"
                                          name="fetch-payment"
                                          value={group}
                                          checked={selectedPayment === group && (!isUpi || !selectedIntentApp || selectedIntentApp === method.id)}
                                          onChange={() => {
                                            setSelectedPayment(group);
                                            if (isUpi) setSelectedIntentApp(method.id);
                                            else setSelectedIntentApp("");
                                          }}
                                        />
                                        <span>{method.displayName || group}</span>
                                      </label>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{fontSize:"11px",opacity:.6}}>No live payment methods were returned. Refresh the cart before checkout.</div>
                              )}
                            </div>

                            <button
                              type="button"
                              className="approvalButton"
                              onClick={() => runInstamartLiveAction("checkout")}
                              disabled={busy || !selectedPayment}
                            >
                              Confirm & place Instamart order
                            </button>
                          </>
                        ) : (
                          <div style={{fontSize:"12px",opacity:.65}}>Preparing live Instamart results…</div>
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
                        onClick={() => send("approve")}
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

      </main>

    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);
