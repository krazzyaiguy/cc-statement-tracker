import { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GEMINI_MODEL  = "gemini-1.5-flash";
const RECORDS_KEY   = "cc_records_v3";
const VAULT_KEY     = "cc_vault_v2";          // upgraded schema
const SETTINGS_KEY  = "cc_settings_v1";
const PROCESSED_KEY = "cc_processed_ids";
const GMAIL_SCOPES  = "https://www.googleapis.com/auth/gmail.readonly";

// Vault entry shape: { id, bankName, last4, cardholderName, password }
// last4 = "" means "all cards from this bank"

const EXTRACTION_PROMPT = `You are a credit card statement parser. Extract key billing information.
Return ONLY valid JSON, no markdown, no explanation:
{
  "cardholderName": "string or null",
  "bankName": "string or null",
  "lastFourDigits": "string (4 digits) or null",
  "statementDate": "DD/MM/YYYY or null",
  "dueDate": "DD/MM/YYYY or null",
  "dueAmount": number or null,
  "currency": "string e.g. INR or null"
}
Rules: lastFourDigits = only last 4 digits. Dates in DD/MM/YYYY. dueAmount = number only. null if not found.`;

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const ls = {
  get: (k, fb=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── VAULT HELPERS ────────────────────────────────────────────────────────────
// Returns passwords to try (most-specific first) given bank + last4 hints from email
function resolvePasswords(vault, bankHint, last4Hint) {
  if (!vault || vault.length === 0) return [];
  const bank = (bankHint||"").toLowerCase();
  const last4 = (last4Hint||"").trim();
  const results = [];

  // Priority 1: exact bank + exact card match
  if (bank && last4) {
    vault.filter(e => e.bankName.toLowerCase().includes(bank) && e.last4 === last4)
         .forEach(e => results.push({ pwd: e.password, label: `${e.bankName} ••••${e.last4}` }));
  }
  // Priority 2: bank match, no card specified (wildcard entries)
  if (bank) {
    vault.filter(e => e.bankName.toLowerCase().includes(bank) && !e.last4)
         .forEach(e => { if (!results.find(r=>r.pwd===e.password)) results.push({ pwd: e.password, label: `${e.bankName} (all cards)` }); });
  }
  // Priority 3: all other entries for this bank (different card numbers)
  if (bank) {
    vault.filter(e => e.bankName.toLowerCase().includes(bank) && e.last4 && e.last4 !== last4)
         .forEach(e => { if (!results.find(r=>r.pwd===e.password)) results.push({ pwd: e.password, label: `${e.bankName} ••••${e.last4}` }); });
  }
  // Priority 4: all vault entries (last resort)
  vault.forEach(e => { if (!results.find(r=>r.pwd===e.password)) results.push({ pwd: e.password, label: `${e.bankName}${e.last4?" ••••"+e.last4:""}` }); });

  return results;
}

// Extract last 4 digits and bank name hint from email subject/body text
function extractHintsFromEmail(subject, bodyText) {
  const text = (subject + " " + (bodyText||"")).toLowerCase();
  // Last 4 digits: "ending 1234", "xxxx1234", "card 1234", "no. 1234"
  const last4Match = text.match(/(?:ending|xxxx|card\s*(?:no\.?|number)?|last\s*4\s*(?:digits?)?)\s*:?\s*(\d{4})/i)
                  || text.match(/\b(\d{4})\b(?=\s*(?:credit|debit|card)|\s*$)/i);
  const last4 = last4Match?.[1] || null;

  // Bank name hints
  const banks = ["hdfc","icici","sbi","axis","kotak","citibank","citi","amex","american express","indusind","yes bank","rbl","idfc","hsbc","sc ","standard chartered","bnp","pnb","union","canara","bob","federal"];
  const bankFound = banks.find(b => text.includes(b)) || null;

  return { last4, bank: bankFound };
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
async function getPDFLib() {
  if (window._pdfjsLib) return window._pdfjsLib;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  window._pdfjsLib = window.pdfjsLib;
  return window._pdfjsLib;
}

async function pdfBytesToBase64Image(bytes, password = "") {
  const pdfjsLib = await getPDFLib();
  const loadingTask = pdfjsLib.getDocument({ data: bytes, password });
  let pdf;
  try { pdf = await loadingTask.promise; }
  catch (err) { if (err.name==="PasswordException") throw new Error("WRONG_PASSWORD"); throw err; }
  const pages = []; let totalH=0, maxW=0;
  for (let i=1; i<=Math.min(pdf.numPages,4); i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale:1.5 });
    const canvas = document.createElement("canvas");
    canvas.width=vp.width; canvas.height=vp.height;
    await page.render({ canvasContext:canvas.getContext("2d"), viewport:vp }).promise;
    pages.push(canvas); totalH+=vp.height; maxW=Math.max(maxW,vp.width);
  }
  const merged = document.createElement("canvas");
  merged.width=maxW; merged.height=totalH;
  const ctx=merged.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,maxW,totalH);
  let y=0; for (const c of pages) { ctx.drawImage(c,0,y); y+=c.height; }
  return merged.toDataURL("image/jpeg",0.85).split(",")[1];
}

// Try a list of passwords in order, return {imgBase64, usedLabel} or throw
async function tryPasswordsOnPDF(bytes, passwordList) {
  // Always try empty password first
  try { return { imgBase64: await pdfBytesToBase64Image(bytes,""), usedLabel:"no password" }; }
  catch(e) { if (e.message!=="WRONG_PASSWORD") throw e; }
  for (const { pwd, label } of passwordList) {
    try { return { imgBase64: await pdfBytesToBase64Image(bytes, pwd), usedLabel: label }; }
    catch(e) { if (e.message!=="WRONG_PASSWORD") throw e; }
  }
  throw new Error("WRONG_PASSWORD");
}

async function fileToBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
}

