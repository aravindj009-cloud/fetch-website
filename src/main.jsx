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

function normalizeResearchText(value) {
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

function cleanResearchTitle(value) {
  return normalizeResearchText(value)
    .replace(/^[-–—:|]+\s*/, "")
    .replace(/\s*[-–—:|]+\s*$/, "")
    .trim();
}

function parseResearchResults(text) {
  const raw = normalizeResearchText(text);

  if (!/here[’']s what i found/i.test(raw)) {
    return null;
  }

  const matches = [];
  const itemPattern = /(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/g;
  let match;

  while ((match = itemPattern.exec(raw)) !== null) {
    const number = Number(match[1]);
    let content = normalizeResearchText(match[2]);

    if (!content) continue;

    // Remove the long Google News tracking URL first.
    const urlMatch = content.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch
      ? urlMatch[0].replace(/[),.;]+$/, "")
      : "";

    if (url) {
      content = content.replace(urlMatch[0], " ");
    }

    content = normalizeResearchText(content);

    // The RSS result can contain publisher + repeated title + article context.
    // Extract the date wherever it occurs, not only at the end.
    const dateMatch = content.match(
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i
    );

    const published = dateMatch ? dateMatch[1] : "";

    if (dateMatch) {
      content = normalizeResearchText(
        content.slice(0, dateMatch.index) +
        " " +
        content.slice(dateMatch.index + dateMatch[0].length)
      );
    }

    // Pull an explicit Source marker if present.
    let source = "";
    const sourceMatch = content.match(
      /\bSource:\s*([^|]+?)(?=\s+(?:Published|$))/i
    );

    if (sourceMatch) {
      source = cleanResearchTitle(sourceMatch[1]);
      content = normalizeResearchText(
        content.replace(sourceMatch[0], " ")
      );
    }

    // If the source marker was not present, infer a publisher from common
    // domain fragments that Google News RSS places after the article text.
    const sourceCandidates = [
      "Financial Times",
      "BBC",
      "The New York Times",
      "New York Times",
      "TechCrunch",
      "Business Insider",
      "WIRED",
      "Google",
      "CNBC",
      "The Hindu",
      "Investing.com",
      "PR Newswire",
      "OpenAI",
      "blog.google"
    ];

    if (!source) {
      for (const candidate of sourceCandidates) {
        const re = new RegExp(
          `\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        );

        if (re.test(content)) {
          source = candidate;
          break;
        }
      }
    }

    if (!source && url) {
      try {
        source = new URL(url).hostname
          .replace(/^www\./, "")
          .replace(/^news\./, "");
      } catch {
        source = "Web";
      }
    }

    // Remove obvious RSS/publisher noise.
    content = content
      .replace(/\bSource:\s*$/i, "")
      .replace(/\bPublished:\s*$/i, "")
      .replace(/\bSource\s*$/i, "")
      .trim();

    // Google News titles commonly look like:
    // "Headline – Publisher Headline Publisher"
    // Find the first separator and treat the first segment as the headline.
    let title = content;
    let summary = "";

    const separator = content.search(/\s+[–—-]\s+/);

    if (separator > 0) {
      title = content.slice(0, separator).trim();
      summary = content.slice(separator).replace(/^\s+[–—-]\s+/, "").trim();
    }

    // If no separator exists, use the first sentence as the title.
    if (title.length > 180) {
      const sentenceEnd = title.search(/[.!?]\s+/);

      if (sentenceEnd > 40) {
        summary = title.slice(sentenceEnd + 1).trim();
        title = title.slice(0, sentenceEnd + 1).trim();
      }
    }

    // Remove repeated title/publisher fragments from the summary.
    if (summary) {
      const titleLower = title.toLowerCase();

      while (
        summary.toLowerCase().startsWith(titleLower)
      ) {
        summary = summary.slice(title.length).trim();
        summary = summary.replace(/^[–—-]\s*/, "");
      }

      if (source) {
        const sourceIndex = summary.toLowerCase().lastIndexOf(
          source.toLowerCase()
        );

        if (sourceIndex >= 0 && sourceIndex > 20) {
          summary = summary.slice(0, sourceIndex).trim();
        }
      }
    }

    // Remove stray publisher names from the end of the title.
    if (source) {
      const sourceRegex = new RegExp(
        `\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
      title = title.replace(sourceRegex, "").trim();
    }

    title = cleanResearchTitle(title);
    summary = cleanResearchTitle(summary);

    if (!title) continue;

    matches.push({
      number,
      title: title.slice(0, 180),
      summary: summary.slice(0, 280),
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
    <div
      className="researchResults"
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box"
      }}
    >
      <div
        className="researchIntro"
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "16px",
          paddingBottom: "12px",
          marginBottom: "4px",
          borderBottom: "1px solid rgba(0,0,0,0.08)"
        }}
      >
        <strong style={{ fontSize: "15px", lineHeight: 1.4 }}>
          Here’s what I found
        </strong>
        <span
          style={{
            fontSize: "11px",
            opacity: 0.55,
            whiteSpace: "nowrap"
          }}
        >
          Latest web results
        </span>
      </div>

      <div
        className="researchList"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginTop: "10px"
        }}
      >
        {results.map((result) => (
          <article
            className="researchCard"
            key={`${result.number}-${result.url || result.title}`}
            style={{
              display: "grid",
              gridTemplateColumns: "34px minmax(0, 1fr)",
              columnGap: "12px",
              alignItems: "start",
              padding: "12px 0",
              borderBottom: "1px solid rgba(0,0,0,0.07)",
              minWidth: 0
            }}
          >
            <div
              className="researchNumber"
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#111",
                color: "#fff",
                fontSize: "10px",
                fontWeight: 700
              }}
            >
              {String(result.number).padStart(2, "0")}
            </div>

            <div
              className="researchBody"
              style={{
                minWidth: 0,
                overflow: "hidden"
              }}
            >
              <h3
                style={{
                  margin: "0 0 5px",
                  fontSize: "14px",
                  lineHeight: 1.45,
                  fontWeight: 650,
                  overflowWrap: "anywhere"
                }}
              >
                {result.title}
              </h3>

              {result.summary && (
                <p
                  style={{
                    margin: "0 0 7px",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    opacity: 0.72,
                    overflowWrap: "anywhere"
                  }}
                >
                  {result.summary}
                </p>
              )}

              <div
                className="researchMeta"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11px",
                  opacity: 0.55
                }}
              >
                <span>{result.source}</span>
                {result.published && (
                  <>
                    <span>·</span>
                    <span>{result.published}</span>
                  </>
                )}
              </div>

              {result.url && (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="researchLink"
                  style={{
                    display: "inline-block",
                    marginTop: "7px",
                    fontSize: "11px",
                    fontWeight: 600,
                    textDecoration: "none"
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
          fontSize: "10px",
          lineHeight: 1.45,
          opacity: 0.48
        }}
      >
        Fetch found these live web results. The underlying claims have not
        been independently verified by Fetch.
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
