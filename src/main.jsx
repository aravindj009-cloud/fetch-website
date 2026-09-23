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
  if (existing) return existing;
  const created = `web:${makeId()}`;
  localStorage.setItem("fetch_conversation_id", created);
  return created;
}


function isPhysicalRequest(text) {
  const value = String(text || "").toLowerCase();
  return [
    "buy ", "get me", "bring me", "deliver", "order",
    "grocer", "kitkat", "kit kat", "milk", "bread",
    "eggs", "rice", "snacks", "biscuit", "biscuits",
    "water", "fetch me"
  ].some((term) => value.includes(term));
}

function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  });
}

function friendlyStatus(status) {
  const map = {
    awaiting_physical_order: "Fulfilment path found",
    resource_matched: "Execution path selected",
    completed: "Done",
    needs_clarification: "Need a little more information"
  };
  return map[status] || "Coordinating";
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

  const [activity, setActivity] = useState([
    { id: "understand", label: "Understand", description: "Intent + context", state: "idle" },
    { id: "plan", label: "Plan", description: "Task + workflow", state: "idle" },
    { id: "route", label: "ATC", description: "Choose resource", state: "idle" },
    { id: "act", label: "Act", description: "Execute + update", state: "idle" }
  ]);

  const inputRef = useRef(null);
  const recognition = useRef(null);
  const conversation = useRef(getConversationId());

  function setActivityStates(states) {
    setActivity((current) =>
      current.map((item) => ({
        ...item,
        state: states[item.id] || item.state
      }))
    );
  }

  function resetActivity() {
    setActivityStates({
      understand: "idle",
      plan: "idle",
      route: "idle",
      act: "idle"
    });
  }

  async function send(raw) {
    const text = String(raw || "").trim();
    if (!text || busy) return;

    setMessages((current) => [
      ...current,
      { id: makeId(), role: "user", text, meta: null }
    ]);

    setInput("");
    setBusy(true);

    setActivityStates({
      understand: "active",
      plan: "waiting",
      route: "waiting",
      act: "waiting"
    });

    setTask({
      text,
      stage: "understanding",
      status: "working",
      network: null,
      intent: null,
      quote: null
    });

    try {
      let location = null;

      if (isPhysicalRequest(text)) {
        location = await getBrowserLocation();
      }

      const response = await fetch("/api/fetch/agent.mjs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          conversationId: conversation.current,
          channel: "web",
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null
        })
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Fetch could not process that request."
        );
      }

      const status = data.status || "unknown";
      const intent = data.fetch?.intent || null;
      const network =
        data.atc?.resource_type ||
        data.atc?.network ||
        intent ||
        "agent";

      setActivityStates({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: status === "completed" ? "complete" : "active"
      });

      const quote = data.execution?.quote || null;

      setTask({
        text,
        stage:
          status === "completed"
            ? "done"
            : status === "needs_clarification"
            ? "needs input"
            : status === "awaiting_physical_order"
            ? "ready for fulfilment"
            : status === "partner_offered"
            ? "partner store contacted"
            : status === "awaiting_location"
            ? "location needed"
            : "coordinating",
        status,
        network,
        intent,
        quote
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: data.message || "I’m working on that.",
          meta: {
            status,
            network
          }
        }
      ]);
    } catch (error) {
      setActivityStates({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: "error"
      });

      setTask({
        text,
        stage: "error",
        status: "error",
        network: null,
        intent: null,
        quote: null
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text:
            error?.message ||
            "I couldn’t process that right now.",
          meta: { status: "error" }
        }
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function voice() {
    const SR =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SR) {
      alert("Voice input is not supported in this browser yet.");
      return;
    }

    if (listening) {
      recognition.current?.stop();
      return;
    }

    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = false;

    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);

    r.onresult = (event) => {
      let transcript = "";
      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.current = r;
    r.start();
  }

  function clearConversation() {
    const newConversation = `web:${makeId()}`;
    localStorage.setItem(
      "fetch_conversation_id",
      newConversation
    );
    conversation.current = newConversation;

    setMessages([
      {
        id: makeId(),
        role: "assistant",
        text: "Fresh start. What do you need done?",
        meta: null
      }
    ]);

    setTask(null);
    resetActivity();
    setInput("");
  }

  const hasUserMessage = messages.some(
    (message) => message.role === "user"
  );

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={clearConversation}>
          fetch<span>.</span>
        </button>

        <div className="top">
          <span className="ready">
            <i /> Fetch is ready
          </span>
          <button onClick={clearConversation}>New</button>
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
            Don't choose the app, service or store.
            Tell Fetch the outcome you want and let
            Fetch work out the execution.
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
              <label>PRIVATE SESSION</label>
            </div>

            <div className="messages">
              {messages.map((m) => (
                <div className={`row ${m.role}`} key={m.id}>
                  {m.role === "assistant" && (
                    <b className="tiny">F.</b>
                  )}
                  <div className={`bubble ${m.role}`}>
                    {m.text}
                    {m.meta?.status &&
                      m.role === "assistant" && (
                        <small className="meta">
                          {friendlyStatus(m.meta.status)}
                        </small>
                      )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="row assistant">
                  <b className="tiny">F.</b>
                  <div className="bubble assistant thinking">
                    <i /><i /><i />
                    <small>Fetch is figuring it out…</small>
                  </div>
                </div>
              )}
            </div>

            <div className="composeArea">
              {!hasUserMessage && (
                <div className="starters">
                  {starters.map((x) => (
                    <button
                      key={x}
                      onClick={() => send(x)}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey
                    ) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Tell Fetch what you need…"
                  rows="1"
                  disabled={busy}
                />

                <button
                  type="button"
                  className={listening ? "listen" : ""}
                  onClick={voice}
                >
                  {listening ? "●" : "⌕"}
                </button>

                <button
                  className="send"
                  disabled={!input.trim() || busy}
                >
                  ↑
                </button>
              </form>

              <small className="hint">
                Enter to send · Fetch may ask for confirmation
                before taking an action
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
              You don't need to choose a service.
              Fetch determines the execution path behind
              the scenes.
            </p>

            <div className="flow">
              {activity.map((item, index) => (
                <React.Fragment key={item.id}>
                  <div className={`node ${item.state}`}>
                    <b>
                      {String(index + 1).padStart(2, "0")}
                    </b>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    {item.state === "complete" && (
                      <i className="check">✓</i>
                    )}
                    {item.state === "active" && (
                      <i className="pulse">●</i>
                    )}
                  </div>
                  {index < activity.length - 1 && (
                    <i className="line" />
                  )}
                </React.Fragment>
              ))}
            </div>

            {task && (
              <div className="live">
                <small>LIVE TASK · {task.stage}</small>
                <p>{task.text}</p>

                {task.intent && (
                  <span>
                    Intent <b>{task.intent}</b>
                  </span>
                )}

                {task.network && (
                  <span>
                    Route <b>{task.network}</b>
                  </span>
                )}

                {task.quote && (
                  <div className="quote">
                    <strong>Estimated total</strong>
                    <b>
                      ₹{task.quote.total}
                    </b>
                  </div>
                )}
              </div>
            )}

            <div className="networks">
              <b>◌<small>Digital</small></b>
              <b>◇<small>Physical</small></b>
              <b>⌁<small>Human</small></b>
            </div>

            <p className="note">
              Internal routing stays behind Fetch.
              Customers don't need to choose a store,
              service or execution method.
            </p>
          </aside>
        </section>

        <section className="statement">
          <small>THE IDEA</small>
          <h2>
            Don't learn another app.
            <br />
            <em>Delegate the task.</em>
          </h2>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