// ─── GEMINI ───────────────────────────────────────────────────────────────────
async function callGemini(apiKey, base64, mimeType="image/jpeg") {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:EXTRACTION_PROMPT},{inlineData:{mimeType,data:base64}}]}],generationConfig:{temperature:0.1,maxOutputTokens:1000}})});
  const data=await res.json();
  if (data.error) throw new Error(data.error.message);
  const text=data.candidates?.[0]?.content?.parts?.[0]?.text||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

// ─── GMAIL ────────────────────────────────────────────────────────────────────
async function gmailFetch(path, token) {
  const res=await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`,{headers:{Authorization:`Bearer ${token}`}});
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}
async function fetchStatementEmails(token) {
  const q=encodeURIComponent('has:attachment filename:pdf (subject:statement OR subject:e-statement OR subject:"credit card" OR subject:"account statement")');
  const d=await gmailFetch(`users/me/messages?q=${q}&maxResults=50`,token);
  return d.messages||[];
}
async function fetchEmailWithAttachments(messageId, token) {
  const msg=await gmailFetch(`users/me/messages/${messageId}?format=full`,token);
  const hdr=(name)=>msg.payload?.headers?.find(h=>h.name===name)?.value||"";
  const pdfParts=[]; let bodyText="";
  function collect(parts) {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType==="text/plain"&&p.body?.data) { try { bodyText+=atob(p.body.data.replace(/-/g,"+").replace(/_/g,"/")); } catch {} }
      if (p.mimeType==="application/pdf"||(p.filename&&p.filename.toLowerCase().endsWith(".pdf"))) pdfParts.push(p);
      if (p.parts) collect(p.parts);
    }
  }
  collect(msg.payload?.parts);
  return { messageId, subject:hdr("Subject"), from:hdr("From"), date:hdr("Date"), pdfParts, bodyText };
}
async function downloadAttachment(msgId, attId, token) {
  const d=await gmailFetch(`users/me/messages/${msgId}/attachments/${attId}`,token);
  return d.data.replace(/-/g,"+").replace(/_/g,"/");
}

// ─── EXCEL ────────────────────────────────────────────────────────────────────
function exportToExcel(records) {
  const headers=["#","Cardholder","Bank","Last 4","Statement Date","Due Date","Amount","Currency","Received","Source","Status"];
  const rows=records.map((r,i)=>[i+1,r.cardholderName||"",r.bankName||"",r.lastFourDigits||"",r.statementDate||"",r.dueDate||"",r.dueAmount??"",r.currency||"",r.receivedOn||"",r.source||"manual",r.paid?"PAID":"PENDING"]);
  const wb=XLSX.utils.book_new(); const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws["!cols"]=[{wch:4},{wch:20},{wch:18},{wch:10},{wch:16},{wch:16},{wch:14},{wch:10},{wch:14},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws,"CC Statements");
  XLSX.writeFile(wb,`CC_Statements_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const S = {
  card: { background:"#0d1424", border:"1px solid #1e293b", borderRadius:12 },
  input: { width:"100%", background:"#0a0e1a", border:"1px solid #1e293b", borderRadius:8, padding:"10px 14px", color:"#e2e8f0", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none" },
  btn: (color="#1d4ed8", disabled=false) => ({ background:disabled?"#1e293b":color, color:disabled?"#475569":"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:disabled?"not-allowed":"pointer", fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:500, opacity:disabled?0.5:1, transition:"opacity 0.15s" }),
  label: { color:"#64748b", fontSize:10, textTransform:"uppercase", letterSpacing:"0.08em", display:"block", marginBottom:6 },
};

// ─── BADGE ────────────────────────────────────────────────────────────────────
function Badge({ status }) {
  const map={pending:["#1e293b","#94a3b8","Pending"],"needs-password":["#2d1b0e","#fb923c","🔒 Locked"],processing:["#1e3a5f","#60a5fa","Extracting…"],done:["#052e16","#4ade80","✓ Done"],error:["#3b1111","#f87171","Error"],skipped:["#1e293b","#475569","Skipped"]};
  const [bg,color,label]=map[status]||map.pending;
  return <span style={{fontSize:10,fontWeight:600,letterSpacing:"0.06em",padding:"2px 9px",borderRadius:20,background:bg,color,textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>;
}

// ─── PASSWORD MODAL ───────────────────────────────────────────────────────────
function PasswordModal({ file, hint, onSubmit, onSkip }) {
  const [pwd,setPwd]=useState(""); const [err,setErr]=useState("");
  const ref=useRef(); useEffect(()=>{setTimeout(()=>ref.current?.focus(),80);},[]);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}}>
      <div style={{...S.card,padding:"28px",maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.7)"}}>
        <div style={{fontSize:28,marginBottom:10}}>🔒</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,marginBottom:6}}>Password Required</div>
        <div style={{color:"#64748b",fontSize:12,marginBottom:4,lineHeight:1.6}}>
          <span style={{color:"#94a3b8"}}>{file.name}</span>
        </div>
        {hint && <div style={{background:"#1e3a5f22",border:"1px solid #1e3a5f",borderRadius:6,padding:"6px 10px",fontSize:11,color:"#60a5fa",marginBottom:12}}>
          💡 Tried all vault passwords for <strong>{hint}</strong> — none worked. Enter manually below.
        </div>}
        {err&&<div style={{background:"#3b1111",color:"#f87171",borderRadius:6,padding:"8px 12px",fontSize:12,marginBottom:12}}>✕ {err}</div>}
        <input ref={ref} type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr("");}}
          onKeyDown={e=>e.key==="Enter"&&onSubmit(pwd,setErr)}
          placeholder="Enter PDF password" style={{...S.input,marginBottom:14}}/>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>onSubmit(pwd,setErr)} style={{...S.btn(),flex:1}}>Unlock & Extract</button>
          <button onClick={onSkip} style={{background:"none",border:"1px solid #1e293b",color:"#64748b",borderRadius:8,padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── VAULT PANEL (upgraded) ───────────────────────────────────────────────────
function VaultPanel({ vault, onUpdate }) {
  const [bankName, setBankName]         = useState("");
  const [last4, setLast4]               = useState("");
  const [cardHolder, setCardHolder]     = useState("");
  const [pwd, setPwd]                   = useState("");
  const [show, setShow]                 = useState({});
  const [editing, setEditing]           = useState(null); // id of entry being edited
  const [editPwd, setEditPwd]           = useState("");

  const add = () => {
    if (!bankName.trim()||!pwd.trim()) return;
    const clean4 = last4.trim().replace(/\D/g,"").slice(-4);
    const entry = {
      id: Date.now().toString(),
      bankName: bankName.trim(),
      last4: clean4,
      cardholderName: cardHolder.trim(),
      password: pwd.trim(),
    };
    onUpdate([...vault, entry]);
    setBankName(""); setLast4(""); setCardHolder(""); setPwd("");
  };

  const remove = (id) => onUpdate(vault.filter(e=>e.id!==id));

  const saveEdit = (id) => {
    if (!editPwd.trim()) return;
    onUpdate(vault.map(e=>e.id===id?{...e,password:editPwd.trim()}:e));
    setEditing(null); setEditPwd("");
  };

  // Group by bank for display
  const grouped = vault.reduce((acc, e) => {
    const k = e.bankName.toUpperCase();
    if (!acc[k]) acc[k]=[];
    acc[k].push(e); return acc;
  }, {});

  return (
    <div>
      <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>
        Save a password for <strong style={{color:"#94a3b8"}}>each card individually</strong> — the app matches by bank name + last 4 digits from the email subject. For cards with the same bank, add separate entries.
      </p>

      {/* Add form */}
      <div style={{...S.card,padding:"16px",marginBottom:20}}>
        <div style={{color:"#60a5fa",fontSize:11,fontWeight:600,marginBottom:12,letterSpacing:"0.05em"}}>+ ADD VAULT ENTRY</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div>
            <label style={S.label}>Bank Name *</label>
            <input value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. HDFC" style={S.input}/>
          </div>
          <div>
            <label style={S.label}>Card Last 4 Digits</label>
            <input value={last4} onChange={e=>setLast4(e.target.value.replace(/\D/g,"").slice(0,4))}
              placeholder="e.g. 1234 (blank = all cards)" maxLength={4}
              style={{...S.input,fontFamily:"'DM Mono',monospace",letterSpacing:"0.2em"}}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div>
            <label style={S.label}>Cardholder Name</label>
            <input value={cardHolder} onChange={e=>setCardHolder(e.target.value)} placeholder="e.g. Raj Sharma (optional)" style={S.input}/>
          </div>
          <div>
            <label style={S.label}>PDF Password *</label>
            <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}
              placeholder="Statement password" style={S.input}/>
          </div>
        </div>
        <button onClick={add} disabled={!bankName.trim()||!pwd.trim()} style={{...S.btn("#1d4ed8",!bankName.trim()||!pwd.trim())}}>+ Add to Vault</button>
        {!last4.trim() && bankName.trim() && (
          <div style={{color:"#475569",fontSize:10,marginTop:8}}>
            💡 Leaving "Last 4" blank = this password applies to <em>all</em> {bankName} cards (useful if all have the same password)
          </div>
        )}
      </div>

      {/* Vault list grouped by bank */}
      {Object.keys(grouped).length === 0 ? (
        <div style={{color:"#1e293b",fontSize:12,textAlign:"center",padding:"24px 0"}}>No passwords saved yet.</div>
      ) : (
        Object.entries(grouped).map(([bankKey, entries]) => (
          <div key={bankKey} style={{marginBottom:14}}>
            <div style={{color:"#334155",fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6,paddingLeft:2}}>
              🏦 {bankKey} · {entries.length} card{entries.length!==1?"s":""}
            </div>
            <div style={{border:"1px solid #1e293b",borderRadius:10,overflow:"hidden"}}>
              {entries.map((e,idx)=>(
                <div key={e.id} style={{background:"#0a0e1a",borderBottom:idx<entries.length-1?"1px solid #0f1929":"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",fontSize:12}}>
                    {/* Card indicator */}
                    <div style={{minWidth:52,textAlign:"center"}}>
                      {e.last4
                        ? <span style={{background:"#1e293b",padding:"3px 8px",borderRadius:6,color:"#60a5fa",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:12}}>••••{e.last4}</span>
                        : <span style={{background:"#1e3a5f33",padding:"3px 8px",borderRadius:6,color:"#475569",fontSize:10}}>ALL</span>}
                    </div>
                    {/* Name */}
                    <div style={{flex:1}}>
                      <div style={{color:"#e2e8f0",fontWeight:500}}>{e.cardholderName||<span style={{color:"#334155",fontStyle:"italic"}}>No name</span>}</div>
                      {e.last4 && <div style={{color:"#334155",fontSize:10}}>Card ••••{e.last4}</div>}
                    </div>
                    {/* Password display / edit */}
                    {editing===e.id ? (
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="password" value={editPwd} onChange={ev=>setEditPwd(ev.target.value)}
                          onKeyDown={ev=>ev.key==="Enter"&&saveEdit(e.id)}
                          placeholder="New password" autoFocus
                          style={{...S.input,width:130,padding:"5px 8px",fontSize:11}}/>
                        <button onClick={()=>saveEdit(e.id)} style={{...S.btn("#15803d"),padding:"5px 10px",fontSize:10}}>Save</button>
                        <button onClick={()=>{setEditing(null);setEditPwd("");}} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>✕</button>
                      </div>
                    ) : (
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{color:"#475569",fontFamily:"'DM Mono',monospace",fontSize:11,minWidth:80,textAlign:"right"}}>
                          {show[e.id] ? e.password : "•".repeat(Math.min(e.password.length,10))}
                        </span>
                        <button onClick={()=>setShow(s=>({...s,[e.id]:!s[e.id]}))} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:12,padding:"0 2px"}}>{show[e.id]?"🙈":"👁"}</button>
                        <button onClick={()=>{setEditing(e.id);setEditPwd(e.password);}} style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:11,padding:"0 2px"}} title="Edit password">✏</button>
                        <button onClick={()=>remove(e.id)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <div style={{color:"#1e3a5f",fontSize:10,marginTop:12,lineHeight:1.7}}>
        🔐 Stored only in your browser · Never sent to any server<br/>
        💡 Matching order: exact card match → bank-wide entry → other cards of same bank → manual prompt
      </div>
    </div>
  );
}

// ─── GMAIL SYNC PANEL ─────────────────────────────────────────────────────────
function GmailSyncPanel({ settings, vault, onNewRecords, processedIds, onProcessed }) {
  const [gmailToken, setGmailToken] = useState(ls.get("cc_gmail_token"));
  const [gmailEmail, setGmailEmail] = useState(ls.get("cc_gmail_email",""));
  const [syncing, setSyncing]       = useState(false);
  const [syncLog, setSyncLog]       = useState([]);
  const [pwdRequest, setPwdRequest] = useState(null); // { filename, hint, resolve, reject }

  const log = (msg, type="info") => setSyncLog(prev=>[...prev.slice(-40),{msg,type,t:new Date().toLocaleTimeString()}]);

  const signIn = () => {
    if (!settings.googleClientId) { alert("Google Client ID not set. Go to ⚙ Settings."); return; }
    const p = new URLSearchParams({ client_id:settings.googleClientId, redirect_uri:window.location.origin+window.location.pathname, response_type:"token", scope:GMAIL_SCOPES, prompt:"consent" });
    window.location.href=`https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };
  const signOut = () => { ls.del("cc_gmail_token"); ls.del("cc_gmail_email"); setGmailToken(null); setGmailEmail(""); setSyncLog([]); };

  useEffect(() => {
    const hash=new URLSearchParams(window.location.hash.replace("#",""));
    const token=hash.get("access_token");
    if (token) {
      ls.set("cc_gmail_token",token); setGmailToken(token);
      window.history.replaceState({},"",window.location.pathname);
      fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:`Bearer ${token}`}})
        .then(r=>r.json()).then(d=>{ls.set("cc_gmail_email",d.email||"");setGmailEmail(d.email||"");});
    }
  },[]);

  const askPassword = (filename, hint) => new Promise((resolve,reject)=>setPwdRequest({filename,hint,resolve,reject}));

  const runSync = async () => {
    if (!gmailToken) return;
    setSyncing(true); setSyncLog([]);
    log("🔍 Searching Gmail for CC statement emails…");
    try {
      const messages = await fetchStatementEmails(gmailToken);
      const fresh = messages.filter(m=>!processedIds.includes(m.id));
      log(`Found ${messages.length} matching emails · ${fresh.length} new`);
      if (fresh.length===0) { log("✅ All caught up — no new statements.","success"); setSyncing(false); return; }

      const newRecords=[];
      for (const { id } of fresh) {
        try {
          const { subject, from, date, pdfParts, bodyText } = await fetchEmailWithAttachments(id, gmailToken);
          log(`📧 "${subject}"`);
          if (pdfParts.length===0) { log("  ↳ No PDF attached, skipping.","warn"); onProcessed(id); continue; }

          // Extract hints from email
          const { last4: emailLast4, bank: emailBank } = extractHintsFromEmail(subject, bodyText);
          if (emailLast4) log(`  ↳ Detected card ••••${emailLast4} from email`);

          for (const part of pdfParts) {
            const fname = part.filename||"attachment.pdf";
            log(`  ↳ 📄 ${fname}`);

            let b64raw;
            if (part.body?.attachmentId) { b64raw=await downloadAttachment(id,part.body.attachmentId,gmailToken); }
            else if (part.body?.data)    { b64raw=part.body.data.replace(/-/g,"+").replace(/_/g,"/"); }
            else { log(`  ↳ Cannot download ${fname}`,"error"); continue; }

            const raw=atob(b64raw); const bytes=new Uint8Array(raw.length);
            for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);

            // Build ordered password list from vault
            const pwdList = resolvePasswords(vault, emailBank||subject, emailLast4);
            if (pwdList.length>0) log(`  ↳ 🔐 Trying ${pwdList.length} vault password(s)…`);

            let imgBase64=null;
            try {
              const { imgBase64: img, usedLabel } = await tryPasswordsOnPDF(bytes, pwdList);
              imgBase64=img;
              if (usedLabel!=="no password") log(`  ↳ ✓ Unlocked with vault entry: ${usedLabel}`);
            } catch(e) {
              if (e.message==="WRONG_PASSWORD") {
                const bankHint = emailBank ? emailBank.toUpperCase() : subject.slice(0,30);
                log(`  ↳ 🔒 All vault passwords failed — asking for manual entry`,"warn");
                let manualPwd;
                try { manualPwd = await askPassword(fname, bankHint); }
                catch { log(`  ↳ Skipped ${fname}`,"warn"); continue; }
                setPwdRequest(null);
                try { imgBase64 = await pdfBytesToBase64Image(bytes, manualPwd); }
                catch(e2) { log(`  ↳ Wrong manual password for ${fname}`,"error"); continue; }
              } else throw e;
            }

            log(`  ↳ 🤖 Extracting data with Gemini…`);
            const result = await callGemini(settings.geminiKey, imgBase64);
            result.fileName=fname; result.receivedOn=new Date(date).toLocaleDateString("en-GB");
            result.source="gmail"; result.paid=false; result.id=`gmail-${id}-${fname}`;
            newRecords.push(result);
            log(`  ↳ ✅ ${result.cardholderName||"?"} · ${result.bankName||"?"} ••••${result.lastFourDigits||"?"} · Due ${result.dueAmount||"?"} ${result.currency||""}`, "success");
          }
          onProcessed(id);
        } catch(err) { log(`  ↳ Error: ${err.message}`,"error"); onProcessed(id); }
      }

      if (newRecords.length>0) { onNewRecords(newRecords); log(`\n🎉 Added ${newRecords.length} statement(s) to tracker!`,"success"); }
      else log("No new data extracted.","warn");
    } catch(err) {
      if (err.message.includes("401")) { log("Session expired. Please sign in again.","error"); signOut(); }
      else log(`Sync error: ${err.message}`,"error");
    }
    setSyncing(false);
  };

  return (
    <div>
      {pwdRequest && (
        <PasswordModal
          file={{name:pwdRequest.filename}} hint={pwdRequest.hint}
          onSubmit={(pwd,setErr)=>{ if(!pwd.trim()){setErr("Enter password");return;} pwdRequest.resolve(pwd); }}
          onSkip={()=>{ pwdRequest.reject("skipped"); setPwdRequest(null); }}
        />
      )}

      {!gmailToken ? (
        <div>
          <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>
            Connect Gmail for fully automatic statement processing. The app finds CC statement emails, uses your vault passwords (matched by bank + card number), and extracts all data — zero manual work.
          </p>
          {!settings.googleClientId && (
            <div style={{background:"#2d1b0e",border:"1px solid #92400e",borderRadius:8,padding:"12px 14px",fontSize:12,color:"#fb923c",marginBottom:16,lineHeight:1.7}}>
              ⚠ Google Client ID not set. Go to <strong>⚙ Settings</strong> tab and add it.<br/>
              <span style={{color:"#78350f"}}>See SETUP_GUIDE.md in the downloaded zip.</span>
            </div>
          )}
          <button onClick={signIn} disabled={!settings.googleClientId} style={{...S.btn("#15803d",!settings.googleClientId),display:"flex",alignItems:"center",gap:10,padding:"12px 24px"}}>
            <span style={{fontSize:18,fontWeight:700}}>G</span> Sign in with Google
          </button>
          <div style={{color:"#1e3a5f",fontSize:10,marginTop:10}}>Read-only access · Revoke anytime from Google Account settings</div>
        </div>
      ) : (
        <div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
            <div style={{background:"#052e16",border:"1px solid #14532d",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#4ade80"}}>
              ✓ Connected: <strong>{gmailEmail||"Gmail"}</strong>
            </div>
            <button onClick={signOut} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>Disconnect</button>
          </div>
          <button onClick={runSync} disabled={syncing} style={{...S.btn(syncing?"#1e293b":"#1d4ed8",syncing),marginBottom:16,display:"flex",alignItems:"center",gap:8}}>
            {syncing?"⟳ Syncing Gmail…":"⚡ Sync Gmail Now"}
          </button>
          {syncLog.length>0 && (
            <div style={{background:"#050810",border:"1px solid #0f172a",borderRadius:8,padding:"12px 14px",maxHeight:240,overflowY:"auto",fontFamily:"'DM Mono',monospace",fontSize:11}}>
              {syncLog.map((l,i)=>(
                <div key={i} style={{color:l.type==="error"?"#f87171":l.type==="success"?"#4ade80":l.type==="warn"?"#fb923c":"#475569",lineHeight:1.9}}>
                  <span style={{color:"#1e293b",marginRight:8}}>{l.t}</span>{l.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ onSave }) {
  const [geminiKey,setGeminiKey]=useState(""); const [googleClientId,setGoogleClientId]=useState(""); const [testing,setTesting]=useState(false); const [error,setError]=useState("");
  const handleSave = async () => {
    if (!geminiKey.trim()) { setError("Gemini API key is required."); return; }
    setTesting(true); setError("");
    try {
      const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey.trim()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:"Reply: ok"}]}]})});
      const d=await res.json(); if (d.error) throw new Error(d.error.message);
      onSave({ geminiKey:geminiKey.trim(), googleClientId:googleClientId.trim() });
    } catch(e) { setError("Gemini key invalid: "+e.message); }
    setTesting(false);
  };
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#080c14",padding:24}}>
      <div style={{...S.card,padding:"36px 28px",maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:34,marginBottom:12}}>💳</div>
        <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:6,background:"linear-gradient(90deg,#e2e8f0,#64748b)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>CC Statement Tracker</h1>
        <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:24}}>Set up once. Auto-reads Gmail statements every month using your saved vault passwords.</p>
        <div style={{marginBottom:20}}>
          <label style={S.label}>Gemini API Key <span style={{color:"#4ade80"}}>(Free)</span></label>
          <input type="password" value={geminiKey} onChange={e=>{setGeminiKey(e.target.value);setError("");}} placeholder="AIza..." style={{...S.input,marginBottom:6}}/>
          <div style={{color:"#334155",fontSize:10}}>Get free key → <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>aistudio.google.com/apikey</a></div>
        </div>
        <div style={{marginBottom:24}}>
          <label style={S.label}>Google OAuth Client ID <span style={{color:"#94a3b8"}}>(for Gmail sync)</span></label>
          <input type="text" value={googleClientId} onChange={e=>setGoogleClientId(e.target.value)} placeholder="xxxxxxx.apps.googleusercontent.com" style={{...S.input,marginBottom:6}}/>
          <div style={{color:"#334155",fontSize:10}}>Optional — see SETUP_GUIDE.md. Can add later in ⚙ Settings.</div>
        </div>
        {error&&<div style={{background:"#3b1111",color:"#f87171",borderRadius:6,padding:"8px 12px",fontSize:11,marginBottom:14}}>✕ {error}</div>}
        <button onClick={handleSave} disabled={!geminiKey.trim()||testing} style={{...S.btn(geminiKey.trim()&&!testing?"#15803d":"#1e293b",!geminiKey.trim()||testing),width:"100%",padding:"12px"}}>
          {testing?"⟳ Verifying…":"Save & Continue →"}
        </button>
      </div>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({ settings, onUpdate, onReset }) {
  const [geminiKey,setGeminiKey]=useState(settings.geminiKey||""); const [googleClientId,setGoogleClientId]=useState(settings.googleClientId||""); const [saved,setSaved]=useState(false);
  const save=()=>{ onUpdate({...settings,geminiKey:geminiKey.trim(),googleClientId:googleClientId.trim()}); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  return (
    <div>
      <div style={{marginBottom:20}}><label style={S.label}>Gemini API Key</label><input type="password" value={geminiKey} onChange={e=>setGeminiKey(e.target.value)} style={{...S.input,marginBottom:6}}/><div style={{color:"#334155",fontSize:10}}><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>aistudio.google.com/apikey</a></div></div>
      <div style={{marginBottom:24}}><label style={S.label}>Google OAuth Client ID</label><input type="text" value={googleClientId} onChange={e=>setGoogleClientId(e.target.value)} placeholder="xxxxxxx.apps.googleusercontent.com" style={{...S.input,marginBottom:6}}/><div style={{color:"#334155",fontSize:10}}>See SETUP_GUIDE.md for instructions.</div></div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button onClick={save} style={S.btn("#15803d")}>{saved?"✓ Saved!":"Save Settings"}</button>
        <button onClick={onReset} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",borderRadius:8,padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Reset All Data</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [settings,setSettings]         = useState(()=>ls.get(SETTINGS_KEY));
  const [records,setRecords]           = useState(()=>ls.get(RECORDS_KEY,[]));
  const [vault,setVault]               = useState(()=>{ const v=ls.get(VAULT_KEY,[]); return Array.isArray(v)?v:[]; }); // ensure array
  const [processedIds,setProcessedIds] = useState(()=>ls.get(PROCESSED_KEY,[]));
  const [files,setFiles]               = useState([]);
  const [dragging,setDragging]         = useState(false);
  const [processing,setProcessing]     = useState(false);
  const [pwdModal,setPwdModal]         = useState(null);
  const [activeTab,setActiveTab]       = useState("gmail");
  const inputRef=useRef(); const processingRef=useRef(false);

  useEffect(()=>{ls.set(RECORDS_KEY,records);},[records]);
  useEffect(()=>{ls.set(VAULT_KEY,vault);},[vault]);
  useEffect(()=>{ls.set(PROCESSED_KEY,processedIds);},[processedIds]);
  useEffect(()=>{if(settings)ls.set(SETTINGS_KEY,settings);},[settings]);

  if (!settings) return <SetupScreen onSave={setSettings}/>;

  const addFiles=(newFiles)=>{
    const arr=Array.from(newFiles).filter(f=>f.type==="application/pdf"||f.type.startsWith("image/"));
    setFiles(prev=>{const ex=new Set(prev.map(f=>f.name));return[...prev,...arr.filter(f=>!ex.has(f.name)).map(f=>({file:f,status:"pending",result:null,error:null,id:`${f.name}-${Date.now()}`}))];});
  };

  const requestPassword=(item)=>new Promise((res,rej)=>setPwdModal({item,resolve:res,reject:rej}));

  const processAll=async()=>{
    if(processingRef.current)return; processingRef.current=true; setProcessing(true);
    const pending=files.filter(f=>f.status==="pending"||f.status==="needs-password");
    for (const item of pending) {
      setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"processing"}:f));
      try {
        let imgBase64;
        if (item.file.type==="application/pdf") {
          const bytes=new Uint8Array(await item.file.arrayBuffer());
          // Try vault passwords using filename as hint
          const pwdList=resolvePasswords(vault,item.file.name,"");
          try { const {imgBase64:img}=await tryPasswordsOnPDF(bytes,pwdList); imgBase64=img; }
          catch(e) {
            if (e.message==="WRONG_PASSWORD") {
              setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"needs-password"}:f));
              let pwd; try { pwd=await requestPassword(item); } catch { setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"skipped"}:f)); setPwdModal(null); continue; }
              setPwdModal(null); setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"processing"}:f));
              try { imgBase64=await pdfBytesToBase64Image(bytes,pwd); }
              catch(e2){ throw new Error(e2.message==="WRONG_PASSWORD"?"Incorrect password":e2.message); }
            } else throw e;
          }
        } else { imgBase64=await fileToBase64(item.file); }

        const result=await callGemini(settings.geminiKey,imgBase64,item.file.type==="application/pdf"?"image/jpeg":item.file.type);
        result.fileName=item.file.name; result.receivedOn=new Date().toLocaleDateString("en-GB"); result.source="manual"; result.paid=false; result.id=item.id;
        setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"done",result}:f));
        setRecords(prev=>{const ex=prev.find(r=>r.id===item.id);return ex?prev.map(r=>r.id===item.id?result:r):[...prev,result];});
      } catch(err) { setFiles(prev=>prev.map(f=>f.id===item.id?{...f,status:"error",error:err.message}:f)); }
    }
    processingRef.current=false; setProcessing(false);
  };

  const handleNewRecords=useCallback((newRecs)=>{
    setRecords(prev=>{const ex=new Set(prev.map(r=>r.id));return[...prev,...newRecs.filter(r=>!ex.has(r.id))];});
  },[]);
  const handleProcessed=useCallback((id)=>setProcessedIds(prev=>prev.includes(id)?prev:[...prev,id]),[]);
  const togglePaid=(id)=>setRecords(prev=>prev.map(r=>r.id===id?{...r,paid:!r.paid}:r));
  const deleteRecord=(id)=>setRecords(prev=>prev.filter(r=>r.id!==id));

  const pendingCount=files.filter(f=>f.status==="pending"||f.status==="needs-password").length;
  const unpaidRecs=records.filter(r=>!r.paid);
  const unpaidTotal=unpaidRecs.reduce((s,r)=>s+(r.dueAmount||0),0);
  const currency=records.find(r=>r.currency)?.currency||"";

  const TABS=[["gmail","⚡ Gmail Sync"],["upload","📂 Manual Upload"],["tracker",`📋 Tracker (${records.length})`],["vault",`🔐 Vault (${vault.length})`],["settings","⚙ Settings"]];

  return (
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

      {/* Topbar */}
      <div style={{background:"#0a0e1a",borderBottom:"1px solid #1e293b",padding:"12px 20px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>💳</div>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15}}>CC Statement Tracker</div>
              <div style={{color:"#1e3a5f",fontSize:9,letterSpacing:"0.06em"}}>✨ GEMINI FREE · GMAIL AUTO-SYNC · SMART VAULT</div>
            </div>
          </div>
          {records.length>0&&(
            <div style={{textAlign:"right"}}>
              <div style={{color:"#334155",fontSize:9,textTransform:"uppercase",letterSpacing:"0.06em"}}>Pending ({unpaidRecs.length})</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,color:unpaidRecs.length>0?"#f87171":"#4ade80"}}>{currency} {unpaidTotal.toLocaleString("en-IN",{minimumFractionDigits:2})}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"22px 16px"}}>
        {/* Tabs */}
        <div className="tabs-sc" style={{marginBottom:22}}>
          <div style={{display:"flex",gap:3,background:"#0d1424",borderRadius:10,padding:4,width:"max-content",minWidth:"100%"}}>
            {TABS.map(([t,label])=>(
              <button key={t} onClick={()=>setActiveTab(t)} style={{background:activeTab===t?"#1e40af":"none",color:activeTab===t?"#fff":"#475569",border:"none",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,whiteSpace:"nowrap",transition:"all .15s"}}>{label}</button>
            ))}
          </div>
        </div>

        {activeTab==="gmail"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Gmail Auto-Sync</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Auto-finds CC emails, matches vault passwords by bank + card number, extracts everything.</p><GmailSyncPanel settings={settings} vault={vault} onNewRecords={handleNewRecords} processedIds={processedIds} onProcessed={handleProcessed}/></div>}

        {activeTab==="upload"&&(
          <div>
            <div className="drop-z" style={{border:`2px dashed ${dragging?"#3b82f6":"#1e293b"}`,borderRadius:12,padding:"28px 20px",textAlign:"center",marginBottom:16,background:"#0a0e1a",cursor:"pointer",transition:"all .2s"}} onClick={()=>inputRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}>
              <input ref={inputRef} type="file" multiple hidden accept=".pdf,image/*" onChange={e=>addFiles(e.target.files)}/>
              <div style={{fontSize:24,marginBottom:8}}>📂</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:4}}>Tap to select statements</div>
              <div style={{color:"#334155",fontSize:11}}>PDF (incl. password protected) · PNG · JPG<br/><span style={{color:"#1e3a5f"}}>Vault passwords auto-applied by filename</span></div>
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

        {activeTab==="tracker"&&(
          records.length===0?(
            <div style={{textAlign:"center",color:"#1e293b",padding:"48px 0",fontSize:12}}><div style={{fontSize:36,marginBottom:10,opacity:.3}}>📋</div>No statements yet.</div>
          ):(
            <>
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12,gap:10,flexWrap:"wrap"}}>
                <button className="abtn" onClick={()=>exportToExcel(records)} style={S.btn("#15803d")}>⬇ Export Excel</button>
                <button className="abtn" onClick={()=>{if(window.confirm("Clear ALL records?"))setRecords([]);}} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",padding:"10px 14px",borderRadius:8,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>🗑 Clear All</button>
              </div>
              <div className="tbl-sc" style={{border:"1px solid #1e293b",borderRadius:10}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:640}}>
                  <thead><tr style={{background:"#0d1424"}}>{["#","Cardholder","Bank","Card","Due Date","Amount","Src","Status",""].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",color:"#334155",fontWeight:500,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:"1px solid #1e293b",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {records.map((r,i)=>(
                      <tr key={r.id} className="row-h" style={{background:r.paid?"#071a0f":"#0a0e1a",opacity:r.paid?.6:1}}>
                        <td style={{padding:"9px 10px",color:"#334155"}}>{i+1}</td>
                        <td style={{padding:"9px 10px",color:"#e2e8f0",fontWeight:500,whiteSpace:"nowrap"}}>{r.cardholderName||<span style={{color:"#1e293b"}}>—</span>}</td>
                        <td style={{padding:"9px 10px",color:"#94a3b8",whiteSpace:"nowrap"}}>{r.bankName||"—"}</td>
                        <td style={{padding:"9px 10px"}}>{r.lastFourDigits?<span style={{background:"#1e293b",padding:"2px 6px",borderRadius:4,color:"#60a5fa",fontWeight:600}}>••••{r.lastFourDigits}</span>:"—"}</td>
                        <td style={{padding:"9px 10px",color:r.paid?"#64748b":"#fbbf24",fontWeight:500,whiteSpace:"nowrap"}}>{r.dueDate||"—"}</td>
                        <td style={{padding:"9px 10px",color:r.paid?"#4ade80":"#f87171",fontWeight:700,whiteSpace:"nowrap"}}>{r.dueAmount!=null?`${r.currency||""} ${Number(r.dueAmount).toLocaleString("en-IN",{minimumFractionDigits:2})}`:"—"}</td>
                        <td style={{padding:"9px 10px"}}><span style={{fontSize:9,color:r.source==="gmail"?"#60a5fa":"#334155"}}>{r.source==="gmail"?"📧":"📂"}</span></td>
                        <td style={{padding:"9px 10px"}}><button onClick={()=>togglePaid(r.id)} style={{background:r.paid?"#052e16":"#1e293b",color:r.paid?"#4ade80":"#94a3b8",border:"none",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>{r.paid?"✓ PAID":"PENDING"}</button></td>
                        <td style={{padding:"9px 10px"}}><button onClick={()=>deleteRecord(r.id)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{marginTop:8,color:"#1e3a5f",fontSize:10,textAlign:"right"}}>📧 = Gmail · 📂 = Manual</div>
            </>
          )
        )}

        {activeTab==="vault"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Password Vault</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Passwords matched by bank name + last 4 digits. Multiple cards per bank supported.</p><VaultPanel vault={vault} onUpdate={setVault}/></div>}

        {activeTab==="settings"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Settings</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Update API keys or reset all data.</p><SettingsPanel settings={settings} onUpdate={setSettings} onReset={()=>{if(window.confirm("Reset ALL data?")){ [RECORDS_KEY,VAULT_KEY,SETTINGS_KEY,PROCESSED_KEY,"cc_gmail_token","cc_gmail_email"].forEach(k=>ls.del(k)); window.location.reload();}}}/></div>}
      </div>
    </div>
  );
}
