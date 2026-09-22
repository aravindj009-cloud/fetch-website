import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const starters = [
  "Get me 2 KitKats and milk",
  "Find the latest news about AI agents",
  "Find me a good restaurant for tonight",
  "Remember that I prefer things after 7 PM",
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

function friendlyIntent(intent) {
  const map = {
    physical_purchase: "Getting things for you",
    digital_research: "Researching this",
    restaurant_reservation: "Finding the right place",
    travel_search: "Working on your travel request",
    phone_call: "Preparing the call",
    reminder: "Setting this up",
    general_assistance: "Figuring it out",
  };

  return map[intent] || "Working on it";
}

function friendlyStatus(status) {
  const map = {
    awaiting_physical_order: "Fulfilment path found",
    resource_matched: "Execution path selected",
    completed: "Done",
    needs_clarification: "Need a little more information",
    in_progress: "Working on it",
  };

  return map[status] || "Coordinating";
}

function App() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi, I’m Fetch. Tell me what you need done.",
      meta: null,
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);

  const [task, setTask] = useState(null);

  const [activity, setActivity] = useState([
    {
      id: "understand",
      label: "Understand",
      description: "Intent + context",
      state: "idle",
    },
    {
      id: "plan",
      label: "Plan",
      description: "Task + workflow",
      state: "idle",
    },
    {
      id: "route",
      label: "ATC",
      description: "Choose resource",
      state: "idle",
    },
    {
      id: "act",
      label: "Act",
      description: "Execute + update",
      state: "idle",
    },
  ]);

  const inputRef = useRef(null);
  const recognition = useRef(null);
  const conversation = useRef(getConversationId());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function updateActivity(states) {
    setActivity((current) =>
      current.map((item) => ({
        ...item,
        state: states[item.id] || item.state,
      }))
    );
  }

  function beginActivity() {
    updateActivity({
      understand: "active",
      plan: "waiting",
      route: "waiting",
      act: "waiting",
    });

    setTimeout(() => {
      updateActivity({
        understand: "complete",
        plan: "active",
        route: "waiting",
        act: "waiting",
      });
    }, 450);

    setTimeout(() => {
      updateActivity({
        understand: "complete",
        plan: "complete",
        route: "active",
        act: "waiting",
      });
    }, 900);
  }

  function finishActivity(completed = false) {
    if (completed) {
      updateActivity({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: "complete",
      });
    } else {
      updateActivity({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: "active",
      });
    }
  }

  async function send(raw) {
    const text = String(raw || "").trim();

    if (!text || busy) return;

    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "user",
        text,
        meta: null,
      },
    ]);

    setInput("");
    setBusy(true);

    setTask({
      text,
      stage: "understanding",
      status: "working",
      network: null,
      intent: null,
      workflowId: null,
    });

    beginActivity();

    try {
      const response = await fetch("/api/fetch/agent.mjs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          conversationId: conversation.current,
          channel: "web",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Fetch could not process that request."
        );
      }

      const intent = data.fetch?.intent || null;

      const route =
        data.atc?.resource_type ||
        data.atc?.network ||
        intent ||
        "agent";

      const status = data.status || "unknown";

      const completed = status === "completed";

      finishActivity(completed);

      setTask({
        text,
        stage:
          status === "completed"
            ? "done"
            : status === "needs_clarification"
            ? "needs input"
            : status === "awaiting_physical_order"
            ? "ready for next step"
            : "coordinating",

        status,
        network: route,
        intent,
        workflowId: data.workflow_id,
      });

      let assistantText = data.message || "I’m working on that.";

      if (intent) {
        const prefix = friendlyIntent(intent);

        if (
          status !== "completed" &&
          status !== "needs_clarification" &&
          status !== "awaiting_physical_order"
        ) {
          assistantText = `${prefix}. ${assistantText}`;
        }
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: assistantText,
          meta: {
            status,
            network: route,
            intent,
          },
        },
      ]);
    } catch (error) {
      updateActivity({
        understand: "complete",
        plan: "complete",
        route: "complete",
        act: "error",
      });

      setTask({
        text,
        stage: "error",
        status: "error",
        network: null,
        intent: null,
        workflowId: null,
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text:
            error?.message ||
            "I couldn’t process that right now. Please try again.",
          meta: {
            status: "error",
            network: null,
          },
        },
      ]);
    } finally {
      setBusy(false);

      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }

  function voice() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser yet.");
      return;
    }

    if (listening) {
      recognition.current?.stop();
      return;
    }

    const recognizer = new SpeechRecognition();

    recognizer.lang = "en-IN";
    recognizer.interimResults = true;
    recognizer.continuous = false;

    recognizer.onstart = () => {
      setListening(true);
    };

    recognizer.onend = () => {
      setListening(false);
    };

    recognizer.onerror = () => {
      setListening(false);
    };

    recognizer.onresult = (event) => {
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

    recognition.current = recognizer;
    recognizer.start();
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
        meta: null,
      },
    ]);

    setTask(null);

    setActivity([
      {
        id: "understand",
        label: "Understand",
        description: "Intent + context",
        state: "idle",
      },
      {
        id: "plan",
        label: "Plan",
        description: "Task + workflow",
        state: "idle",
      },
      {
        id: "route",
        label: "ATC",
        description: "Choose resource",
        state: "idle",
      },
      {
        id: "act",
        label: "Act",
        description: "Execute + update",
        state: "idle",
      },
    ]);

    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
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
          type="button"
        >
          fetch<span>.</span>
        </button>

        <div className="top">
          <span className="ready">
            <i />
            Fetch is ready
          </span>

          <button
            onClick={clearConversation}
            type="button"
          >
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
              {messages.map((message) => (
                <div
                  className={`row ${message.role}`}
                  key={message.id}
                >
                  {message.role === "assistant" && (
                    <b className="tiny">F.</b>
                  )}

                  <div
                    className={`bubble ${message.role}`}
                  >
                    {message.text}

                    {message.meta?.status &&
                      message.role === "assistant" && (
                        <small className="meta">
                          {friendlyStatus(
                            message.meta.status
                          )}
                        </small>
                      )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="row assistant">
                  <b className="tiny">F.</b>

                  <div className="bubble assistant thinking">
                    <i />
                    <i />
                    <i />

                    <small>
                      Fetch is figuring it out…
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
                      type="button"
                      onClick={() => send(starter)}
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
                  className={listening ? "listen" : ""}
                  onClick={voice}
                  aria-label="Voice input"
                >
                  {listening ? "●" : "⌕"}
                </button>

                <button
                  className="send"
                  disabled={!input.trim() || busy}
                  type="submit"
                  aria-label="Send"
                >
                  ↑
                </button>
              </form>

              <small className="hint">
                Enter to send · Fetch may ask for
                confirmation before taking an action
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
              Fetch determines the execution path
              behind the scenes.
            </p>

            <div className="flow">
              {activity.map((item, index) => (
                <React.Fragment key={item.id}>
                  <div
                    className={`node ${item.state}`}
                  >
                    <b>
                      {String(index + 1).padStart(2, "0")}
                    </b>

                    <span>
                      <strong>{item.label}</strong>
                      <small>
                        {item.description}
                      </small>
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
                <small>
                  LIVE TASK · {task.stage}
                </small>

                <p>{task.text}</p>

                {task.intent && (
                  <span>
                    Intent{" "}
                    <b>{task.intent}</b>
                  </span>
                )}

                {task.network && (
                  <span>
                    Route{" "}
                    <b>{task.network}</b>
                  </span>
                )}

                {task.workflowId && (
                  <span>
                    Workflow{" "}
                    <b>
                      {task.workflowId.slice(0, 18)}
                    </b>
                  </span>
                )}
              </div>
            )}

            <div className="networks">
              <b>
                ◌
                <small>Digital</small>
              </b>

              <b>
                ◇
                <small>Physical</small>
              </b>

              <b>
                ⌁
                <small>Human</small>
              </b>
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

createRoot(
  document.getElementById("root")
).render(<App />);
