import React, { useState } from "react";

const connectorOptions = [
  { id: "Swiggy", name: "Swiggy / Instamart", detail: "Food & groceries", icon: "S" },
  { id: "Uber", name: "Uber", detail: "Rides & mobility", icon: "U" },
  { id: "Email", name: "Gmail", detail: "Email & follow-up", icon: "G" }
];

export default function FetchOnboarding({ onComplete, onStarter, onConnect }) {
  const [step, setStep] = useState(0);
  const [connecting, setConnecting] = useState("");

  const finish = () => {
    try { localStorage.setItem("fetch_onboarding_v3_complete", "1"); } catch {}
    onComplete?.();
  };

  const chooseStarter = (text) => {
    finish();
    onStarter?.(text);
  };

  const connect = (id) => {
    setConnecting(id);
    onConnect?.(id);
  };

  return (
    <div className="fetchOnboarding" role="dialog" aria-modal="true">
      <div className="fetchOnboardingCard">
        <div className="fetchOnboardingTop">
          <div className="fetchOnboardingBrand">fetch<span>.</span></div>
          <div className="fetchOnboardingStep">{step + 1} / 4</div>
        </div>

        {step === 0 && (
          <div className="fetchOnboardingScreen fetchOnboardingWelcome">
            <div className="fetchOrb">F</div>
            <small>YOUR PERSONAL ASSISTANT</small>
            <h1>Tell Fetch what you need.<br /><em>We'll figure out the rest.</em></h1>
            <p>Chat naturally. Fetch understands the task, chooses the right service and helps get it done for you.</p>
            <button className="fetchOnboardingPrimary" onClick={() => setStep(1)}>Get started <span>→</span></button>
            <div className="fetchOnboardingTrust">Private by design · You stay in control</div>
          </div>
        )}

        {step === 1 && (
          <div className="fetchOnboardingScreen">
            <small>HOW FETCH WORKS</small>
            <h2>One conversation.<br /><em>Real actions.</em></h2>
            <div className="fetchPromiseList">
              <div><b>01</b><span><strong>Ask naturally</strong><small>Say what you need in your own words.</small></span></div>
              <div><b>02</b><span><strong>Fetch figures it out</strong><small>It plans the task and chooses the right service.</small></span></div>
              <div><b>03</b><span><strong>You stay in control</strong><small>Fetch asks before money, messages or sensitive actions.</small></span></div>
              <div><b>04</b><span><strong>Fetch follows through</strong><small>It keeps working, updates you and handles failures.</small></span></div>
            </div>
            <button className="fetchOnboardingPrimary" onClick={() => setStep(2)}>Continue <span>→</span></button>
          </div>
        )}

        {step === 2 && (
          <div className="fetchOnboardingScreen">
            <small>YOUR TOOLS</small>
            <h2>Connect what you<br /><em>already use.</em></h2>
            <p>You can skip this. Fetch will ask for a connection only when a task actually needs it.</p>
            <div className="fetchConnectorPreview">
              {connectorOptions.map((item) => (
                <div className="fetchConnectorRow" key={item.id}>
                  <div className="fetchConnectorIcon">{item.icon}</div>
                  <div className="fetchConnectorCopy"><strong>{item.name}</strong><span>{item.detail}</span></div>
                  <button onClick={() => connect(item.id)} disabled={connecting === item.id}>
                    {connecting === item.id ? "Opening…" : "Connect"}
                  </button>
                </div>
              ))}
            </div>
            <div className="fetchOnboardingHint">Connections are one-time and can be managed later.</div>
            <button className="fetchOnboardingPrimary" onClick={() => setStep(3)}>Continue <span>→</span></button>
          </div>
        )}

        {step === 3 && (
          <div className="fetchOnboardingScreen">
            <small>TRY FETCH</small>
            <h2>Start with something<br /><em>useful.</em></h2>
            <p>Pick a real task or just type whatever you need.</p>
            <div className="fetchStarterGrid">
              {[
                "Get me groceries for chicken curry",
                "Get me a ride to the airport",
                "Help me send an email"
              ].map((text) => (
                <button key={text} onClick={() => chooseStarter(text)}><span>→</span>{text}</button>
              ))}
            </div>
            <button className="fetchOnboardingSkip" onClick={finish}>I'll start with my own request</button>
          </div>
        )}

        <div className="fetchOnboardingProgress">
          {[0,1,2,3].map((item) => <i key={item} className={item <= step ? "active" : ""} />)}
        </div>
      </div>
    </div>
  );
}
