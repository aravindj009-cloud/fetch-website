import React,{useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

const starters=["Get me 2 KitKats and milk","Find the latest news about AI agents","Find me a good restaurant for tonight","Remember that I prefer things after 7 PM"];
const id=()=>`${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function App(){
 const [messages,setMessages]=useState([{id:"w",role:"assistant",text:"Hi, I’m Fetch. Tell me what you need done.",meta:null}]);
 const [input,setInput]=useState(""),[busy,setBusy]=useState(false),[listening,setListening]=useState(false),[task,setTask]=useState(null);
 const ref=useRef(null), recognition=useRef(null);
 const conversation=useRef(localStorage.getItem("fetch_conversation_id")||`web:${id()}`);
 localStorage.setItem("fetch_conversation_id",conversation.current);

 async function send(raw){
  const text=String(raw||"").trim(); if(!text||busy)return;
  setMessages(m=>[...m,{id:id(),role:"user",text,meta:null}]);setInput("");setBusy(true);setTask({text,stage:"understanding",status:"working"});
  try{
   const res=await fetch("/api/fetch/agent.mjs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,conversationId:conversation.current})});
   const data=await res.json(); if(!res.ok||!data?.success)throw Error(data?.error||"Fetch request failed");
   const route=data.atc?.resource_type||data.atc?.network||data.fetch?.intent?.domain||"agent";
   setTask({text,stage:data.status==="completed"?"done":data.status==="needs_clarification"?"needs input":"coordinating",status:data.status,network:route,workflowId:data.workflow_id});
   setMessages(m=>[...m,{id:id(),role:"assistant",text:data.message||"I’m working on that.",meta:{status:data.status,network:route}}]);
  }catch(e){setTask({text,stage:"error",status:"error"});setMessages(m=>[...m,{id:id(),role:"assistant",text:e.message||"I couldn’t process that right now.",meta:{status:"error"}}]);}
  finally{setBusy(false);setTimeout(()=>ref.current?.focus(),0);}
 }
 function voice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return alert("Voice input is not supported in this browser yet.");
  if(listening){recognition.current?.stop();return;}
  const r=new SR();r.lang="en-IN";r.interimResults=true;r.continuous=false;
  r.onstart=()=>setListening(true);r.onend=()=>setListening(false);r.onerror=()=>setListening(false);
  r.onresult=e=>{let t="";for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;setInput(t)};
  recognition.current=r;r.start();
 }
 function clear(){setMessages([{id:id(),role:"assistant",text:"Fresh start. What do you need done?",meta:null}]);setTask(null);setInput("");}
 return <div className="app">
  <header><button className="brand" onClick={clear}>fetch<span>.</span></button><div className="top"><span className="ready"><i/> Fetch is ready</span><button onClick={clear}>New</button></div></header>
  <main>
   <section className="intro"><small>PERSONAL AI AGENT</small><h1>Tell Fetch what you need.<br/><em>We’ll figure out how.</em></h1><p>Text naturally. Fetch understands the task, plans the work and coordinates the resources needed to get it done.</p></section>
   <section className="workspace">
    <div className="chat">
     <div className="chatHead"><div className="identity"><b>F.</b><span><strong>Fetch</strong><small>Personal assistant</small></span></div><label>PRIVATE SESSION</label></div>
     <div className="messages">{messages.map(m=><div className={`row ${m.role}`} key={m.id}>{m.role==="assistant"&&<b className="tiny">F.</b>}<div className={`bubble ${m.role}`}>{m.text}{m.meta?.network&&<small className="meta">{m.meta.status} · {m.meta.network}</small>}</div></div>)}{busy&&<div className="row assistant"><b className="tiny">F.</b><div className="bubble assistant thinking"><i/><i/><i/><small>Figuring it out…</small></div></div>}</div>
     <div className="composeArea">{!messages.some(m=>m.role==="user")&&<div className="starters">{starters.map(x=><button key={x} onClick={()=>send(x)}>{x}</button>)}</div>}
      <form onSubmit={e=>{e.preventDefault();send(input)}}><textarea ref={ref} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(input)}}} placeholder="Tell Fetch what you need…" rows="1" disabled={busy}/><button type="button" className={listening?"listen":""} onClick={voice}>{listening?"●":"⌕"}</button><button className="send" disabled={!input.trim()||busy}>↑</button></form><small className="hint">Enter to send · Fetch may ask for confirmation before an action</small>
     </div>
    </div>
    <aside><small>FETCH ATC</small><h2>You ask.<br/><em>Fetch coordinates.</em></h2><p>The user doesn't choose the service. Fetch determines the execution path behind the scenes.</p>
     <div className="flow">{[["01","Understand","Intent + context"],["02","Plan","Task + workflow"],["03","ATC","Choose resource"],["04","Act","Execute + update"]].map((x,i)=><React.Fragment key={x[0]}><div className={`node ${i===0?"active":""}`}><b>{x[0]}</b><span><strong>{x[1]}</strong><small>{x[2]}</small></span></div>{i<3&&<i className="line"/>}</React.Fragment>)}</div>
     {task&&<div className="live"><small>LIVE TASK · {task.stage}</small><p>{task.text}</p>{task.network&&<span>Route <b>{task.network}</b></span>}</div>}
     <div className="networks"><b>◌<small>Digital</small></b><b>◇<small>Physical</small></b><b>⌁<small>Human</small></b></div>
     <p className="note">Internal routing stays behind Fetch. Customers don't need to choose a store or service.</p>
    </aside>
   </section>
   <section className="statement"><small>THE IDEA</small><h2>Don’t learn another app.<br/><em>Delegate the task.</em></h2></section>
  </main>
 </div>
}
createRoot(document.getElementById("root")).render(<App/>);
