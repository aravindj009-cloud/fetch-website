import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const starters = [
  "Get me 2 KitKats and milk",
  "Find the latest news about AI agents",
  "Find me a good restaurant for tonight",
  "Remember that I prefer things after 7 PM"
];

const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Keep the frontend portable between the public site and the backend Vercel project.
// Set VITE_FETCH_API_BASE in Vercel if the backend URL changes.
const FETCH_API_BASE =
  import.meta.env.VITE_FETCH_API_BASE ||
  "https://fetch-ten-olive.vercel.app";

const FETCH_AGENT_URL = `${FETCH_API_BASE.replace(/\/$/, "")}/api/web/agent.mjs`;

function looksLikePhysicalRequest(text) {
  const value = String(text || "");

  const acquisitionVerb =
    /\b(buy|get|fetch|bring|pick up|pickup|purchase|deliver|delivery|order|send|source|need)\b/i.test(value);

  const physicalObject =
    /\b(item|product|goods|grocery|groceries|medicine|medicines|food|drink|drinks|snack|snacks|pack|packs|box|boxes|bottle|bottles|piece|pieces|unit|units|shopping|supplies|stuff)\b/i.test(value);

  const deliveryCue =
    /\b(deliver|delivery|delivered|my address|our address|near me|nearby|at home|to my home)\b/i.test(value);

  const quantityObjectCue =
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+[a-z][a-z-]*\b/i.test(value) &&
    physicalObject;

  return (
    (acquisitionVerb && physicalObject) ||
    (acquisitionVerb && deliveryCue) ||
    quantityObjectCue
  );
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


function StructuredAnswer({ text }) {
  const clean = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/```(?:markdown|md|text)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const sourceLines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];

  for (const line of sourceLines) {
    const heading = line.match(/^#{1,6}\s*(.+)$/);
    const numbered = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
    const bullet = line.match(/^(?:[-*•▪◦])\s+(.+)$/);

    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
    } else if (numbered) {
      blocks.push({
        type: "numbered",
        number: numbered[1],
        text: numbered[2]
      });
    } else if (bullet) {
      blocks.push({
        type: "bullet",
        text: bullet[1]
      });
    } else {
      blocks.push({
        type: "paragraph",
        text: line
      });
    }
  }

  // Models sometimes return "1. ... 2. ... 3. ..." in one paragraph.
  const expanded = [];

  for (const block of blocks) {
    if (block.type !== "paragraph") {
      expanded.push(block);
      continue;
    }

    const pieces = block.text
      .split(/\s+(?=\d{1,2}[.)]\s+)/g)
      .filter(Boolean);

    if (pieces.length === 1) {
      expanded.push(block);
      continue;
    }

    for (const piece of pieces) {
      const match = piece.match(/^(\d{1,2})[.)]\s+(.+)$/);

      expanded.push(
        match
          ? {
              type: "numbered",
              number: match[1],
              text: match[2]
            }
          : {
              type: "paragraph",
              text: piece
            }
      );
    }
  }

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}
    >
      {expanded.map((block, index) => {
        if (block.type === "heading") {
          return (
            <div
              key={index}
              style={{
                marginTop: index ? "5px" : 0,
                fontSize: "15px",
                lineHeight: 1.35,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "#111"
              }}
            >
              {block.text}
            </div>
          );
        }

        if (block.type === "numbered") {
          return (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "28px minmax(0, 1fr)",
                gap: "9px",
                alignItems: "start",
                marginTop: "2px"
              }}
            >
              <span
                style={{
                  width: "24px",
                  height: "24px",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  background: "#111",
                  color: "#fff",
                  fontSize: "11px",
                  fontWeight: 700
                }}
              >
                {block.number}
              </span>

              <div
                style={{
                  paddingTop: "2px",
                  lineHeight: 1.58,
                  color: "#161616"
                }}
              >
                {block.text}
              </div>
            </div>
          );
        }

        if (block.type === "bullet") {
          return (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "14px minmax(0, 1fr)",
                gap: "4px",
                alignItems: "start",
                lineHeight: 1.55
              }}
            >
              <span style={{ fontWeight: 700 }}>•</span>
              <div>{block.text}</div>
            </div>
          );
        }

        return (
          <p
            key={index}
            style={{
              margin: 0,
              lineHeight: 1.62,
              color: "#161616"
            }}
          >
            {block.text}
          </p>
        );
      })}
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
  const locationRef = useRef({ latitude: null, longitude: null });

  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const conversationRef = useRef(getConversationId());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }, [messages, busy]);

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
      const isPhysicalRequest = looksLikePhysicalRequest(text);

      let latitude = locationRef.current.latitude;
      let longitude = locationRef.current.longitude;

      // A location-needed response is a continuation of the same physical
      // task. Treat common replies such as "enabled", "allow", or "done"
      // as permission to retry the original physical request.
      const recentMessages = messages.slice(-6);
      const waitingForLocation = recentMessages.some(
        (item) =>
          item?.role === "assistant" &&
          /allow location|location access|nearby store/i.test(
            String(item?.text || "")
          )
      );

      const locationContinuation =
        waitingForLocation &&
        /^(enabled|enable|allowed|allow|done|yes|okay|ok|sure|go ahead)$/i.test(
          text
        );

      const shouldRequestLocation =
        (isPhysicalRequest || locationContinuation) &&
        navigator.geolocation;

      if (shouldRequestLocation) {
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
          locationRef.current = { latitude, longitude };
        }
      }

      const originalPhysicalRequest =
        [...messages]
          .reverse()
          .find(
            (item) =>
              item?.role === "user" &&
              looksLikePhysicalRequest(String(item?.text || ""))
          )?.text || "";

      const requestText =
        locationContinuation && originalPhysicalRequest
          ? originalPhysicalRequest
          : text;

      const response = await fetch(
        FETCH_AGENT_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: requestText,
            conversationId: conversationRef.current,
            channel: "web",
            latitude,
            longitude,

            /*
             * Give Fetch the recent visible chat so follow-ups like
             * "yes", "what do you mean?", "tell me more", etc. have context.
             * Only the last 10 messages are sent.
             */
            conversationHistory: [
              ...messages,
              {
                role: "user",
                text
              }
            ]
              .filter(
                (message) =>
                  message?.role === "user" ||
                  message?.role === "assistant"
              )
              .slice(-10)
              .map((message) => ({
                role: message.role,
                content: String(message.text || "").slice(0, 4000)
              }))
          })
        }
      );

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Fetch request failed"
        );
      }

      const route =
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
                            : data.status === "cancelled"
                              ? "cancelled"
                              : data.status === "failed"
                                ? "execution failed"
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
          text:
            data.message ||
            "I’m working on that.",
          meta: {
            status: data.status,
            network: route
          }
        }
      ]);

      const resolvedOrderId =
        data.orderId || data.order_id || null;

      if (resolvedOrderId) {
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

  async function watchOrder(orderId, originalText) {
    const maxChecks = 100;

    for (let check = 0; check < maxChecks; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        const response = await fetch(
          `${FETCH_AGENT_URL}?orderId=${encodeURIComponent(orderId)}`,
          {
            method: "GET",
            cache: "no-store"
          }
        );

        const data = await response.json();

        if (!response.ok || !data?.success || !data?.order) {
          continue;
        }

        const order = data.order;
        const route =
          order.status === "finding_shopper" ||
          order.status === "shopper_assigned" ||
          order.status === "shopping" ||
          order.status === "picked_up" ||
          order.status === "out_for_delivery"
            ? "shopper"
            : order.status === "finding_partner" ||
                order.status === "partner_offered" ||
                order.status === "awaiting_customer_price_confirmation"
              ? "partner_store"
              : "agent";

        let stage = "coordinating";

        if (order.status === "finding_partner") {
          stage = "finding partner store";
        } else if (order.status === "partner_offered") {
          stage = "partner store contacted";
        } else if (order.status === "awaiting_customer_price_confirmation") {
          stage = "price ready for approval";
        } else if (order.status === "finding_shopper") {
          stage = "finding shopper";
        } else if (order.status === "shopper_assigned") {
          stage = "shopper assigned";
        } else if (order.status === "shopping") {
          stage = "shopping";
        } else if (order.status === "picked_up") {
          stage = "picked up";
        } else if (order.status === "out_for_delivery") {
          stage = "out for delivery";
        } else if (order.status === "payment_pending") {
          stage = "payment pending";
        } else if (order.status === "delivered") {
          stage = "delivered";
        } else if (order.status === "cancelled") {
          stage = "cancelled";
        }

        setTask((current) => ({
          ...(current || {}),
          text: originalText,
          stage,
          status: order.status,
          network: route,
          workflowId: current?.workflowId || null,
          orderId
        }));

        const message = data.message;

        if (message) {
          setMessages((current) => {
            const last = current[current.length - 1];

            if (last?.role === "assistant" && last?.text === message) {
              return current;
            }

            return [
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
            ];
          });
        }

        if (data.terminal) {
          return;
        }
      } catch (error) {
        console.error("FETCH ORDER WATCH ERROR", error);
      }
    }
  }

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
            <em>We’ll figure out how.</em>
          </h1>

          <p>
            Text naturally. Fetch understands the task,
            plans the work and coordinates the resources
            needed to get it done.
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
                      <StructuredAnswer text={message.text} />
                    ) : (
                      message.text
                    )}

                    {message.meta?.network && (
                      <small className="meta">
                        {message.meta.status}
                        {" · "}
                        {message.meta.network}
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

              <div ref={messagesEndRef} aria-hidden="true" />

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

            <small>FETCH ATC</small>

            <h2>
              You ask.
              <br />
              <em>Fetch coordinates.</em>
            </h2>

            <p>
              The user doesn't choose the service.
              Fetch determines the execution path
              behind the scenes.
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
                  "Choose resource"
                ],
                [
                  "04",
                  "Act",
                  "Execute + update"
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
              Customers don't need to choose a
              store or service.
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
