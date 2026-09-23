import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const starters = [
  "Get me 2 KitKats and milk",
  "Find the latest news about AI agents",
  "Find me a good restaurant for tonight",
  "Remember that I prefer things after 7 PM"
];

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function getConversationId() {
  try {
    const existing = localStorage.getItem("fetch_conversation_id");
    if (existing) return existing;
    const created = `web:${makeId()}`;
    localStorage.setItem("fetch_conversation_id", created);
    return created;
  } catch {
    return `web:${makeId()}`;
  }
}

function isPhysicalRequest(text) {
  const value = String(text || "").toLowerCase();
  return [
    "buy ", "get me", "bring me", "deliver", "order", "grocer",
    "kitkat", "kit kat", "milk", "bread", "eggs", "rice", "snacks",
    "biscuit", "biscuits", "water", "fetch me"
  ].some((term) => value.includes(term));
}

function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

function friendlyStatus(status) {
  const map = {
    awaiting_location: "Location needed",
    partner_offered: "Partner store contacted",
    awaiting_customer_price_confirmation: "Waiting for your approval",
    finding_shopper: "Finding shopper",
    shopper_assigned: "Shopper assigned",
    shopping: "Shopping",
    picked_up: "Picked up",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    completed: "Done",
    needs_clarification: "Need more information"
  };
  return map[String(status || "").toLowerCase()] || "Coordinating";
}

