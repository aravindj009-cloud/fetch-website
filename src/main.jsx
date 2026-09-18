import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const examples = [
  { icon: "◌", text: "Get me 2 KitKats from a store near me." },
  { icon: "↗", text: "Pick up my package and bring it home." },
  { icon: "✦", text: "Find me a birthday gift under ₹2,000." },
  { icon: "⌁", text: "Find someone to repair my AC this weekend." }
];

const capabilities = [
  ["01", "Shopping", "Need something from somewhere? Tell Fetch what, where and when."],
  ["02", "Errands", "Give Fetch the task. It can coordinate the steps needed to get it done."],
  ["03", "Bookings", "From appointments to local services, Fetch can help turn intent into action."],
  ["04", "Everyday tasks", "The little things that take time shouldn't always take your time."]
];

function App() {
  const [activeExample, setActiveExample] = useState(0);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const demoRef = useRef(null);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [videoScene, setVideoScene] = useState(0);

  const videoScenes = [
    { kicker: "01 — YOU ASK", title: "Tell Fetch what you need.", copy: "A simple request in your own words becomes the starting point.", label: "CUSTOMER" },
    { kicker: "02 — FETCH ATC", title: "Fetch understands the task.", copy: "Intent becomes a task. The ATC layer finds the resources needed to execute it.", label: "ATC" },
    { kicker: "03 — STORE CONFIRMS", title: "The right resource responds.", copy: "A nearby partner store confirms availability and provides the product price.", label: "PARTNER STORE" },
    { kicker: "04 — SHOPPER ASSIGNED", title: "Fetch coordinates execution.", copy: "A nearby shopper accepts the job, collects the item and takes it to the customer.", label: "SHOPPER" },
    { kicker: "05 — DELIVERED", title: "The task gets done.", copy: "The customer receives the order while Fetch keeps the whole process coordinated.", label: "COMPLETED" },
  ];

  useEffect(() => {
    const id = setInterval(
      () => setActiveExample((v) => (v + 1) % examples.length),
      3200
    );

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!videoPlaying) return;
    const id = setInterval(() => {
      setVideoScene((v) => (v + 1) % videoScenes.length);
    }, 4200);
    return () => clearInterval(id);
  }, [videoPlaying]);

  const toggleVideo = () => setVideoPlaying((v) => !v);
  const restartVideo = () => {
    setVideoScene(0);
    setVideoPlaying(true);
  };

  const scrollTo = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const submit = async (e) => {
    e.preventDefault();

    if (!email.trim() || submitting) return;

    setSubmitting(true);

    try {
      const response = await fetch(
        "https://api.web3forms.com/submit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            access_key: "f713f421-5664-4311-807f-749a3d362442",
            email: email.trim(),
            subject: "New Fetch Early Access Signup",
            from_name: "Fetch Website",
            message: `New early access signup: ${email.trim()}`
          })
        }
      );

      const result = await response.json();

      if (result.success) {
        setSubmitted(true);
        setEmail("");
      } else {
        alert(
          result.message ||
            "Something went wrong. Please try again."
        );
      }
    } catch (error) {
      alert("Unable to submit right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="site">
      <nav className="nav">
        <button
          className="wordmark"
          onClick={() =>
            window.scrollTo({ top: 0, behavior: "smooth" })
          }
        >
          FETCH<span className="dot">.</span>
        </button>

        <div className="navLinks">
          <button onClick={() => scrollTo("how-fetch-works")}>
            How it works
          </button>

          <button onClick={() => scrollTo("capabilities")}>
            Capabilities
          </button>

          <button onClick={() => scrollTo("vision")}>
            Vision
          </button>
        </div>

        <button
          className="navCta"
          onClick={() => scrollTo("early-access")}
        >
          Get early access
        </button>
      </nav>

      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="pulse"></span> AI personal assistant
          </div>

          <h1>
            Your AI personal
            <br />
            <em>assistant for the real world.</em>
          </h1>

          <p className="heroCopy">
            Tell Fetch what you need. Fetch understands the task,
            figures out the next steps, and helps make it happen.
          </p>

          <div className="heroActions">
            <button
              className="primary"
              onClick={() => scrollTo("early-access")}
            >
              Try Fetch <span>↗</span>
            </button>

            <button
              className="secondary"
              onClick={() => scrollTo("how-fetch-works")}
            >
              See how it works <span>↓</span>
            </button>
          </div>

          <div
            className="heroVisual"
            id="demo"
            ref={demoRef}
          >
            <div className="orbital orbitalOne"></div>
            <div className="orbital orbitalTwo"></div>

            <div className="assistantCard">
              <div className="cardTop">
                <div className="miniLogo">
                  F<span>.</span>
                </div>

                <div>
                  <strong>FETCH</strong>
                  <small>personal assistant</small>
                </div>

                <div className="live">
                  <span></span> Ready
                </div>
              </div>

              <div className="conversation">
                <div className="userBubble">
                  {examples[activeExample].icon}&nbsp;
                  {examples[activeExample].text}
                </div>

                <div className="fetchReply">
                  <div className="replyIcon">F.</div>

                  <div>
                    <strong>Got it.</strong>

                    <p>
                      I’ll figure out the best way to get this done.
                    </p>

                    <div className="steps">
                      <span className="done">
                        ✓ Understanding
                      </span>

                      <span>→ Planning</span>
                      <span>→ Acting</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="composer">
                <span>Tell Fetch what you need…</span>
                <button>↑</button>
              </div>
            </div>

            <div className="floatTag tagA">UNDERSTAND</div>
            <div className="floatTag tagB">ACT</div>
            <div className="floatTag tagC">DONE</div>
          </div>
        </section>

        <section className="fetchVideoSection" id="how-fetch-works">
          <div className="fetchVideoHeader">
            <div>
              <div className="sectionLabel">SEE FETCH IN ACTION</div>
              <h2>One request.<br /><em>A real-world response.</em></h2>
            </div>
            <p>Watch the journey from a simple request to a completed real-world task.</p>
          </div>

          <div className={`fetchVideo ${videoPlaying ? "isPlaying" : "isPaused"}`}>
            <div className="videoChrome">
              <div className="videoChromeLeft"><span className="videoDot"></span><span>FETCH / PRODUCT DEMO</span></div>
              <div className="videoTime">0:{String(Math.min(59, videoScene * 12)).padStart(2, "0")} / 0:60</div>
            </div>

            <div className="videoStage">
              <div className="videoGrid"></div>
              <div className="videoGlow"></div>

              <div className="videoFlowLine">
                {videoScenes.map((_, i) => (
                  <React.Fragment key={i}>
                    <span className={videoScene >= i ? "active" : ""}></span>
                    {i < videoScenes.length - 1 && <i></i>}
                  </React.Fragment>
                ))}
              </div>

              <div className="videoSceneCopy">
                <div className="videoKicker">{videoScenes[videoScene].kicker}</div>
                <h3>{videoScenes[videoScene].title}</h3>
                <p>{videoScenes[videoScene].copy}</p>
              </div>
              <div className="videoSceneLabel">{videoScenes[videoScene].label}</div>

              <div className="videoMockArea">
                {videoScene === 0 && <div className="mockPhone">
                  <div className="mockPhoneTop"><span>‹</span><strong>FETCH</strong><small>online</small></div>
                  <div className="mockChat">
                    <div className="chatBubble customer">Get me 2 KitKats from a nearby store.<small>10:24 AM ✓✓</small></div>
                    <div className="chatBubble fetch"><strong>Fetch</strong>Got it. I’m finding the best way to get this done.<small>10:24 AM</small></div>
                  </div>
                  <div className="mockInput">Tell Fetch what you need… <b>↑</b></div>
                </div>}

                {videoScene === 1 && <div className="atcConsole">
                  <div className="atcLogo">F<span>.</span></div>
                  <div className="atcTitle"><strong>FETCH ATC</strong><small>REAL-WORLD TASK ORCHESTRATION</small></div>
                  <div className="atcNodes">
                    <div className="atcNode done"><span>01</span><b>INTENT</b><em>✓</em></div><div className="atcConnector"></div>
                    <div className="atcNode done"><span>02</span><b>TASK</b><em>✓</em></div><div className="atcConnector"></div>
                    <div className="atcNode active"><span>03</span><b>RESOURCE DISCOVERY</b><em>↗</em></div><div className="atcConnector"></div>
                    <div className="atcNode"><span>04</span><b>MATCHING</b><em>○</em></div>
                  </div>
                  <div className="atcStatus"><span></span> Finding the right resource…</div>
                </div>}

                {videoScene === 2 && <div className="storeMock">
                  <div className="storeHeader"><div className="storeAvatar">S</div><div><strong>FETCH</strong><small>Partner Store</small></div><span>●</span></div>
                  <div className="storeBody"><small>NEW FETCH ORDER</small><h4>2 × KitKat</h4><p>Please confirm availability.</p><div className="choiceButtons"><button>AVAILABLE</button><button>UNAVAILABLE</button></div></div>
                  <div className="storeAccepted">✓ Availability confirmed</div>
                </div>}

                {videoScene === 3 && <div className="shopperMock">
                  <div className="mapCard"><div className="mapLines"></div><div className="mapPin storePin">S</div><div className="mapPin customerPin">C</div><div className="route"></div></div>
                  <div className="jobCard"><div className="jobTop"><span>FETCH SHOPPER</span><b>NEW JOB</b></div><h4>Collect & deliver</h4><p><strong>Collect:</strong> Partner Store</p><p><strong>Deliver:</strong> Customer</p><div className="jobMeta"><span>2.2 km</span><span>Delivery fee ₹22</span></div><button>ACCEPT <span>→</span></button></div>
                </div>}

                {videoScene === 4 && <div className="deliveredMock">
                  <div className="deliveredCircle">✓</div><div className="deliveredWord">DELIVERED</div><p>Your real-world task is complete.</p>
                  <div className="deliverySteps"><span>Accepted</span><i>→</i><span>Picked up</span><i>→</i><span>Delivered</span></div>
                </div>}
              </div>
            </div>

            <div className="videoControls">
              <button className="videoControl" onClick={toggleVideo} aria-label={videoPlaying ? "Pause demo" : "Play demo"}>{videoPlaying ? "Ⅱ" : "▶"}</button>
              <button className="videoControl replay" onClick={restartVideo} aria-label="Restart demo">↻</button>
              <div className="videoProgress"><div className="videoProgressTrack"><span style={{width:`${((videoScene+1)/videoScenes.length)*100}%`}}></span></div>
                <div className="videoProgressSteps">{videoScenes.map((scene,i)=><button key={scene.kicker} className={i===videoScene?"current":i<videoScene?"visited":""} onClick={()=>{setVideoScene(i);setVideoPlaying(true)}} aria-label={`Go to ${scene.label}`}></button>)}</div>
              </div>
              <span className="videoControlLabel">{videoPlaying ? "PLAYING" : "PAUSED"}</span>
            </div>
          </div>
        </section>

        <section className="statement">
          <div className="sectionLabel">THE IDEA</div>

          <h2>
            AI shouldn't just <span>answer.</span>
            <br />
            It should <strong>act.</strong>
          </h2>

          <p>
            Today's assistants are getting better at finding
            information. Fetch is being built around a different
            question:{" "}
            <b>what if you could simply delegate the task?</b>
          </p>
        </section>

        <section className="how" id="how">
          <div className="sectionLabel">HOW FETCH WORKS</div>

          <div className="process">
            <div className="processIntro">
              <h2>
                From intention
                <br />
                to <em>action.</em>
              </h2>

              <p>
                One simple instruction can become a series of
                coordinated actions.
              </p>
            </div>

            {[
              [
                "01",
                "Tell Fetch",
                "Say what you need in your own words. No forms. No complicated menus."
              ],
              [
                "02",
                "Fetch understands",
                "Your request becomes a clear task, with the context needed to execute it."
              ],
              [
                "03",
                "Fetch acts",
                "Fetch can coordinate software, businesses, services and people when needed."
              ],
              [
                "04",
                "It gets done",
                "You stay in control. Fetch keeps you informed and confirms the result."
              ]
            ].map(([n, t, d]) => (
              <div className="processCard" key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
                <i>↗</i>
              </div>
            ))}
          </div>
        </section>

        <section
          className="capabilities"
          id="capabilities"
        >
          <div className="sectionLabel">
            WHAT FETCH CAN DO
          </div>

          <div className="capHeader">
            <h2>
              Delegate the
              <br />
              <em>everyday.</em>
            </h2>

            <p>
              Fetch starts with practical tasks people already
              spend time coordinating — and expands from there.
            </p>
          </div>

          <div className="capGrid">
            {capabilities.map(([n, t, d]) => (
              <div className="capCard" key={n}>
                <span className="capNumber">{n}</span>

                <div className="capIcon">
                  {["◇", "⌁", "○", "✦"][Number(n) - 1]}
                </div>

                <h3>{t}</h3>

                <p>{d}</p>

                <span className="arrow">↗</span>
              </div>
            ))}
          </div>
        </section>

        <section className="example">
          <div className="sectionLabel">
            A SIMPLE EXAMPLE
          </div>

          <div className="exampleGrid">
            <div>
              <p className="quoteMark">“</p>

              <h2>
                Get me 2 KitKats
                <br />
                from <em>MS Bakers.</em>
              </h2>

              <p className="muted">
                A simple request. A real-world task. Fetch handles
                the coordination.
              </p>
            </div>

            <div className="execution">
              {[
                "Request understood",
                "Store identified",
                "Task coordinated",
                "Purchase & delivery",
                "Completed"
              ].map((x, i) => (
                <div className="execRow" key={x}>
                  <span>
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  <b>{x}</b>

                  <i>{i < 4 ? "✓" : "✦"}</i>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="vision" id="vision">
          <div className="visionGlow"></div>

          <div className="sectionLabel">THE VISION</div>

          <h2>
            Stop managing apps.
            <br />
            <em>Start delegating.</em>
          </h2>

          <p>
            We believe the next generation of personal AI won't
            live inside one app. It will sit between you and the
            world — understanding what you want and coordinating
            whatever is needed to make it happen.
          </p>

          <div className="visionLine">
            <span>YOUR INTENT</span>
            <b>→</b>
            <span>FETCH</span>
            <b>→</b>
            <span>THE WORLD</span>
          </div>
        </section>

        <section className="early" id="early-access">
          <div className="sectionLabel">EARLY ACCESS</div>

          <h2>
            Have something
            <br />
            <em>for Fetch?</em>
          </h2>

          <p>
            We're building Fetch step by step. Join the early
            access list and follow the journey.
          </p>

          {submitted ? (
            <div className="success">
              You're on the list. <span>✦</span>
            </div>
          ) : (
            <form onSubmit={submit}>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                required
                disabled={submitting}
              />

              <button
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? "Joining..."
                  : "Join early access"}{" "}
                <span>↗</span>
              </button>
            </form>
          )}
        </section>
      </main>

      <footer>
        <div className="footerTop">
          <div className="footerBrand">
            FETCH<span>.</span>

            <p>
              Your AI personal assistant
              <br />
              for the real world.
            </p>
          </div>

          <div className="footerLinks">
            <button onClick={() => scrollTo("how-fetch-works")}>
              How it works
            </button>

            <button
              onClick={() => scrollTo("capabilities")}
            >
              Capabilities
            </button>

            <button onClick={() => scrollTo("vision")}>
              Vision
            </button>

            <button
              onClick={() => scrollTo("early-access")}
            >
              Early access
            </button>
          </div>
        </div>

        <div className="footerBottom">
          <span>© 2026 Fetch</span>
          <span>
            Built for the world beyond the screen.
          </span>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
