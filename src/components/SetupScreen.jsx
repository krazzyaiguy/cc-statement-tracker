import { useState } from "react";
import { S } from "./Panels";

const AI_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export function SetupScreen({onSave}){
  const[geminiKey,setGeminiKey]=useState("");
  const[fbConfig,setFbConfig]=useState({apiKey:"",authDomain:"",projectId:"",storageBucket:"",messagingSenderId:"",appId:""});
  const[googleClientId,setGoogleClientId]=useState("");
  const[step,setStep]=useState(1);
  const[testing,setTesting]=useState(false);
  const[error,setError]=useState("");

  const testGroq=async()=>{
    if(!geminiKey.trim()){setError("Enter Groq API key");return;}
    setTesting(true);setError("");
    try{
      const res=await fetch("https://api.groq.com/openai/v1/models",{headers:{"Authorization":`Bearer ${geminiKey.trim()}`}});
      const d=await res.json();
      if(d.error)throw new Error(d.error.message||JSON.stringify(d.error));
      if(!d.data||d.data.length===0)throw new Error("Invalid API key");
      setStep(2);
    }catch(e){setError("Groq key error: "+e.message);}
    setTesting(false);
  };

  const finish=()=>{
    const fbReady=fbConfig.apiKey.trim()&&fbConfig.projectId.trim();
    if(fbReady){
      try{initFirebase(fbConfig);}catch(e){setError("Firebase config error: "+e.message);return;}
    }
    onSave({geminiKey:geminiKey.trim(),firebaseConfig:fbReady?fbConfig:null,googleClientId:googleClientId.trim()});
  };

  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#080c14",padding:24}}>
      <div style={{...S.card,padding:"36px 28px",maxWidth:520,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:34,marginBottom:12}}>💳</div>
        <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:6,background:"linear-gradient(90deg,#e2e8f0,#64748b)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>CC Statement Tracker</h1>

        {/* Step indicators */}
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          {["1 Groq Key","2 Firebase","3 Gmail"].map((s,i)=>(
            <div key={s} style={{flex:1,textAlign:"center",padding:"6px 4px",borderRadius:7,background:step===i+1?"#1e40af":step>i+1?"#052e16":"#0d1424",border:`1px solid ${step===i+1?"#3b82f6":step>i+1?"#14532d":"#1e293b"}`,fontSize:10,color:step===i+1?"#93c5fd":step>i+1?"#4ade80":"#334155",fontWeight:600}}>{step>i+1?"✓ ":""}{s}</div>
          ))}
        </div>

        {step===1&&(
          <div>
            <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>Groq Llama 4 Scout reads your PDF statements. Completely free.</p>
            <label style={S.label}>Groq API Key</label>
            <input type="password" value={geminiKey} onChange={e=>{setGeminiKey(e.target.value);setError("");}} placeholder="gsk_..." style={{...S.input,marginBottom:6}}/>
            <div style={{color:"#334155",fontSize:10,marginBottom:16}}>Get key → <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>console.groq.com/keys</a> · Free, no credit card</div>
            {error&&<div style={{background:"#3b1111",color:"#f87171",borderRadius:6,padding:"8px 12px",fontSize:11,marginBottom:12}}>✕ {error}</div>}
            <button onClick={testGroq} disabled={!geminiKey.trim()||testing} style={{...S.btn("#15803d",!geminiKey.trim()||testing),width:"100%",padding:"12px"}}>{testing?"⟳ Verifying…":"Verify & Next →"}</button>
          </div>
        )}

        {step===2&&(
          <div>
            <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:16}}>Firebase syncs your vault & records across <strong style={{color:"#94a3b8"}}>all devices</strong>. Free forever (Spark plan).</p>
            <div style={{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:8,padding:"12px 14px",marginBottom:16,fontSize:11,color:"#475569",lineHeight:1.9}}>
              <div style={{color:"#60a5fa",fontWeight:600,marginBottom:4}}>Setup Firebase (free, 5 min):</div>
              1. Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>console.firebase.google.com</a><br/>
              2. Create project → Add web app → Copy config<br/>
              3. Enable <strong style={{color:"#94a3b8"}}>Authentication</strong> → Sign-in method → Google<br/>
              4. Enable <strong style={{color:"#94a3b8"}}>Firestore Database</strong> → Start in test mode<br/>
              5. Paste each config value below
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              {[["apiKey","API Key"],["authDomain","Auth Domain"],["projectId","Project ID"],["storageBucket","Storage Bucket"],["messagingSenderId","Messaging Sender ID"],["appId","App ID"]].map(([k,label])=>(
                <div key={k}>
                  <label style={{...S.label,fontSize:9}}>{label}</label>
                  <input value={fbConfig[k]} onChange={e=>setFbConfig(p=>({...p,[k]:e.target.value}))} placeholder={k==="authDomain"?"xxx.firebaseapp.com":k==="projectId"?"your-project-id":""} style={{...S.input,fontSize:11,padding:"8px 10px"}}/>
                </div>
              ))}
            </div>
            {error&&<div style={{background:"#3b1111",color:"#f87171",borderRadius:6,padding:"8px 12px",fontSize:11,marginBottom:12}}>✕ {error}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setStep(3)} disabled={!fbConfig.apiKey.trim()||!fbConfig.projectId.trim()} style={{...S.btn("#1d4ed8",!fbConfig.apiKey.trim()||!fbConfig.projectId.trim()),flex:1,padding:"11px"}}>Next →</button>
              <button onClick={()=>setStep(3)} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"11px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>Skip (local only)</button>
            </div>
          </div>
        )}

        {step===3&&(
          <div>
            <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:16}}>Google Client ID enables Gmail auto-sync. See SETUP_GUIDE.md.</p>
            <label style={S.label}>Google OAuth Client ID <span style={{color:"#475569"}}>(optional)</span></label>
            <input type="text" value={googleClientId} onChange={e=>setGoogleClientId(e.target.value)} placeholder="xxxxxxx.apps.googleusercontent.com" style={{...S.input,marginBottom:16}}/>
            <button onClick={finish} style={{...S.btn("#15803d"),width:"100%",padding:"12px"}}>🚀 Launch App →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VAULT PANEL ──────────────────────────────────────────────────────────────