function formatRupees(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `₹${Math.round(number).toLocaleString("en-IN")}`;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("FETCH UI RENDER ERROR", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "Arial, sans-serif" }}>
          <h2>Fetch is still running.</h2>
          <p>The display encountered an error. Your request may already be processing.</p>
          <button onClick={() => window.location.reload()}>Refresh Fetch</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [messages, setMessages] = useState([
    { id: "welcome", role: "assistant", text: "Hi, I’m Fetch. Tell me what you need done.", meta: null }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [task, setTask] = useState(null);
  const [activity, setActivity] = useState([
    { id: "understand", label: "Understand", description: "Intent + context", state: "idle" },
    { id: "plan", label: "Plan", description: "Task + workflow", state: "idle" },
    { id: "route", label: "ATC", description: "Choose resource", state: "idle" },
    { id: "act", label: "Act", description: "Execute + update", state: "idle" }
  ]);

  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const conversationRef = useRef(getConversationId());
  const pollTimerRef = useRef(null);
  const pollGenerationRef = useRef(0);

  useEffect(() => () => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    recognitionRef.current?.stop?.();
  }, []);

  function setActivityStates(next) {
    setActivity((current) => current.map((item) => ({
      ...item,
      state: next[item.id] ?? item.state
    })));
  }

  function resetActivity() {
    setActivityStates({ understand: "idle", plan: "idle", route: "idle", act: "idle" });
  }

  function addAssistantMessage(text, meta = {}) {
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "assistant", text: String(text || "I’m working on that."), meta }
    ]
    );
  }

  function stopPolling() {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function startOrderPolling(orderId, requestText) {
    if (!orderId) return;
    stopPolling();
    const generation = pollGenerationRef.current;
    let attempts = 0;
    let lastStatus = "";

    const terminal = new Set(["delivered", "completed", "cancelled"]);

    const poll = async () => {
      if (generation !== pollGenerationRef.current) return;
      attempts += 1;

      try {
        const response = await fetch(`/api/fetch/agent.mjs?orderId=${encodeURIComponent(orderId)}`, {
          cache: "no-store"
        });
        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

        if (!response.ok || !data?.success || !data?.order) {
          console.warn("FETCH STATUS POLL", data?.error || `Status request failed (${response.status})`);
          setTask((current) => ({
            ...(current || {}),
            text: requestText,
            orderId,
            stage: current?.stage || "waiting for partner store",
            status: current?.status || "partner_offered"
          }));
          addAssistantMessage("I’ve sent your request to the partner store. I’m waiting for their availability and actual price.", { status: "partner_offered", network: "partner_store" });
          if (attempts < 30) pollTimerRef.current = setTimeout(poll, 5000);
          return;
        }

        const order = data.order;
        const status = String(order.status || "").toLowerCase();
        const itemTotal = Number(order.item_total);
        const deliveryFee = Number(order.delivery_fee);
        const total = Number(order.total_amount);

        setTask((current) => ({
          ...(current || {}),
          text: requestText,
          orderId,
          status,
          stage: status === "awaiting_customer_price_confirmation"
            ? "price ready — awaiting your approval"
            : status === "partner_offered"
            ? "partner store contacted"
            : status === "finding_shopper"
            ? "finding shopper"
            : status === "shopper_assigned"
            ? "shopper assigned"
            : status === "shopping"
            ? "shopping"
            : status === "out_for_delivery"
            ? "out for delivery"
            : status === "delivered" || status === "completed"
            ? "done"
            : current?.stage || "coordinating",
          itemTotal: Number.isFinite(itemTotal) ? itemTotal : null,
          deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : null,
          total: Number.isFinite(total) && total > 0 ? total : null
        }));

        setActivityStates({
          understand: "complete",
          plan: "complete",
          route: "complete",
          act: terminal.has(status) ? "complete" : "active"
        });

        const message = String(data.message || "").trim();
        if (message && status !== lastStatus) {
          if (status !== "partner_offered" || !lastStatus) {
            addAssistantMessage(message, { status, network: "physical" });
          }
          lastStatus = status;
        }

        if (terminal.has(status) || attempts >= 120) {
          stopPolling();
          return;
        }
      } catch (error) {
        console.warn("FETCH ORDER POLLING", error);
        if (attempts >= 5) {
          // Do not blank the UI if polling temporarily fails.
          setTask((current) => current ? { ...current, stage: "live order — refresh status if needed" } : current);
          stopPolling();
          return;
        }
      }

      pollTimerRef.current = setTimeout(poll, 3000);
    };

    poll();
  }

  async function send(raw) {
    const text = String(raw || "").trim();
    if (!text || busy) return;

    stopPolling();
    setMessages((current) => [...current, { id: makeId(), role: "user", text, meta: null }]);
    setInput("");
    setBusy(true);
    setActivityStates({ understand: "active", plan: "waiting", route: "waiting", act: "waiting" });
    setTask({ text, stage: "understanding", status: "working", network: null, orderId: null, itemTotal: null, deliveryFee: null, total: null });

    try {
      let location = null;
      if (isPhysicalRequest(text)) location = await getBrowserLocation();

      const response = await fetch("/api/fetch/agent.mjs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          conversationId: conversationRef.current,
          channel: "web",
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null
        })
      });

      const rawResponse = await response.text();
      let data = null;
      try { data = rawResponse ? JSON.parse(rawResponse) : null; } catch {
        throw new Error(`Fetch returned an invalid server response (${response.status}).`);
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Fetch could not process that request (${response.status}).`);
      }

      const status = String(data.status || "unknown");
      const network = data.atc?.resource_type || data.atc?.network || "agent";

      setActivityStates({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: status === "completed" ? "complete" : "active"
      });

      setTask({
        text,
        stage: status === "completed" ? "done" : friendlyStatus(status).toLowerCase(),
        status,
        network,
        orderId: data.order_id || null,
        itemTotal: null,
        deliveryFee: null,
        total: null
      });

      addAssistantMessage(data.message || "I’m working on that.", { status, network });

      if (data.order_id) startOrderPolling(data.order_id, text);
    } catch (error) {
      console.error("FETCH UI ERROR", error);
      setActivityStates({ understand: "complete", plan: "complete", route: "complete", act: "error" });
      setTask({ text, stage: "error", status: "error", network: null, orderId: null, itemTotal: null, deliveryFee: null, total: null });
      addAssistantMessage(error?.message || "I couldn’t process that right now.", { status: "error" });
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function voice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Voice input is not supported in this browser yet.");
    if (listening) return recognitionRef.current?.stop();

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInput(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function clearConversation() {
    stopPolling();
    const fresh = `web:${makeId()}`;
    try { localStorage.setItem("fetch_conversation_id", fresh); } catch {}
    conversationRef.current = fresh;
    setMessages([{ id: makeId(), role: "assistant", text: "Fresh start. What do you need done?", meta: null }]);
    setTask(null);
    resetActivity();
    setInput("");
  }

  const hasUserMessage = messages.some((message) => message.role === "user");

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={clearConversation}>fetch<span>.</span></button>
        <div className="top">
          <span className="ready"><i /> Fetch is ready</span>
          <button onClick={clearConversation}>New</button>
        </div>
      </header>

      <main>
        <section className="intro">
          <small>PERSONAL AI AGENT</small>
          <h1>Tell Fetch what you need.<br /><em>We’ll figure out how.</em></h1>
          <p>Don't choose the app, service or store. Tell Fetch the outcome you want and let Fetch work out the execution.</p>
        </section>

        <section className="workspace">
          <div className="chat">
            <div className="chatHead">
              <div className="identity"><b>F.</b><span><strong>Fetch</strong><small>Personal assistant</small></span></div>
              <label>PRIVATE SESSION</label>
            </div>

            <div className="messages">
              {messages.map((m) => (
                <div className={`row ${m.role}`} key={m.id}>
                  {m.role === "assistant" && <b className="tiny">F.</b>}
                  <div className={`bubble ${m.role}`}>
                    {String(m.text || "")}
                    {m.meta?.status && m.role === "assistant" && <small className="meta">{friendlyStatus(m.meta.status)}</small>}
                  </div>
                </div>
              ))}
              {busy && <div className="row assistant"><b className="tiny">F.</b><div className="bubble assistant thinking"><i /><i /><i /><small>Fetch is figuring it out…</small></div></div>}
            </div>

            <div className="composeArea">
              {!hasUserMessage && <div className="starters">{starters.map((x) => <button key={x} onClick={() => send(x)}>{x}</button>)}</div>}
              <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
                <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} placeholder="Tell Fetch what you need…" rows="1" disabled={busy} />
                <button type="button" className={listening ? "listen" : ""} onClick={voice} aria-label="Voice input">{listening ? "●" : "⌕"}</button>
                <button className="send" disabled={!input.trim() || busy} aria-label="Send">↑</button>
              </form>
              <small className="hint">Enter to send · Fetch may ask for confirmation before taking an action</small>
            </div>
          </div>

          <aside>
            <small>FETCH ATC</small>
            <h2>You ask.<br /><em>Fetch coordinates.</em></h2>
            <p>You don't need to choose a service. Fetch determines the execution path behind the scenes.</p>

            <div className="flow">
              {activity.map((item, index) => <React.Fragment key={item.id}>
                <div className={`node ${item.state}`}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.state === "complete" && <i className="check">✓</i>}{item.state === "active" && <i className="pulse">●</i>}</div>
                {index < activity.length - 1 && <i className="line" />}
              </React.Fragment>)}
            </div>

            {task && <div className="live">
              <small>LIVE TASK · {String(task.stage || "coordinating")}</small>
              <p>{String(task.text || "")}</p>
              {task.network && <span>Route <b>{String(task.network)}</b></span>}
              {task.orderId && <span>Order <b>{String(task.orderId).slice(0, 8).toUpperCase()}</b></span>}
              {task.status === "awaiting_customer_price_confirmation" && <div className="quote">
                <strong>Current total</strong><b>{formatRupees(task.total) || "—"}</b>
                {formatRupees(task.itemTotal) && <small>Items {formatRupees(task.itemTotal)}</small>}
                {formatRupees(task.deliveryFee) && <small>Delivery {formatRupees(task.deliveryFee)}</small>}
              </div>}
            </div>}

            <div className="networks"><b>◌<small>Digital</small></b><b>◇<small>Physical</small></b><b>⌁<small>Human</small></b></div>
            <p className="note">Internal routing stays behind Fetch. Customers don't need to choose a store or service.</p>
          </aside>
        </section>

        <section className="statement"><small>THE IDEA</small><h2>Don’t learn another app.<br /><em>Delegate the task.</em></h2></section>
      </main>
    </div>
  );
}

window.addEventListener("error", (event) => console.error("FETCH GLOBAL ERROR", event.error || event.message));
window.addEventListener("unhandledrejection", (event) => console.error("FETCH UNHANDLED REJECTION", event.reason));

createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);
