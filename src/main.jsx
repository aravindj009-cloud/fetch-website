import React, { useRef, useState } from "react";
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

function getConversationId() {
  const existing = localStorage.getItem("fetch_conversation_id");

  if (existing) {
    return existing;
  }

  const created = `web:${makeId()}`;
  localStorage.setItem("fetch_conversation_id", created);

  return created;
}



function ResearchResultsCard({ intro, results }) {
  return (
    <div
      className="researchResults"
      style={{
        width: "100%",
        maxWidth: "680px",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        className="researchIntro"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          marginBottom: "16px",
          width: "100%",
          boxSizing: "border-box",
          flexWrap: "wrap",
        }}
      >
        <strong>{intro || "Here’s what I found"}</strong>
        <span>Latest web results</span>
      </div>

      <div
        className="researchList"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0",
          width: "100%",
        }}
      >
        {results.map((result, index) => (
          <article
            className="researchCard"
            key={result.link || index}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "14px",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              boxSizing: "border-box",
              padding: "15px 0",
              borderTop: index === 0 ? "none" : "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <div
              className="researchNumber"
              style={{
                flex: "0 0 32px",
                width: "32px",
                height: "32px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
                background: "#f1f1ef",
                boxSizing: "border-box",
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </div>

            <div
              className="researchBody"
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                width: "calc(100% - 46px)",
                overflow: "hidden",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "15px",
                  lineHeight: 1.45,
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {result.title}
              </h3>

              {result.description && (
                <p
                  style={{
                    margin: "7px 0 0",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    opacity: 0.72,
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {result.description.slice(0, 220)}
                  {result.description.length > 220 ? "…" : ""}
                </p>
              )}

              <div
                className="researchMeta"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                  marginTop: "8px",
                  fontSize: "12px",
                  lineHeight: 1.4,
                  opacity: 0.62,
                }}
              >
                <span>{result.source || "Web"}</span>
                {result.published_display && (
                  <>
                    <span>·</span>
                    <span>{result.published_display}</span>
                  </>
                )}
              </div>

              {result.link && (
                <a
                  href={result.link}
                  target="_blank"
                  rel="noreferrer"
                  className="researchLink"
                  style={{
                    display: "inline-block",
                    marginTop: "8px",
                    fontSize: "12px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open source ↗
                </a>
              )}
            </div>
          </article>
        ))}
      </div>

      <div
        className="researchDisclaimer"
        style={{
          marginTop: "12px",
          paddingTop: "12px",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          fontSize: "11px",
          lineHeight: 1.45,
          opacity: 0.55,
        }}
      >
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
        /\b(buy|get|fetch|bring|pick up|purchase|deliver|order)\b/i.test(text) &&
        !/\b(news|restaurant|weather|remember|calendar|book a flight)\b/i.test(text);

      let latitude = null;
      let longitude = null;

      if (isPhysicalRequest && navigator.geolocation) {
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
        "https://fetch-ten-olive.vercel.app/api/web/agent.mjs",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text,
            conversationId: conversationRef.current,
            channel: "web",
            latitude,
            longitude
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
                            : "coordinating";

      setTask({
        text,
        stage,
        status: data.status,
        network: route,
        workflowId: data.workflow_id,
        orderId: data.order_id || null
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
          },
          researchResults: data.execution?.results || null,
          researchIntro: data.execution?.intro || null
        }
      ]);

      if (data.order_id) {
        watchOrder(data.order_id, text);
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
          `https://fetch-ten-olive.vercel.app/api/web/agent.mjs?orderId=${encodeURIComponent(orderId)}`,
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
                    className={`bubble ${message.role} ${
                      message.role === "assistant" && message.researchResults?.length
                        ? "researchBubble"
                        : ""
                    }`}
                  >

                    {message.role === "assistant" && message.researchResults?.length ? (
                      <ResearchResultsCard
                        intro={message.researchIntro}
                        results={message.researchResults}
                      />
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

        </section>

      </main>

    </div>
  );
}

createRoot(
  document.getElementById("root")
).render(<App />);
