import { useState, useRef, useEffect, useCallback } from "react";
import { ls } from "./utils/storage";
import { exportToExcel } from "./utils/excel";
import { resolvePasswords } from "./utils/passwords";
import { pdfBytesToBase64Image, tryPasswordsOnPDF, fileToBase64, callGroq } from "./utils/pdfGroqGmail";
import {
  initFirebase, signInWithGoogle, signOutUser, onAuthChange,
  loadVault, saveVault,
  loadPeople, savePeople,
  loadRecords, saveRecords,
  loadMeta, saveMeta,
} from "./firebase";
import { SetupScreen } from "./components/SetupScreen";
import { S, Badge, PasswordModal, VaultPanel, PeoplePanel, BankRulesPanel, SettingsPanel } from "./components/Panels";
import { ITRPanel } from "./components/ITRPanel";
import { GmailSyncPanel } from "./components/GmailSync";
import { DEFAULT_BANK_RULES } from "./utils/passwords";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SETTINGS_KEY    = "cc_settings_v2";
const BANK_RULES_KEY  = "cc_bank_rules_v1";

export default function App(){
  const[settings,setSettings]   = useState(()=>ls.get(SETTINGS_KEY));
  const[user,setUser]           = useState(null);      // Firebase auth user
  const[authReady,setAuthReady] = useState(false);
  const[records,setRecords]     = useState(()=>{ try{const v=JSON.parse(localStorage.getItem('cc_records_v1')||'[]');return Array.isArray(v)?v:[];}catch{return [];} });
  const[vault,setVault]         = useState(()=>{ try{const v=JSON.parse(localStorage.getItem('cc_vault_v2')||'[]');return Array.isArray(v)?v:[];}catch{return [];} });
  const[bankRules,setBankRules]   = useState(()=>{ try{const v=JSON.parse(localStorage.getItem(BANK_RULES_KEY)||'null');return Array.isArray(v)?v:DEFAULT_BANK_RULES;}catch{return DEFAULT_BANK_RULES;} });
  const[itrData,setItrData]       = useState(()=>{ try{return JSON.parse(localStorage.getItem('cc_itr_v1')||'{}');}catch{return {};} });
  const[editCell,setEditCell]     = useState(null); // {id, field}
  const[editVal,setEditVal]       = useState("");
  const[people,setPeople]       = useState(()=>{ try{const v=JSON.parse(localStorage.getItem('cc_people_v1')||'[]');return Array.isArray(v)?v:[];}catch{return [];} });
  const[processedIds,setProcessedIds] = useState([]);
  const[files,setFiles]         = useState([]);
  const[dragging,setDragging]   = useState(false);
  const[processing,setProcessing]=useState(false);
  const[pwdModal,setPwdModal]   = useState(null);
  const[activeTab,setActiveTab] = useState("gmail");
  const[syncing,setSyncing]     = useState(false);  // Firebase sync indicator
  const inputRef=useRef(); const processingRef=useRef(false);

  // ── Firebase: simple load-on-login, save-on-change (no real-time listeners) ──
  useEffect(()=>{
    if(!settings?.firebaseConfig){ setAuthReady(true); return; }
    try{ initFirebase(settings.firebaseConfig); }catch(e){ console.error(e); setAuthReady(true); return; }
    const unsub = onAuthChange(async(u)=>{
      setUser(u); setAuthReady(true);
      if(u){
        console.log("[Firebase] Signed in as:", u.email, "uid:", u.uid);
        try{
          console.log("[Firebase] Loading data from Firestore...");
          const [fbVault, fbPeople, fbRecords, fbMeta] = await Promise.all([
            loadVault(u.uid), loadPeople(u.uid), loadRecords(u.uid), loadMeta(u.uid)
          ]);
          console.log("[Firebase] Loaded → vault:", fbVault.length, "people:", fbPeople.length, "records:", fbRecords.length, "meta:", fbMeta);

          const localVault = JSON.parse(localStorage.getItem('cc_vault_v2')||'[]');
          const localPeople = JSON.parse(localStorage.getItem('cc_people_v1')||'[]');
          console.log("[Firebase] Local → vault:", localVault.length, "people:", localPeople.length);

          if(fbVault.length>0){ setVault(fbVault); console.log("[Firebase] Using Firebase vault"); }
          else if(localVault.length>0){
            setVault(localVault);
            const saved=await saveVault(u.uid,localVault);
            console.log("[Firebase] Uploaded local vault to Firebase:", saved);
          }

          if(fbPeople.length>0){ setPeople(fbPeople); console.log("[Firebase] Using Firebase people"); }
          else if(localPeople.length>0){
            setPeople(localPeople);
            const saved=await savePeople(u.uid,localPeople);
            console.log("[Firebase] Uploaded local people to Firebase:", saved);
          }

          const localRecords = JSON.parse(localStorage.getItem('cc_records_v1')||'[]');
          if(fbRecords.length>0){
            setRecords(fbRecords);
            console.log("[Firebase] Using Firebase records:", fbRecords.length);
          } else if(localRecords.length>0){
            setRecords(localRecords);
            console.log("[Firebase] Using local records:", localRecords.length);
            saveRecords(u.uid, localRecords).catch(()=>{});
          }

          if(fbMeta.settings) setSettings(s=>({...s,...fbMeta.settings}));
          if(fbMeta.processedIds) setProcessedIds(fbMeta.processedIds);
          console.log("[Firebase] All data loaded successfully ✓");
        }catch(e){
          console.error("[Firebase] Load FAILED:", e.code, e.message);
          // Firebase failed — load everything from localStorage as fallback
          try{
            const lv=JSON.parse(localStorage.getItem('cc_vault_v2')||'[]');
            const lp=JSON.parse(localStorage.getItem('cc_people_v1')||'[]');
            const lr=JSON.parse(localStorage.getItem('cc_records_v1')||'[]');
            if(lv.length>0) setVault(lv);
            if(lp.length>0) setPeople(lp);
            if(lr.length>0) setRecords(lr);
            console.log("[Firebase] Loaded from localStorage fallback — vault:", lv.length, "people:", lp.length, "records:", lr.length);
          }catch{}
        }
      }
    });
    return ()=>unsub();
  },[settings?.firebaseConfig]); // eslint-disable-line

  // Save settings to localStorage always
  useEffect(()=>{ if(settings) ls.set(SETTINGS_KEY,settings); },[settings]);

  // Save people to localStorage always + Firebase when signed in
  // Save to localStorage + Firebase on every change
  // Using JSON comparison to avoid saving on initial load from Firebase
  const prevPeopleRef=useRef(null);
  useEffect(()=>{
    const json=JSON.stringify(people);
    if(prevPeopleRef.current===json) return; // no real change
    prevPeopleRef.current=json;
    try{localStorage.setItem('cc_people_v1',json);}catch{}
    if(user&&people.length>=0){
      savePeople(user.uid,people)
        .then(ok=>console.log('[Firebase] savePeople:',ok,people.length,'entries'))
        .catch(e=>console.error('[Firebase] savePeople FAILED:',e.code,e.message));
    }
  },[people,user]); // eslint-disable-line

  // Save bankRules to localStorage
  useEffect(()=>{ try{localStorage.setItem(BANK_RULES_KEY,JSON.stringify(bankRules));}catch{} },[bankRules]);

  const prevVaultRef=useRef(null);
  useEffect(()=>{
    const json=JSON.stringify(vault);
    if(prevVaultRef.current===json) return;
    prevVaultRef.current=json;
    try{localStorage.setItem('cc_vault_v2',json);}catch{}
    if(user&&vault.length>=0){
      saveVault(user.uid,vault)
        .then(ok=>console.log('[Firebase] saveVault:',ok,vault.length,'entries'))
        .catch(e=>console.error('[Firebase] saveVault FAILED:',e.code,e.message));
    }
  },[vault,user]); // eslint-disable-line

  const prevRecordsRef=useRef(null);
  useEffect(()=>{
    const json=JSON.stringify(records);
    if(prevRecordsRef.current===json) return;
    prevRecordsRef.current=json;
    // Save to localStorage immediately (works offline)
    if(records.length>0) try{localStorage.setItem('cc_records_v1',json);}catch{}
    // Save to Firebase (may fail if offline — localStorage is the backup)
    if(user&&records.length>0){
      saveRecords(user.uid,records)
        .then(ok=>console.log('[Firebase] saveRecords:',ok,records.length,'entries'))
        .catch(e=>console.error('[Firebase] saveRecords FAILED:',e.code,e.message));
    }
  },[records,user]); // eslint-disable-line

  // Save processedIds to Firebase
  useEffect(()=>{
    if(user&&processedIds.length>0) saveMeta(user.uid,{processedIds}).catch(()=>{});
  },[user,processedIds]); // eslint-disable-line

  // Auto-delete records older than retention days
  const retentionDays = settings?.retentionDays || 60;
  useEffect(()=>{
    if(!records.length) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate()-retentionDays);
    const fresh = records.filter(r=>{
      if(!r.receivedOn) return true;
      const parts = r.receivedOn.split("/");
      if(parts.length!==3) return true;
      const d = new Date(parts[2],parts[1]-1,parts[0]);
      return d >= cutoff;
    });
    if(fresh.length < records.length) setRecords(fresh);
  },[retentionDays,records.length]); // eslint-disable-line

  const handleSaveKey=(s)=>{ setSettings(s); ls.set(SETTINGS_KEY,s); };
  const handleRetentionChange=(days)=>{ const s={...settings,retentionDays:days}; setSettings(s); ls.set(SETTINGS_KEY,s); };

  // Hooks before early returns
  const handleNewRecords=useCallback((newRecs)=>{
    setRecords(prev=>{const ex=new Set(prev.map(r=>r.id));return[...prev,...newRecs.filter(r=>!ex.has(r.id))];});
  },[]);
  const handleProcessed=useCallback((id)=>setProcessedIds(prev=>prev.includes(id)?prev:[...prev,id]),[]);

  if(!authReady) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#080c14",color:"#475569",fontFamily:"'DM Mono',monospace",fontSize:13}}>⟳ Loading…</div>;
  if(!settings)  return <SetupScreen onSave={handleSaveKey}/>;

  // Firebase sign in/out
  const handleFirebaseSignIn=async()=>{
    try{
      setSyncing(true);
      const{user:u,accessToken}=await signInWithGoogle();
      setUser(u);
      if(accessToken){ ls.set("cc_gmail_token",accessToken); ls.set("cc_gmail_email",u.email||""); }
    }catch(e){ alert("Sign in failed: "+e.message); }
    setSyncing(false);
  };
  const handleFirebaseSignOut=async()=>{ await signOutUser(); setUser(null); ls.del("cc_gmail_token"); ls.del("cc_gmail_email"); };

  // ── Data operations: always update state + localStorage immediately ──────────
  // Firebase saves happen via the useEffects above (debounced, no quota burn)

  const handleAddVault    =(entry)=>setVault(p=>[...p,entry]);
  const handleUpdateVault =(fid,data)=>setVault(p=>p.map(e=>(e.firestoreId||e.id)===fid?{...e,...data}:e));
  const handleDeleteVault =(fid)=>setVault(p=>p.filter(e=>(e.firestoreId||e.id)!==fid));

  const handleAddPerson    =(p)=>setPeople(prev=>[...prev,p]);
  const handleUpdatePerson =(fid,data)=>setPeople(prev=>prev.map(p=>(p.firestoreId||p.id)===fid?{...p,...data}:p));
  const handleDeletePerson =(fid)=>setPeople(prev=>prev.filter(p=>(p.firestoreId||p.id)!==fid));

  // ── Date helpers ─────────────────────────────────────────────────────────────
  const parseDate=(s)=>{ if(!s)return null; const[d,m,y]=s.split("/"); return new Date(y,m-1,d); };
  const daysUntil=(s)=>{ const d=parseDate(s); if(!d)return null; return Math.ceil((d-new Date().setHours(0,0,0,0))/(86400000)); };
  const getDueStatus=(r)=>{
    if(r.paid) return {label:"✓ PAID",color:"#4ade80",bg:"#052e16",urgent:false};
    const days=daysUntil(r.dueDate);
    if(days===null) return {label:"PENDING",color:"#94a3b8",bg:"#1e293b",urgent:false};
    if(days<0&&days>=-3) return {label:`GRACE ${-days}d left`,color:"#fff",bg:"#7f1d1d",urgent:true,blink:true};
    if(days<0) return {label:"OVERDUE",color:"#fca5a5",bg:"#450a0a",urgent:true};
    if(days===0) return {label:"DUE TODAY",color:"#fff",bg:"#b45309",urgent:true,blink:true};
    if(days<=3) return {label:`DUE in ${days}d`,color:"#fff",bg:"#c2410c",urgent:true};
    if(days<=7) return {label:`DUE in ${days}d`,color:"#fbbf24",bg:"#1e293b",urgent:false};
    return {label:"PENDING",color:"#94a3b8",bg:"#1e293b",urgent:false};
  };

  // Sort records: unpaid by due date ascending, paid at bottom
  const sortedRecords = [...records].sort((a,b)=>{
    if(a.paid&&!b.paid) return 1;
    if(!a.paid&&b.paid) return -1;
    const da=parseDate(a.dueDate), db=parseDate(b.dueDate);
    if(!da&&!db) return 0;
    if(!da) return 1;
    if(!db) return -1;
    return da-db;
  });

  const handleTogglePaid=(r)=>setRecords(prev=>prev.map(rec=>rec.id===r.id?{...rec,paid:!rec.paid,paidAmount:!rec.paid?rec.dueAmount:0}:rec));
  const handleDeleteRecord=(r)=>setRecords(prev=>prev.filter(rec=>rec.id!==r.id));
  const startEdit=(id,field,val)=>{ setEditCell({id,field}); setEditVal(val||""); };
  const commitEdit=(r)=>{
    if(!editCell) return;
    setRecords(prev=>prev.map(rec=>rec.id===r.id?{...rec,[editCell.field]:editCell.field==="dueAmount"?parseFloat(editVal)||rec.dueAmount:editVal}:rec));
    setEditCell(null);
  };
  const handlePartialPayment=(r,amt)=>{
    const paid=parseFloat(amt)||0;
    if(paid===0) return;
    const original = r.originalAmount ?? r.dueAmount ?? 0;
    const history  = r.paymentHistory || [];
    const now      = new Date();
    const entry    = { amount:paid, date:now.toLocaleDateString("en-GB"), time:now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}), note: paid<0?"correction":"" };
    const newHistory = [...history, entry];
    const totalPaid  = newHistory.reduce((s,p)=>s+p.amount, 0);
    const remaining  = Math.max(0, Math.round((original - totalPaid)*100)/100);

    setRecords(prev=>prev.map(rec=>rec.id===r.id?{
      ...rec,
      originalAmount: original,
      dueAmount: remaining,
      paidAmount: totalPaid,
      paymentHistory: newHistory,
      paid: remaining<=0
    }:rec));

    // Only add to ITR if positive payment (not corrections)
    if(paid>0){
      const person  = (r.cardholderName||"Unknown").trim().toUpperCase();
      const bank    = (r.bankName||"Unknown").trim().toUpperCase();
      const today   = now.toISOString().slice(0,10);
      const fyStart = now.getMonth()>=3 ? now.getFullYear() : now.getFullYear()-1;
      const fy      = `${fyStart}-${fyStart+1}`;
      setItrData(prev=>{
        const d = JSON.parse(JSON.stringify(prev));
        if(!d[fy]) d[fy]={};
        if(!d[fy][person]) d[fy][person]={};
        if(!d[fy][person][bank]) d[fy][person][bank]={payments:[]};
        d[fy][person][bank].payments.push({amount:paid,date:today,card:r.lastFourDigits||"",addedAt:now.toISOString()});
        try{localStorage.setItem("cc_itr_v1",JSON.stringify(d));}catch{}
        return d;
      });
    }
  };



  // Manual upload
  const addFiles=(newFiles)=>{
    const arr=Array.from(newFiles).filter(f=>f.type==="application/pdf"||f.type.startsWith("image/"));
    setFiles(prev=>{const ex=new Set(prev.map(f=>f.name));return[...prev,...arr.filter(f=>!ex.has(f.name)).map(f=>({file:f,status:"pending",result:null,error:null,id:`${f.name}-${Date.now()}`}))];});
  };
  const requestPassword=(item)=>new Promise((res,rej)=>setPwdModal({item,resolve:res,reject:rej}));
  const processAll=async()=>{
    if(processingRef.current)return; processingRef.current=true; setProcessing(true);
    const pending=files.filter(f=>f.status==="pending"||f.status==="needs-password");
    for(const item of pending){
      setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"processing"}:f));
      try{
        let imgBase64;
        if(item.file.type==="application/pdf"){
          const bytes=new Uint8Array(await item.file.arrayBuffer());
          const pwdList=resolvePasswords(vault,people,bankRules,item.file.name,"","","","",null,"");
          try{const{imgBase64:img}=await tryPasswordsOnPDF(bytes,pwdList);imgBase64=img;}
          catch(e){
            if(e.message==="WRONG_PASSWORD"){
              setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"needs-password"}:f));
              let pwd;try{pwd=await requestPassword(item);}catch{setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"skipped"}:f));setPwdModal(null);continue;}
              setPwdModal(null);setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"processing"}:f));
              try{imgBase64=await pdfBytesToBase64Image(bytes,pwd);}
              catch(e2){throw new Error(e2.message==="WRONG_PASSWORD"?"Incorrect password":e2.message);}
            }else throw e;
          }
        }else{imgBase64=await fileToBase64(item.file);}
        const result=await callGroq(settings.geminiKey,imgBase64,item.file.type==="application/pdf"?"image/jpeg":item.file.type);
        // Clean extracted data
        if(result.lastFourDigits){ const d=(result.lastFourDigits+"").replace(/[^0-9]/g,""); result.lastFourDigits=d.length>=4?d.slice(-4):(d||null); }
        if(result.cardholderName) result.cardholderName=result.cardholderName.replace(/^(MR\.?\s+|MRS\.?\s+|MS\.?\s+|DR\.?\s+)/i,"").trim();
        if(result.dueAmount&&result.dueAmount>1000000) result.dueAmount=Math.round(result.dueAmount/100*100)/100;
        result.fileName=item.file.name;result.receivedOn=new Date().toLocaleDateString("en-GB");result.source="manual";result.paid=false;result.id=item.id;
        setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"done",result}:f));
        setRecords(prev=>{const ex=prev.find(r=>r.id===item.id);return ex?prev.map(r=>r.id===item.id?result:r):[...prev,result];});
      }catch(err){setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"error",error:err.message}:f));}
    }
    processingRef.current=false;setProcessing(false);
  };

  const pendingCount=files.filter(f=>f.status==="pending"||f.status==="needs-password").length;
  const unpaidRecs=records.filter(r=>!r.paid);
  const unpaidTotal=unpaidRecs.reduce((s,r)=>s+(r.dueAmount||0),0);
  const currency=records.find(r=>r.currency)?.currency||"";
  const TABS=[["gmail","⚡ Gmail Sync"],["upload","📂 Upload"],["tracker",`📋 Tracker (${records.length})`],["people",`👥 People (${people.length})`],["vault",`🔐 Vault (${vault.length})`],["bankrules",`🏦 Bank Rules (${bankRules.length})`],["itr","💰 ITR Tracker"],["settings","⚙ Settings"]];

  return(
    <>
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    <div style={{minHeight:"100vh",background:"#080c14",paddingBottom:48}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;background:#080c14;}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px;}
        .abtn:hover:not(:disabled){opacity:.82;}.abtn:disabled{opacity:.35;cursor:not-allowed;}
        input::placeholder{color:#334155;}input:focus{border-color:#3b82f6!important;}
        .row-h:hover{background:#0d1829!important;}.drop-z:hover{border-color:#3b82f6!important;background:#0d1424!important;}
        @media(max-width:640px){.tabs-sc{overflow-x:auto;-webkit-overflow-scrolling:touch;}.tbl-sc{overflow-x:auto;-webkit-overflow-scrolling:touch;}}
      `}</style>

      {pwdModal&&<PasswordModal file={pwdModal.item.file} onSubmit={(pwd,setErr)=>{if(!pwd.trim()){setErr("Enter password");return;}pwdModal.resolve(pwd);}} onSkip={()=>pwdModal.reject("skipped")}/>}

      {/* Top Bar */}
      <div style={{background:"#0a0e1a",borderBottom:"1px solid #1e293b",padding:"12px 20px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>💳</div>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15}}>CC Statement Tracker</div>
              <div style={{color:user?"#14532d":"#1e3a5f",fontSize:9,letterSpacing:"0.06em"}}>{user?`☁ ${user.email}`:"⚡ GROQ FREE · GMAIL SYNC"}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            {/* Firebase auth button */}
            {settings.firebaseConfig&&(
              user
                ?<button onClick={handleFirebaseSignOut} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:7,padding:"5px 12px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>Sign Out</button>
                :<button onClick={handleFirebaseSignIn} disabled={syncing} style={{...S.btn("#1d4ed8",syncing),padding:"6px 14px",fontSize:10,display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:700}}>G</span>{syncing?"…":"Sign in to Sync"}</button>
            )}
            {records.length>0&&(
              <div style={{textAlign:"right"}}>
                <div style={{color:"#334155",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em"}}>Pending ({unpaidRecs.length})</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,color:unpaidRecs.length>0?"#f87171":"#4ade80"}}>{currency} {unpaidTotal.toLocaleString("en-IN",{minimumFractionDigits:2})}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"22px 16px"}}>

        {/* Firebase sign-in banner if not signed in */}
        {settings.firebaseConfig&&!user&&(
          <div style={{background:"#1e3a5f22",border:"1px solid #1e3a5f",borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:12,color:"#60a5fa"}}>☁ <strong>Sign in with Google</strong> to sync vault & records across all your devices</div>
            <button onClick={handleFirebaseSignIn} disabled={syncing} style={{...S.btn("#1d4ed8",syncing),padding:"7px 16px",fontSize:11}}>Sign in →</button>
          </div>
        )}

        {/* Tabs */}
        <div className="tabs-sc" style={{marginBottom:22}}>
          <div style={{display:"flex",gap:3,background:"#0d1424",borderRadius:10,padding:4,width:"max-content",minWidth:"100%"}}>
            {TABS.map(([t,label])=>(
              <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"#1e40af":"none",color:activeTab===t?"#fff":"#475569",border:"none",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,whiteSpace:"nowrap",transition:"all .15s"}}>{label}</button>
            ))}
          </div>
        </div>

        {/* Gmail Sync */}
        {activeTab==="gmail"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Gmail Auto-Sync</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Auto-finds CC emails, matches vault passwords, extracts data.</p><GmailSyncPanel settings={settings} vault={vault} people={people} bankRules={bankRules} uid={user?.uid} onNewRecords={handleNewRecords} processedIds={processedIds} onProcessed={handleProcessed} onResetProcessed={()=>setProcessedIds([])}/></div>}

        {/* Manual Upload */}
        {activeTab==="upload"&&(
          <div>
            <div className="drop-z" style={{border:`2px dashed ${dragging?"#3b82f6":"#1e293b"}`,borderRadius:12,padding:"28px 20px",textAlign:"center",marginBottom:16,background:"#0a0e1a",cursor:"pointer",transition:"all .2s"}} onClick={()=>inputRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}>
              <input ref={inputRef} type="file" multiple hidden accept=".pdf,image/*" onChange={e=>addFiles(e.target.files)}/>
              <div style={{fontSize:24,marginBottom:8}}>📂</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:4}}>Tap to select statements</div>
              <div style={{color:"#334155",fontSize:11}}>PDF (incl. password protected) · PNG · JPG</div>
            </div>
            {files.length>0&&(<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:11,color:"#475569"}}>{files.length} files · {files.filter(f=>f.status==="done").length} done</span><button onClick={()=>setFiles([])} style={{background:"none",border:"1px solid #1e293b",color:"#475569",padding:"3px 10px",borderRadius:6,cursor:"pointer",fontSize:10}}>Clear</button></div>
              <div style={{border:"1px solid #1e293b",borderRadius:10,overflow:"hidden",marginBottom:14}}>
                {files.map((item,idx)=>(
                  <div key={item.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderBottom:idx<files.length-1?"1px solid #0f1929":"none",background:"#0a0e1a",fontSize:11}}>
                    <span style={{color:item.file.type==="application/pdf"?"#f97316":"#8b5cf6",minWidth:26,fontSize:9,fontWeight:700}}>{item.file.type==="application/pdf"?"PDF":"IMG"}</span>
                    <span style={{flex:1,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.file.name}</span>
                    <Badge status={item.status}/>
                    {item.status==="error"&&<span title={item.error} style={{color:"#f87171",fontSize:9,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis"}}>{item.error}</span>}
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button className="abtn" onClick={processAll} disabled={processing||pendingCount===0} style={S.btn("#1d4ed8",processing||pendingCount===0)}>{processing?"⟳ Extracting…":`⚡ Extract (${pendingCount})`}</button>
                {records.length>0&&<button className="abtn" onClick={()=>exportToExcel(records)} style={S.btn("#15803d")}>⬇ Excel ({records.length})</button>}
              </div>
            </>)}
          </div>
        )}

        {/* Tracker */}
        {activeTab==="tracker"&&(
          records.length===0?(
            <div style={{textAlign:"center",color:"#1e293b",padding:"48px 0",fontSize:12}}><div style={{fontSize:36,marginBottom:10,opacity:.3}}>📋</div>No statements yet.</div>
          ):(
            <>
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,gap:10,flexWrap:"wrap"}}>
                <button className="abtn" onClick={()=>exportToExcel(records)} style={S.btn("#15803d")}>⬇ Export Excel</button>
                <button className="abtn" onClick={()=>{if(window.confirm("Clear ALL records?")) setRecords([]);}} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",padding:"10px 14px",borderRadius:8,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>🗑 Clear All</button>
                <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto"}}>
                  <span style={{color:"#334155",fontSize:10}}>Auto-delete after:</span>
                  {[30,60,90,180].map(d=>(
                    <button key={d} onClick={()=>handleRetentionChange(d)} style={{background:(settings?.retentionDays||60)===d?"#1e3a5f":"none",border:`1px solid ${(settings?.retentionDays||60)===d?"#3b82f6":"#1e293b"}`,color:(settings?.retentionDays||60)===d?"#60a5fa":"#334155",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>{d}d</button>
                  ))}
                </div>
              </div>
              {/* Urgent due date alerts */}
              {(()=>{
                const urgent=sortedRecords.filter(r=>!r.paid&&(()=>{const d=daysUntil(r.dueDate);return d!==null&&d<=3;})());
                if(!urgent.length) return null;
                return <div style={{marginBottom:12}}>
                  {urgent.map(r=>{const s=getDueStatus(r);return(
                    <div key={r.id} style={{background:s.bg,border:`1px solid ${s.color}44`,borderRadius:8,padding:"10px 14px",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",animation:s.blink?"pulse 1s infinite":"none"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:16}}>{s.label.includes("GRACE")?"⚠️":s.label.includes("TODAY")?"🚨":"🔴"}</span>
                        <div>
                          <span style={{color:"#fff",fontWeight:700,fontSize:12}}>{r.cardholderName||"?"} · {r.bankName||"?"} ••••{r.lastFourDigits||"?"}</span>
                          <span style={{color:s.color,fontSize:11,marginLeft:8}}>{s.label}</span>
                          {s.label.includes("GRACE")&&<span style={{color:"#fca5a5",fontSize:10,marginLeft:6}}>— Pay now to avoid late fee!</span>}
                        </div>
                      </div>
                      <span style={{color:"#fff",fontWeight:700,fontSize:13}}>{r.currency||""} {Number(r.dueAmount).toLocaleString("en-IN",{minimumFractionDigits:2})}</span>
                    </div>
                  );})}
                </div>;
              })()}
              <div className="tbl-sc" style={{border:"1px solid #1e293b",borderRadius:10}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:640}}>
                  <thead><tr style={{background:"#0d1424"}}>{["#","Cardholder","Bank","Card","Due Date","Amount","Paid","Balance","Src","Status",""].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",color:"#334155",fontWeight:500,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:"1px solid #1e293b",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {sortedRecords.map((r,i)=>(
                      <tr key={r.firestoreId||r.id} className="row-h" style={{background:r.paid?"#071a0f":"#0a0e1a",opacity:r.paid?.6:1}}>
                        <td style={{padding:"9px 10px",color:"#334155"}}>{i+1}</td>
                        <td style={{padding:"6px 10px",color:"#e2e8f0",fontWeight:500,whiteSpace:"nowrap"}} onClick={()=>startEdit(r.id,"cardholderName",r.cardholderName)}>
                          {editCell?.id===r.id&&editCell.field==="cardholderName"
                            ?<input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={()=>commitEdit(r)} onKeyDown={e=>e.key==="Enter"&&commitEdit(r)} style={{background:"#1e293b",border:"1px solid #3b82f6",borderRadius:4,color:"#fff",padding:"2px 6px",fontFamily:"'DM Mono',monospace",fontSize:11,width:120}}/>
                            :<span style={{cursor:"text",borderBottom:"1px dashed #1e293b"}}>{r.cardholderName||<span style={{color:"#334155"}}>— click to edit</span>}</span>}
                        </td>
                        <td style={{padding:"6px 10px",color:"#94a3b8",whiteSpace:"nowrap"}} onClick={()=>startEdit(r.id,"bankName",r.bankName)}>
                          {editCell?.id===r.id&&editCell.field==="bankName"
                            ?<input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={()=>commitEdit(r)} onKeyDown={e=>e.key==="Enter"&&commitEdit(r)} style={{background:"#1e293b",border:"1px solid #3b82f6",borderRadius:4,color:"#fff",padding:"2px 6px",fontFamily:"'DM Mono',monospace",fontSize:11,width:100}}/>
                            :<span style={{cursor:"text",borderBottom:"1px dashed #1e293b"}}>{r.bankName||"—"}</span>}
                        </td>
                        <td style={{padding:"9px 10px"}}>{r.lastFourDigits?<span style={{background:"#1e293b",padding:"2px 6px",borderRadius:4,color:"#60a5fa",fontWeight:600}}>••••{r.lastFourDigits}</span>:"—"}</td>
                        <td style={{padding:"6px 10px",whiteSpace:"nowrap"}} onClick={()=>!r.paid&&startEdit(r.id,"dueDate",r.dueDate)}>
                          {editCell?.id===r.id&&editCell.field==="dueDate"
                            ?<input autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={()=>commitEdit(r)} onKeyDown={e=>e.key==="Enter"&&commitEdit(r)} placeholder="DD/MM/YYYY" style={{background:"#1e293b",border:"1px solid #3b82f6",borderRadius:4,color:"#fbbf24",padding:"2px 6px",fontFamily:"'DM Mono',monospace",fontSize:11,width:95}}/>
                            :(()=>{const s=getDueStatus(r);return <span style={{color:r.paid?"#64748b":s.urgent?"#fff":"#fbbf24",fontWeight:500,cursor:r.paid?"default":"text",borderBottom:r.paid?"none":"1px dashed #1e293b"}}>{r.dueDate||"—"}</span>;})()}
                        </td>
                        <td style={{padding:"9px 10px",color:r.paid?"#64748b":"#f87171",fontWeight:700,whiteSpace:"nowrap"}}>{ (r.originalAmount??r.dueAmount)!=null?`${r.currency||""} ${Number(r.originalAmount??r.dueAmount).toLocaleString("en-IN",{minimumFractionDigits:2})}`:"—"}</td>
                        <td style={{padding:"9px 6px"}}><input type="number" placeholder="pay" min="0" style={{width:65,background:"#0d1424",border:"1px solid #1e293b",borderRadius:4,color:"#94a3b8",padding:"2px 5px",fontFamily:"'DM Mono',monospace",fontSize:10}} onKeyDown={e=>{if(e.key==="Enter"&&e.target.value){handlePartialPayment(r,e.target.value);e.target.value="";}}} title="Type amount paid, press Enter"/></td>
                        <td style={{padding:"9px 10px",whiteSpace:"nowrap"}}>
                          <div>
                            <span style={{color:r.paid?"#4ade80":r.dueAmount<(r.originalAmount??r.dueAmount)?"#fb923c":"#f87171",fontWeight:700}}>
                              {r.dueAmount!=null?`${r.currency||""} ${Number(r.dueAmount).toLocaleString("en-IN",{minimumFractionDigits:2})}`:"—"}
                            </span>
                            {r.paymentHistory?.length>0&&(
                              <details style={{fontSize:9}}>
                                <summary style={{cursor:"pointer",color:"#3b82f6",listStyle:"none",marginTop:2}}>📋 {r.paymentHistory.length} payment{r.paymentHistory.length>1?"s":""}</summary>
                                <div style={{background:"#080c14",border:"1px solid #1e293b",borderRadius:6,padding:"8px",marginTop:4,minWidth:220,position:"absolute",zIndex:99}}>
                                  <div style={{color:"#60a5fa",fontSize:9,fontWeight:600,marginBottom:6}}>PAYMENT HISTORY</div>
                                  {r.paymentHistory.map((p,i)=>(
                                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #0f1929",gap:8}}>
                                      <span style={{color:"#475569",fontSize:9}}>{p.date} {p.time}</span>
                                      <span style={{color:p.amount<0?"#f97316":"#4ade80",fontWeight:600,fontSize:10,fontFamily:"'DM Mono',monospace"}}>{p.amount<0?"−":"+"}{r.currency||""} {Math.abs(p.amount).toLocaleString("en-IN",{minimumFractionDigits:2})}{p.note?` (${p.note})`:""}</span>
                                    </div>
                                  ))}
                                  <div style={{display:"flex",justifyContent:"space-between",marginTop:6,paddingTop:4,borderTop:"1px solid #1e293b"}}>
                                    <span style={{color:"#475569",fontSize:9}}>Net paid</span>
                                    <span style={{color:"#4ade80",fontWeight:700,fontSize:10}}>{r.currency||""} {Number(r.paidAmount||0).toLocaleString("en-IN",{minimumFractionDigits:2})}</span>
                                  </div>
                                </div>
                              </details>
                            )}
                          </div>
                        </td>
                        <td style={{padding:"9px 10px"}}><span style={{fontSize:9,color:r.source==="gmail"?"#60a5fa":"#334155"}}>{r.source==="gmail"?"📧":"📂"}</span></td>
                        <td style={{padding:"9px 10px"}}>{(()=>{const s=getDueStatus(r);return(<button onClick={()=>handleTogglePaid(r)} style={{background:s.bg,color:s.color,border:"none",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,whiteSpace:"nowrap",animation:s.blink?"pulse 1.5s infinite":""}}>{s.label}</button>);})()}</td>
                        <td style={{padding:"9px 10px"}}><button onClick={()=>handleDeleteRecord(r)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:8,color:"#1e3a5f",fontSize:10,textAlign:"right"}}>{user?"☁ Synced to Firebase":"💾 Local only — sign in to sync"}</div>
            </>
          )
        )}

        {/* People */}
        {activeTab==="people"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>👥 Cardholder Registry</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Add cardholder details once — app auto-generates all PDF password combinations.</p><PeoplePanel people={people} uid={user?.uid} onAdd={handleAddPerson} onUpdate={handleUpdatePerson} onDelete={handleDeletePerson}/></div>}

        {/* Vault */}
        {activeTab==="vault"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Password Vault</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Passwords matched by bank + card number. Auto-used during sync.</p><VaultPanel vault={vault} uid={user?.uid} onAdd={handleAddVault} onUpdate={handleUpdateVault} onDelete={handleDeleteVault}/></div>}

        {/* Settings */}
        {activeTab==="itr"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>💰 ITR Repayment Tracker</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Track credit card repayments per person per bank. Banks report ≥₹10L to IT dept.</p><ITRPanel itrData={itrData} setItrData={setItrData}/></div>}

        {activeTab==="bankrules"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>🏦 Bank Password Rules</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Define exact password formula per bank. App tries only these — no more 80-attempt guessing.</p><BankRulesPanel rules={bankRules} onUpdate={setBankRules}/></div>}

        {activeTab==="settings"&&<div style={{...S.card,padding:"24px"}}>
          <h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Settings</h2>
          <p style={{color:"#334155",fontSize:11,marginBottom:20}}>Update API keys or reset all data.</p>
          <SettingsPanel settings={settings} onUpdate={setSettings} onReset={()=>{if(window.confirm("Reset ALL data?")){ls.del(SETTINGS_KEY);ls.del("cc_gmail_token");ls.del("cc_gmail_email");window.location.reload();}}}/>
          {user&&<div style={{marginTop:24,paddingTop:20,borderTop:"1px solid #0f172a"}}>
            <div style={{color:"#475569",fontSize:11,marginBottom:12}}>🔥 Firebase Debug</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={async()=>{
                const ok=await saveVault(user.uid,vault);
                const ok2=await savePeople(user.uid,people);
                alert(ok&&ok2?`✅ Saved! Vault: ${vault.length}, People: ${people.length}`:`❌ Save failed — check Firestore rules`);
              }} style={{...S.btn("#1d4ed8"),fontSize:11,padding:"8px 14px"}}>Force Save to Firebase</button>
              <button onClick={async()=>{
                const [v,p,r]=await Promise.all([loadVault(user.uid),loadPeople(user.uid),loadRecords(user.uid)]);
                alert(`Firebase has:\nVault: ${v.length} entries\nPeople: ${p.length} entries\nRecords: ${r.length} entries`);
              }} style={{...S.btn("#475569"),fontSize:11,padding:"8px 14px",background:"none",border:"1px solid #1e293b",color:"#475569"}}>Check Firebase Data</button>
            </div>
            <div style={{color:"#1e3a5f",fontSize:10,marginTop:8}}>Open browser console (F12) to see detailed Firebase logs</div>
          </div>}
        </div>}
      </div>
    </div>
  </>
  );
}

