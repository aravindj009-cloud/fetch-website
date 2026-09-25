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

function parseResearchResults(text) {
  const raw = decodeEntities(text);

  if (!/here[’']s what i found for/i.test(raw) || !/\b1\.\s/.test(raw)) {
    return null;
  }

  const matches = [];
  const pattern = /(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/g;
  let match;

  while ((match = pattern.exec(raw)) !== null) {
    const number = Number(match[1]);
    let content = match[2].trim();

    const urlMatch = content.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch ? urlMatch[0].replace(/[),.;]+$/, "") : "";

    if (url) {
      content = content.replace(urlMatch[0], " ");
    }

    const publishedMatch = content.match(/\s*[·|-]\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*$/i);
    let published = publishedMatch ? publishedMatch[1] : "";
    let source = "";

    if (publishedMatch) {
      content = content.slice(0, publishedMatch.index).trim();
    }

    const sourceMarker = content.match(/\s+Source:\s*(.+)$/i);
    if (sourceMarker) {
      source = sourceMarker[1].trim();
      content = content.slice(0, sourceMarker.index).trim();
    }

    if (!source && url) {
      source = getHost(url);
    }

    // Google News RSS sometimes repeats the publisher/headline in the RSS title.
    // Keep the first meaningful headline and use the remaining text as context.
    const titleParts = content.split(/\s+–\s+|\s+—\s+|\s+-\s+/);
    let title = titleParts[0].trim();
    let summary = titleParts.slice(1).join(" – ").trim();

    if (!title) {
      title = content;
    }

    // Collapse repeated headline/source fragments without hiding useful text.
    if (summary.toLowerCase().startsWith(title.toLowerCase())) {
      summary = summary.slice(title.length).trim();
    }

    summary = summary.replace(/^Source:\s*/i, "").trim();

    matches.push({
      number,
      title: title.slice(0, 180),
      summary: summary.slice(0, 320),
      source: source || "Web",
      published,
      url
    });
  }

  return matches.length ? matches.slice(0, 8) : null;
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
          <article className="researchCard" key={`${result.number}-${result.url || result.title}`}>
            <div className="researchNumber">{String(result.number).padStart(2, "0")}</div>

            <div className="researchBody">
              <h3>{result.title}</h3>

              {result.summary && (
                <p>{result.summary}</p>
              )}

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
          }
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

      <style>{`
        .researchResults {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .researchIntro {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 2px;
        }
        .researchIntro strong {
          font-size: 15px;
          font-weight: 650;
        }
        .researchIntro span {
          font-size: 11px;
          opacity: .55;
          white-space: nowrap;
        }
        .researchList {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .researchCard {
          display: flex;
          gap: 12px;
          padding: 12px 13px;
          border: 1px solid rgba(0,0,0,.08);
          border-radius: 14px;
          background: rgba(255,255,255,.72);
          box-sizing: border-box;
        }
        .researchNumber {
          flex: 0 0 28px;
          height: 28px;
          border-radius: 9px;
          display: grid;
          place-items: center;
          background: #111;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .04em;
        }
        .researchBody {
          min-width: 0;
          flex: 1;
        }
        .researchBody h3 {
          margin: 0 0 5px;
          font-size: 14px;
          line-height: 1.35;
          font-weight: 650;
          color: #111;
        }
        .researchBody p {
          margin: 0 0 8px;
          font-size: 12px;
          line-height: 1.5;
          color: rgba(0,0,0,.68);
        }
        .researchMeta {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          font-size: 10px;
          color: rgba(0,0,0,.5);
          margin-bottom: 7px;
        }
        .researchLink {
          display: inline-block;
          font-size: 11px;
          font-weight: 600;
          color: #111;
          text-decoration: none;
        }
        .researchLink:hover {
          text-decoration: underline;
        }
        .researchDisclaimer {
          padding-top: 2px;
          font-size: 10px;
          line-height: 1.45;
          color: rgba(0,0,0,.45);
        }
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
                      <ResearchResults text={message.text} />
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
