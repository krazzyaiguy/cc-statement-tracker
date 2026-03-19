import { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  initFirebase, signInWithGoogle, signOutUser, onAuthChange,
  loadVault, saveVault,
  loadPeople, savePeople,
  loadRecords, saveRecords,
  loadMeta, saveMeta,
} from "./firebase";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const AI_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // Groq — free, no card needed
const SETTINGS_KEY   = "cc_settings_v2";   // localStorage fallback for settings only
const GMAIL_SCOPES   = "https://www.googleapis.com/auth/gmail.readonly";

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

// ─── LOCAL STORAGE (settings only) ───────────────────────────────────────────
const ls = {
  get: (k, fb=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── AUTO PASSWORD GENERATOR ─────────────────────────────────────────────────
// Person shape: { id, fullName, dob:"DD/MM/YYYY", cards:[{last4,bankName}] }

function generatePasswords(person, last4Hint) {
  const passwords = [];
  if (!person) return passwords;
  const name = (person.fullName||"").toUpperCase().replace(/[^A-Z]/g,"");
  const dob  = person.dob||"";
  // Support both DD/MM/YYYY and DD-MM-YYYY formats
  const parts = dob.includes("/")?dob.split("/"):dob.includes("-")?dob.split("-"):dob.split("/");
  const dd = (parts[0]||"").padStart(2,"0"), mm = (parts[1]||"").padStart(2,"0"), yyyy = parts[2]||"";
  console.log("[GenPwd]", person.fullName, "dob:", dob, "→ dd:", dd, "mm:", mm, "yyyy:", yyyy, "name:", name);
  const namePrefixes = [name.slice(0,4),name.slice(0,3),name.slice(0,5)].filter(Boolean);
  const dateSuffixes = [];
  if (dd&&mm)        { dateSuffixes.push(dd+mm); dateSuffixes.push(mm+dd); }
  if (yyyy)          { dateSuffixes.push(yyyy); }
  if (dd&&mm&&yyyy)  { dateSuffixes.push(dd+mm+yyyy); dateSuffixes.push(yyyy+mm+dd); }
  if (mm&&yyyy)      { dateSuffixes.push(mm+yyyy); }
  const cardLast4s = [];
  if (last4Hint) cardLast4s.push(last4Hint);
  (person.cards||[]).forEach(c=>{ if(c.last4&&!cardLast4s.includes(c.last4)) cardLast4s.push(c.last4); });
  const seen = new Set();
  const add = (pwd,label) => {
    if(!pwd||seen.has(pwd.toLowerCase())) return;
    seen.add(pwd.toLowerCase());
    passwords.push({pwd,label});
    const lower = pwd.toLowerCase();
    if(lower!==pwd){ seen.add(lower); passwords.push({pwd:lower,label:label+" (lower)"}); }
  };
  namePrefixes.forEach(np=>{
    dateSuffixes.forEach(ds=>add(np+ds,`${person.fullName}: ${np}+${ds}`));
    cardLast4s.forEach(l4=>add(np+l4,`${person.fullName}: ${np}+${l4}`));
  });
  dateSuffixes.forEach(ds=>cardLast4s.forEach(l4=>add(ds+l4,`${person.fullName}: date+last4`)));
  cardLast4s.forEach(l4=>dateSuffixes.forEach(ds=>add(l4+ds,`${person.fullName}: last4+date`)));
  return passwords;
}

// findPersonForCard is now defined inside extractHintsFromEmail block above

function resolvePasswords(vault, people, bankHint, last4Hint, last2Hint, nameHint, emailNameHint, emailText) {
  const results = [];
  const seen = new Set();
  const addPwd = (pwd,label) => { if(pwd&&!seen.has(pwd)&&results.length<80){seen.add(pwd);results.push({pwd,label});} };

  console.log("[PwdResolve] hints:", {last4Hint,last2Hint,nameHint,bankHint,peopleCount:people?.length});

  // 1. Find best matching person using all available hints
  const person = findPersonForCard(people||[], last4Hint, last2Hint, nameHint, emailNameHint, emailText);
  console.log("[PwdResolve] matched person:", person?.fullName||"none");

  if (person) {
    const cardLast4 = last4Hint || person.cards?.find(c=>last2Hint&&c.last4?.endsWith(last2Hint))?.last4 || "";
    const pwds = generatePasswords(person, cardLast4);
    console.log("[PwdResolve] generated passwords for matched person:", pwds.length, "first:", pwds[0]?.pwd);
    pwds.forEach(p=>addPwd(p.pwd,p.label));
  }

  // 2. If no person matched but we have last4, try people whose cards match
  if (results.length===0 && last4Hint) {
    const matched=(people||[]).filter(p=>p.cards?.some(c=>c.last4===last4Hint));
    console.log("[PwdResolve] last4 fallback matches:", matched.map(p=>p.fullName));
    matched.forEach(p=>generatePasswords(p,last4Hint).forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 3. If no person matched but we have last2, try people whose cards end with last2
  if (results.length===0 && last2Hint) {
    const matched=(people||[]).filter(p=>p.cards?.some(c=>c.last4?.endsWith(last2Hint)));
    console.log("[PwdResolve] last2 fallback matches:", matched.map(p=>p.fullName));
    matched.forEach(p=>generatePasswords(p,last2Hint).forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 4. If STILL nothing — try ALL people (last resort, capped at 80)
  if (results.length===0 && people?.length>0) {
    console.log("[PwdResolve] No hints matched — trying all people as last resort");
    (people||[]).forEach(p=>generatePasswords(p,last4Hint||last2Hint||"").forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 5. Manual vault passwords
  const bank=(bankHint||"").toLowerCase(); const last4=(last4Hint||"").trim();
  if(bank&&last4)(vault||[]).filter(e=>e.bankName&&e.bankName.toLowerCase().includes(bank)&&e.last4===last4).forEach(e=>addPwd(e.password,`Vault: ${e.bankName} ••••${e.last4}`));
  if(bank)(vault||[]).filter(e=>e.bankName&&e.bankName.toLowerCase().includes(bank)&&!e.last4).forEach(e=>addPwd(e.password,`Vault: ${e.bankName}`));
  (vault||[]).forEach(e=>addPwd(e.password,`Vault: ${e.bankName||""}${e.last4?" ••••"+e.last4:""}`));

  console.log("[PwdResolve] total passwords:", results.length);
  return results;
}

function extractHintsFromEmail(subject, bodyText, toAddress) {
  const fullText = subject+" "+(bodyText||"");
  const text = fullText.toLowerCase();

  // ── Card number extraction ────────────────────────────────────────────────
  let last4 = null, last2 = null;

  // Patterns: XXXX7456, xxxx7456, ****7456, X7456, ending 7456
  const patterns4 = [
    /(?:x{3,}|\*{3,}|#{3,})(\d{4})(?!\d)/gi,
    /(?:ending|ending in|ending with|last 4|last four)\s*:?\s*(\d{4})(?!\d)/gi,
    /(?:account|card)\s*(?:no\.?|number|#)?\s*:?\s*(?:[xX*#]+)(\d{4})(?!\d)/gi,
    /[xX*]{2,}(\d{4})(?!\d)/g,
  ];
  for (const p of patterns4) {
    p.lastIndex = 0;
    const m = p.exec(fullText);
    if (m?.[1]) { last4 = m[1]; break; }
  }

  if (!last4) {
    const patterns2 = [
      /(?:x{2,}|\*{2,})(\d{2})(?!\d)/gi,
      /(?:ending|ending in)\s*:?\s*(\d{2})(?!\d)/gi,
    ];
    for (const p of patterns2) {
      p.lastIndex = 0;
      const m = p.exec(fullText);
      if (m?.[1]) { last2 = m[1]; break; }
    }
  }

  // ── Name extraction from email body ───────────────────────────────────────
  let nameHint = null;
  const namePatterns = [
    /(?:dear|hi|hello)\s+(?:mr\.?\s*|mrs\.?\s*|ms\.?\s*|dr\.?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /(?:dear|hi|hello)\s+([A-Z]{2,}(?:\s+[A-Z]{2,})?)/,
    /cardholder\s*(?:name)?\s*:?\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
  ];
  for (const p of namePatterns) {
    const m = fullText.match(p);
    if (m?.[1]?.trim().length > 2) { nameHint = m[1].trim(); break; }
  }

  // ── Name from recipient email address (e.g. SNEHADIA2019@gmail.com) ───────
  // Only use first 4-6 chars of email — long emails like "shubhamarorasmartyshubham"
  // contain multiple name fragments which cause wrong matches
  let emailNameHint = null;
  if (toAddress) {
    const username = toAddress.split("@")[0].split("+")[0]; // handle email aliases
    const alphaOnly = username.replace(/[^a-zA-Z]/g,""); // remove numbers
    // Only use first 6 chars — enough to identify name without false matches
    if (alphaOnly.length >= 3) {
      emailNameHint = alphaOnly.slice(0,6).toLowerCase(); // "shubha" not "shubhamarorasmartyshubham"
    }
  }

  // ── Bank detection ────────────────────────────────────────────────────────
  const bankMap = {
    "idfc first":"idfc","idfc":"idfc","first wow":"idfc","first bank":"idfc",
    "hdfc":"hdfc","icici":"icici","sbi":"sbi","sbi card":"sbi",
    "axis":"axis","kotak":"kotak","citibank":"citi","citi":"citi",
    "amex":"amex","american express":"amex","indusind":"indusind",
    "yes bank":"yes","rbl":"rbl","hsbc":"hsbc","pnb":"pnb",
    "standard chartered":"scb","union bank":"union","canara":"canara",
    "bank of baroda":"bob","federal":"federal","au small":"au","au bank":"au",
    "bpcl":"sbi","octane":"sbi","simply click":"sbi","millennia":"hdfc",
    "regalia":"hdfc","flipkart":"axis","magnus":"axis","lit":"lit",
  };
  let bankFound = null;
  for (const [key,val] of Object.entries(bankMap)) {
    if (text.includes(key)) { bankFound = val; break; }
  }

  return { last4, last2, nameHint, emailNameHint, bank: bankFound };
}

// Match a person from registry using multiple signals
function findPersonForCard(people, last4Hint, last2Hint, nameHint, emailNameHint, emailText) {
  if (!people||!people.length) return null;
  const text = (emailText||"").toLowerCase();

  // Priority 1: exact last4 card match
  if (last4Hint) {
    for (const p of people) {
      if (p.cards?.some(c=>c.last4===last4Hint)) return p;
    }
  }

  // Priority 2: email address prefix matches person name
  // emailNameHint is already truncated to 6 chars e.g. "shubha" from "shubhamarorasmartyshubham"
  // Match: person name word must START WITH emailNameHint OR emailNameHint must START WITH name word
  if (emailNameHint) {
    const hint = emailNameHint.toUpperCase(); // e.g. "SHUBHA"
    for (const p of people) {
      const nameWords = (p.fullName||"").toUpperCase().replace(/[^A-Z ]/g,"").split(" ");
      // e.g. nameWords = ["SHUBHAM", "ARORA"]
      // Match if: "SHUBHAM".startsWith("SHUBHA") ✓ or "SHUBHA".startsWith("SHUB") ✓
      const matched = nameWords.some(w =>
        w.length >= 4 && (w.startsWith(hint) || hint.startsWith(w.slice(0,4)))
      );
      if (matched) return p;
    }
  }

  // Priority 3: last2 + body name match together
  if (last2Hint && nameHint) {
    for (const p of people) {
      const nameWords = (p.fullName||"").toLowerCase().split(" ");
      const nameMatches = nameWords.some(w=>w.length>2&&nameHint.toLowerCase().includes(w));
      const cardMatches = p.cards?.some(c=>c.last4?.endsWith(last2Hint));
      if (nameMatches && cardMatches) return p;
    }
  }

  // Priority 4: name from email body ("Dear Ravi")
  if (nameHint) {
    for (const p of people) {
      const nameWords = (p.fullName||"").toLowerCase().split(" ");
      if (nameWords.some(w=>w.length>2&&nameHint.toLowerCase().includes(w))) return p;
    }
  }

  // Priority 5: name anywhere in full email text
  for (const p of people) {
    const nameWords = (p.fullName||"").toLowerCase().split(" ");
    if (nameWords.some(part=>part.length>3&&text.includes(part))) return p;
  }

  // Priority 6: last2 alone (only if unambiguous)
  if (last2Hint) {
    const matched = people.filter(p=>p.cards?.some(c=>c.last4?.endsWith(last2Hint)));
    if (matched.length===1) return matched[0];
  }

  return null;
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
async function getPDFLib() {
  if (window._pdfjsLib) return window._pdfjsLib;
  await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  window._pdfjsLib=window.pdfjsLib; return window._pdfjsLib;
}

async function pdfBytesToBase64Image(bytes, password="") {
  const pdfjsLib=await getPDFLib();
  // Copy the buffer so PDF.js doesn't detach the original (needed for password retries)
  const dataCopy = bytes instanceof Uint8Array
    ? new Uint8Array(bytes.buffer.slice(0))
    : bytes.slice(0);
  const loadingTask=pdfjsLib.getDocument({data:dataCopy,password});
  let pdf;
  try{pdf=await loadingTask.promise;}
  catch(err){if(err.name==="PasswordException")throw new Error("WRONG_PASSWORD");throw err;}
  const pages=[];let totalH=0,maxW=0;
  for(let i=1;i<=Math.min(pdf.numPages,4);i++){
    const page=await pdf.getPage(i);const vp=page.getViewport({scale:1.5});
    const canvas=document.createElement("canvas");canvas.width=vp.width;canvas.height=vp.height;
    await page.render({canvasContext:canvas.getContext("2d"),viewport:vp}).promise;
    pages.push(canvas);totalH+=vp.height;maxW=Math.max(maxW,vp.width);
  }
  const merged=document.createElement("canvas");merged.width=maxW;merged.height=totalH;
  const ctx=merged.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,maxW,totalH);
  let y=0;for(const c of pages){ctx.drawImage(c,0,y);y+=c.height;}
  return merged.toDataURL("image/jpeg",0.85).split(",")[1];
}

async function tryPasswordsOnPDF(bytes, passwordList) {
  try{return{imgBase64:await pdfBytesToBase64Image(bytes,""),usedLabel:"no password"};}
  catch(e){if(e.message!=="WRONG_PASSWORD")throw e;}
  for(const{pwd,label}of passwordList){
    try{return{imgBase64:await pdfBytesToBase64Image(bytes,pwd),usedLabel:label};}
    catch(e){if(e.message!=="WRONG_PASSWORD")throw e;}
  }
  throw new Error("WRONG_PASSWORD");
}

async function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});}

// ─── GROQ ───────────────────────────────────────────────────────────────────
async function callGroq(apiKey,base64,mimeType="image/jpeg"){
  // Groq is OpenAI-compatible — just different base URL and model
  const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},
    body:JSON.stringify({
      model:AI_MODEL,
      max_tokens:1000,
      temperature:0.1,
      response_format:{type:"json_object"},
      messages:[{
        role:"user",
        content:[
          {type:"text",text:EXTRACTION_PROMPT},
          {type:"image_url",image_url:{url:`data:${mimeType};base64,${base64}`}}
        ]
      }]
    })
  });
  const data=await res.json();
  if(data.error)throw new Error(data.error.message||data.error);
  const text=data.choices?.[0]?.message?.content||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

// ─── GMAIL ────────────────────────────────────────────────────────────────────
async function gmailFetch(path,token){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`,{headers:{Authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail API ${res.status}`);return res.json();}
async function fetchStatementEmails(token, afterDate=null){
  // afterDate = "YYYY/MM/DD" Gmail format
  const base = 'has:attachment filename:pdf (subject:statement OR subject:e-statement OR subject:"credit card" OR subject:"account statement" OR subject:bill OR subject:"due date" OR subject:outstanding)';
  const dateFilter = afterDate ? ` after:${afterDate}` : "";
  const q = encodeURIComponent(base + dateFilter);
  const d = await gmailFetch(`users/me/messages?q=${q}&maxResults=100`, token);
  return d.messages||[];
}
async function fetchEmailWithAttachments(messageId,token){
  const msg=await gmailFetch(`users/me/messages/${messageId}?format=full`,token);
  const hdr=(name)=>msg.payload?.headers?.find(h=>h.name===name)?.value||"";
  const toAddress=hdr("To")||hdr("Delivered-To")||"";
  const pdfParts=[];let bodyText="";
  function collect(parts){if(!parts)return;for(const p of parts){if(p.mimeType==="text/plain"&&p.body?.data){try{bodyText+=atob(p.body.data.replace(/-/g,"+").replace(/_/g,"/"));}catch{}}if(p.mimeType==="application/pdf"||(p.filename&&p.filename.toLowerCase().endsWith(".pdf")))pdfParts.push(p);if(p.parts)collect(p.parts);}}
  collect(msg.payload?.parts);
  return{messageId,subject:hdr("Subject"),date:hdr("Date"),toAddress,pdfParts,bodyText}; // eslint-disable-line
}
async function downloadAttachment(msgId,attId,token){const d=await gmailFetch(`users/me/messages/${msgId}/attachments/${attId}`,token);return d.data.replace(/-/g,"+").replace(/_/g,"/");}

// ─── EXCEL ────────────────────────────────────────────────────────────────────
function exportToExcel(records){
  const headers=["#","Cardholder","Bank","Last 4","Statement Date","Due Date","Amount","Currency","Received","Source","Status"];
  const rows=records.map((r,i)=>[i+1,r.cardholderName||"",r.bankName||"",r.lastFourDigits||"",r.statementDate||"",r.dueDate||"",r.dueAmount??"",r.currency||"",r.receivedOn||"",r.source||"manual",r.paid?"PAID":"PENDING"]);
  const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws["!cols"]=[{wch:4},{wch:20},{wch:18},{wch:10},{wch:16},{wch:16},{wch:14},{wch:10},{wch:14},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws,"CC Statements");
  XLSX.writeFile(wb,`CC_Statements_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const S={
  card:{background:"#0d1424",border:"1px solid #1e293b",borderRadius:12},
  input:{width:"100%",background:"#0a0e1a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",color:"#e2e8f0",fontFamily:"'DM Mono',monospace",fontSize:13,outline:"none"},
  btn:(color="#1d4ed8",disabled=false)=>({background:disabled?"#1e293b":color,color:disabled?"#475569":"#fff",border:"none",borderRadius:8,padding:"10px 20px",cursor:disabled?"not-allowed":"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,opacity:disabled?0.5:1,transition:"opacity 0.15s"}),
  label:{color:"#64748b",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",display:"block",marginBottom:6},
};

// ─── BADGE ────────────────────────────────────────────────────────────────────
function Badge({status}){
  const map={pending:["#1e293b","#94a3b8","Pending"],"needs-password":["#2d1b0e","#fb923c","🔒 Locked"],processing:["#1e3a5f","#60a5fa","Extracting…"],done:["#052e16","#4ade80","✓ Done"],error:["#3b1111","#f87171","Error"],skipped:["#1e293b","#475569","Skipped"]};
  const[bg,color,label]=map[status]||map.pending;
  return<span style={{fontSize:10,fontWeight:600,letterSpacing:"0.06em",padding:"2px 9px",borderRadius:20,background:bg,color,textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>;
}

// ─── PASSWORD MODAL ───────────────────────────────────────────────────────────
function PasswordModal({file,hint,onSubmit,onSkip}){
  const[pwd,setPwd]=useState("");const[err,setErr]=useState("");
  const ref=useRef();useEffect(()=>{setTimeout(()=>ref.current?.focus(),80);},[]);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}}>
      <div style={{...S.card,padding:"28px",maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.7)"}}>
        <div style={{fontSize:28,marginBottom:10}}>🔒</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17,marginBottom:6}}>Password Required</div>
        <div style={{color:"#64748b",fontSize:12,marginBottom:4,lineHeight:1.6}}><span style={{color:"#94a3b8"}}>{file.name}</span></div>
        {hint&&<div style={{background:"#1e3a5f22",border:"1px solid #1e3a5f",borderRadius:6,padding:"6px 10px",fontSize:11,color:"#60a5fa",marginBottom:12}}>💡 Tried all vault passwords for <strong>{hint}</strong> — none worked.</div>}
        {err&&<div style={{background:"#3b1111",color:"#f87171",borderRadius:6,padding:"8px 12px",fontSize:12,marginBottom:12}}>✕ {err}</div>}
        <input ref={ref} type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&onSubmit(pwd,setErr)} placeholder="Enter PDF password" style={{...S.input,marginBottom:14}}/>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>onSubmit(pwd,setErr)} style={{...S.btn(),flex:1}}>Unlock & Extract</button>
          <button onClick={onSkip} style={{background:"none",border:"1px solid #1e293b",color:"#64748b",borderRadius:8,padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({onSave}){
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
function VaultPanel({vault,uid,onAdd,onUpdate,onDelete}){
  const[bankName,setBankName]=useState("");const[last4,setLast4]=useState("");const[cardHolder,setCardHolder]=useState("");const[pwd,setPwd]=useState("");
  const[show,setShow]=useState({});const[editing,setEditing]=useState(null);const[editPwd,setEditPwd]=useState("");const[saving,setSaving]=useState(false);

  const add=async()=>{
    if(!bankName.trim()||!pwd.trim())return;
    setSaving(true);
    const clean4=last4.trim().replace(/\D/g,"").slice(-4);
    const entry={id:Date.now().toString(),bankName:bankName.trim(),last4:clean4,cardholderName:cardHolder.trim(),password:pwd.trim()};
    await onAdd(entry);
    setBankName("");setLast4("");setCardHolder("");setPwd("");setSaving(false);
  };

  const saveEdit=async(e)=>{
    if(!editPwd.trim())return;
    await onUpdate(e.firestoreId||e.id,{password:editPwd.trim()});
    setEditing(null);setEditPwd("");
  };

  const grouped=vault.reduce((acc,e)=>{const k=e.bankName.toUpperCase();if(!acc[k])acc[k]=[];acc[k].push(e);return acc;},{});

  return(
    <div>
      <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>
        Passwords synced to <strong style={{color:uid?"#4ade80":"#f87171"}}>{uid?"☁ Firebase — safe across all devices":"⚠ Local only — sign in for cloud sync"}</strong>
      </p>
      <div style={{...S.card,padding:"16px",marginBottom:20}}>
        <div style={{color:"#60a5fa",fontSize:11,fontWeight:600,marginBottom:12,letterSpacing:"0.05em"}}>+ ADD VAULT ENTRY</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div><label style={S.label}>Bank Name *</label><input value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="e.g. HDFC" style={S.input}/></div>
          <div><label style={S.label}>Card Last 4 Digits</label><input value={last4} onChange={e=>setLast4(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="e.g. 1234" maxLength={4} style={{...S.input,letterSpacing:"0.2em"}}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <div><label style={S.label}>Cardholder Name</label><input value={cardHolder} onChange={e=>setCardHolder(e.target.value)} placeholder="Optional" style={S.input}/></div>
          <div><label style={S.label}>PDF Password *</label><input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Statement password" style={S.input}/></div>
        </div>
        <button onClick={add} disabled={!bankName.trim()||!pwd.trim()||saving} style={S.btn("#1d4ed8",!bankName.trim()||!pwd.trim()||saving)}>{saving?"⟳ Saving…":"+ Add to Vault"}</button>
      </div>

      {Object.keys(grouped).length===0?(
        <div style={{color:"#1e293b",fontSize:12,textAlign:"center",padding:"24px 0"}}>No passwords saved yet.</div>
      ):(
        Object.entries(grouped).map(([bankKey,entries])=>(
          <div key={bankKey} style={{marginBottom:14}}>
            <div style={{color:"#334155",fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6,paddingLeft:2}}>🏦 {bankKey} · {entries.length} card{entries.length!==1?"s":""}</div>
            <div style={{border:"1px solid #1e293b",borderRadius:10,overflow:"hidden"}}>
              {entries.map((e,idx)=>(
                <div key={e.firestoreId||e.id} style={{background:"#0a0e1a",borderBottom:idx<entries.length-1?"1px solid #0f1929":"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",fontSize:12}}>
                    <div style={{minWidth:52,textAlign:"center"}}>{e.last4?<span style={{background:"#1e293b",padding:"3px 8px",borderRadius:6,color:"#60a5fa",fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:12}}>••••{e.last4}</span>:<span style={{background:"#1e3a5f33",padding:"3px 8px",borderRadius:6,color:"#475569",fontSize:10}}>ALL</span>}</div>
                    <div style={{flex:1}}>
                      <div style={{color:"#e2e8f0",fontWeight:500}}>{e.cardholderName||<span style={{color:"#334155",fontStyle:"italic"}}>No name</span>}</div>
                      {e.last4&&<div style={{color:"#334155",fontSize:10}}>Card ••••{e.last4}</div>}
                    </div>
                    {editing===(e.firestoreId||e.id)?(
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="password" value={editPwd} onChange={ev=>setEditPwd(ev.target.value)} onKeyDown={ev=>ev.key==="Enter"&&saveEdit(e)} placeholder="New password" autoFocus style={{...S.input,width:130,padding:"5px 8px",fontSize:11}}/>
                        <button onClick={()=>saveEdit(e)} style={{...S.btn("#15803d"),padding:"5px 10px",fontSize:10}}>Save</button>
                        <button onClick={()=>{setEditing(null);setEditPwd("");}} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>✕</button>
                      </div>
                    ):(
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{color:"#475569",fontFamily:"'DM Mono',monospace",fontSize:11,minWidth:80,textAlign:"right"}}>{show[e.firestoreId||e.id]?e.password:"•".repeat(Math.min(e.password.length,10))}</span>
                        <button onClick={()=>setShow(s=>({...s,[e.firestoreId||e.id]:!s[e.firestoreId||e.id]}))} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:12,padding:"0 2px"}}>{show[e.firestoreId||e.id]?"🙈":"👁"}</button>
                        <button onClick={()=>{setEditing(e.firestoreId||e.id);setEditPwd(e.password);}} style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:11,padding:"0 2px"}}>✏</button>
                        <button onClick={()=>onDelete(e.firestoreId||e.id)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div style={{color:"#1e3a5f",fontSize:10,marginTop:12,lineHeight:1.7}}>🔐 {uid?"Encrypted in Firebase Firestore":"Stored locally — sign in to sync"}</div>
    </div>
  );
}

// ─── PEOPLE PANEL (Cardholder Registry) ──────────────────────────────────────
function PeoplePanel({people, uid, onAdd, onUpdate, onDelete}) {
  // "add" form state
  const[fullName,setFullName]=useState("");
  const[dob,setDob]=useState("");
  const[cards,setCards]=useState([{last4:"",bankName:""}]);
  const[saving,setSaving]=useState(false);
  const[preview,setPreview]=useState(null);
  // "edit" state
  const[editing,setEditing]=useState(null); // firestoreId|id of person being edited
  const[editName,setEditName]=useState("");
  const[editDob,setEditDob]=useState("");
  const[editCards,setEditCards]=useState([]);
  const[editSaving,setEditSaving]=useState(false);
  const[expanded,setExpanded]=useState(null);

  // Add form helpers
  const addCard=()=>setCards(c=>[...c,{last4:"",bankName:""}]);
  const removeCard=(i)=>setCards(c=>c.filter((_,j)=>j!==i));
  const updateCard=(i,f,v)=>setCards(c=>c.map((card,j)=>j===i?{...card,[f]:v}:card));

  const handleAdd=async()=>{
    if(!fullName.trim()||!dob.trim())return;
    setSaving(true);
    await onAdd({id:Date.now().toString(),fullName:fullName.trim().toUpperCase(),dob:dob.trim(),cards:cards.filter(c=>c.last4.trim())});
    setFullName("");setDob("");setCards([{last4:"",bankName:""}]);setSaving(false);setPreview(null);
  };

  const showPreview=()=>{
    if(!fullName.trim()||!dob.trim())return;
    setPreview(generatePasswords({fullName:fullName.trim().toUpperCase(),dob:dob.trim(),cards:cards.filter(c=>c.last4.trim())},cards[0]?.last4||"").slice(0,16));
  };

  // Edit helpers
  const startEdit=(person)=>{
    setEditing(person.firestoreId||person.id);
    setEditName(person.fullName||"");
    setEditDob(person.dob||"");
    setEditCards(person.cards?.length?[...person.cards]:[{last4:"",bankName:""}]);
    setExpanded(null);
  };
  const cancelEdit=()=>{setEditing(null);setEditName("");setEditDob("");setEditCards([]);};
  const addEditCard=()=>setEditCards(c=>[...c,{last4:"",bankName:""}]);
  const removeEditCard=(i)=>setEditCards(c=>c.filter((_,j)=>j!==i));
  const updateEditCard=(i,f,v)=>setEditCards(c=>c.map((card,j)=>j===i?{...card,[f]:v}:card));

  const handleUpdate=async(fid)=>{
    if(!editName.trim()||!editDob.trim())return;
    setEditSaving(true);
    await onUpdate(fid,{fullName:editName.trim().toUpperCase(),dob:editDob.trim(),cards:editCards.filter(c=>c.last4.trim())});
    cancelEdit();setEditSaving(false);
  };

  return(
    <div>
      <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>
        Add each cardholder once. The app <strong style={{color:"#94a3b8"}}>auto-generates all password combinations</strong> (name+DOB, name+last4digits, etc.) and tries them automatically during Gmail sync.
      </p>

      {/* Add form */}
      <div style={{...S.card,padding:"18px",marginBottom:20}}>
        <div style={{color:"#60a5fa",fontSize:11,fontWeight:600,marginBottom:14,letterSpacing:"0.05em"}}>+ ADD CARDHOLDER</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div>
            <label style={S.label}>Full Name (as on card) *</label>
            <input value={fullName} onChange={e=>setFullName(e.target.value.toUpperCase())} placeholder="e.g. RAVI SHANKAR" style={{...S.input,textTransform:"uppercase"}}/>
          </div>
          <div>
            <label style={S.label}>Date of Birth *</label>
            <input value={dob} onChange={e=>setDob(e.target.value)} placeholder="DD/MM/YYYY" maxLength={10} style={{...S.input,letterSpacing:"0.1em"}}/>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...S.label,marginBottom:8}}>Credit Cards</label>
          {cards.map((card,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
              <input value={card.last4} onChange={e=>updateCard(i,"last4",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="Last 4" maxLength={4} style={{...S.input,width:90,letterSpacing:"0.2em",fontSize:14,fontWeight:700,textAlign:"center"}}/>
              <input value={card.bankName} onChange={e=>updateCard(i,"bankName",e.target.value)} placeholder="Bank name (e.g. HDFC)" style={{...S.input,flex:1}}/>
              {cards.length>1&&<button onClick={()=>removeCard(i)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>}
            </div>
          ))}
          <button onClick={addCard} style={{background:"none",border:"1px dashed #1e293b",color:"#475569",borderRadius:7,padding:"5px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,marginTop:4}}>+ Add another card</button>
        </div>
        {preview&&(
          <div style={{background:"#050810",border:"1px solid #0f172a",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
            <div style={{color:"#60a5fa",fontSize:10,fontWeight:600,marginBottom:8}}>🔑 SAMPLE PASSWORDS TO TRY ({preview.length} shown)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {preview.map((p,i)=><span key={i} style={{background:"#1e293b",color:"#94a3b8",padding:"3px 8px",borderRadius:5,fontFamily:"'DM Mono',monospace",fontSize:11}}>{p.pwd}</span>)}
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={handleAdd} disabled={!fullName.trim()||!dob.trim()||saving} style={S.btn("#1d4ed8",!fullName.trim()||!dob.trim()||saving)}>{saving?"⟳ Saving…":"+ Add Cardholder"}</button>
          <button onClick={showPreview} disabled={!fullName.trim()||!dob.trim()} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>👁 Preview Passwords</button>
        </div>
      </div>

      {/* People list */}
      {people.length===0?(
        <div style={{color:"#1e293b",fontSize:12,textAlign:"center",padding:"24px 0"}}>No cardholders added yet.</div>
      ):(
        people.map(person=>{
          const pid=person.firestoreId||person.id;
          const isEditing=editing===pid;
          const isExpanded=expanded===pid;
          return(
            <div key={pid} style={{...S.card,marginBottom:12,overflow:"hidden"}}>
              {/* Header row */}
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px"}}>
                <div style={{width:36,height:36,borderRadius:8,background:"linear-gradient(135deg,#1e40af,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"#fff",flexShrink:0,cursor:"pointer"}} onClick={()=>setExpanded(isExpanded?null:pid)}>
                  {(person.fullName||"?")[0]}
                </div>
                <div style={{flex:1,cursor:"pointer"}} onClick={()=>!isEditing&&setExpanded(isExpanded?null:pid)}>
                  <div style={{color:"#e2e8f0",fontWeight:600,fontSize:13}}>{person.fullName}</div>
                  <div style={{color:"#475569",fontSize:10,marginTop:2}}>
                    DOB: {person.dob} · {(person.cards||[]).length} card{(person.cards||[]).length!==1?"s":""}
                    {(person.cards||[]).length>0&&" · "+(person.cards||[]).map(c=>`${c.bankName||"?"} ••••${c.last4}`).join(", ")}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  <span style={{background:"#052e16",color:"#4ade80",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:600}}>~{generatePasswords(person,"").length} combos</span>
                  <button onClick={()=>isEditing?cancelEdit():startEdit(person)} style={{background:"none",border:`1px solid ${isEditing?"#3b1111":"#1e3a5f"}`,color:isEditing?"#f87171":"#60a5fa",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>{isEditing?"✕ Cancel":"✏ Edit"}</button>
                  <button onClick={()=>onDelete(pid)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:14,padding:"0 2px"}}>🗑</button>
                </div>
              </div>

              {/* Edit form */}
              {isEditing&&(
                <div style={{borderTop:"1px solid #0f172a",padding:"14px 16px",background:"#080c14"}}>
                  <div style={{color:"#60a5fa",fontSize:10,fontWeight:600,marginBottom:12,letterSpacing:"0.06em"}}>✏ EDIT CARDHOLDER</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    <div>
                      <label style={S.label}>Full Name *</label>
                      <input value={editName} onChange={e=>setEditName(e.target.value.toUpperCase())} style={{...S.input,textTransform:"uppercase"}}/>
                    </div>
                    <div>
                      <label style={S.label}>Date of Birth *</label>
                      <input value={editDob} onChange={e=>setEditDob(e.target.value)} placeholder="DD/MM/YYYY" maxLength={10} style={{...S.input,letterSpacing:"0.1em"}}/>
                    </div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={{...S.label,marginBottom:8}}>Credit Cards</label>
                    {editCards.map((card,i)=>(
                      <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                        <input value={card.last4} onChange={e=>updateEditCard(i,"last4",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="Last 4" maxLength={4} style={{...S.input,width:90,letterSpacing:"0.2em",fontSize:14,fontWeight:700,textAlign:"center"}}/>
                        <input value={card.bankName} onChange={e=>updateEditCard(i,"bankName",e.target.value)} placeholder="Bank name" style={{...S.input,flex:1}}/>
                        {editCards.length>1&&<button onClick={()=>removeEditCard(i)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>}
                      </div>
                    ))}
                    <button onClick={addEditCard} style={{background:"none",border:"1px dashed #1e293b",color:"#475569",borderRadius:7,padding:"5px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,marginTop:4}}>+ Add card</button>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>handleUpdate(pid)} disabled={!editName.trim()||!editDob.trim()||editSaving} style={S.btn("#15803d",!editName.trim()||!editDob.trim()||editSaving)}>{editSaving?"⟳ Saving…":"✓ Save Changes"}</button>
                    <button onClick={cancelEdit} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Expanded: password preview */}
              {isExpanded&&!isEditing&&(
                <div style={{borderTop:"1px solid #0f172a",padding:"12px 16px"}}>
                  <div style={{color:"#334155",fontSize:10,fontWeight:600,marginBottom:8,letterSpacing:"0.06em"}}>🔑 AUTO-GENERATED PASSWORDS</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                    {generatePasswords(person,person.cards?.[0]?.last4||"").slice(0,24).map((p,i)=>(
                      <span key={i} style={{background:"#0a0e1a",border:"1px solid #1e293b",color:"#94a3b8",padding:"3px 8px",borderRadius:5,fontFamily:"'DM Mono',monospace",fontSize:10}}>{p.pwd}</span>
                    ))}
                  </div>
                  <div style={{color:"#1e3a5f",fontSize:10}}>All {generatePasswords(person,person.cards?.[0]?.last4||"").length} combinations tried automatically during sync</div>
                </div>
              )}
            </div>
          );
        })
      )}
      <div style={{color:"#1e3a5f",fontSize:10,marginTop:12,lineHeight:1.7}}>
        🔐 {uid?"Synced to Firebase — available on all devices":"Local only — sign in to sync"}<br/>
        💡 Match priority: exact card → name+DOB → name+last4 → all combos
      </div>
    </div>
  );
}

// ─── GMAIL SYNC PANEL ─────────────────────────────────────────────────────────
function GmailSyncPanel({settings,vault,people,uid,onNewRecords,processedIds,onProcessed,onResetProcessed}){
  const[gmailToken,setGmailToken]=useState(ls.get("cc_gmail_token"));
  const[gmailEmail,setGmailEmail]=useState(ls.get("cc_gmail_email",""));
  const[syncing,setSyncing]=useState(false);
  const[syncLog,setSyncLog]=useState([]);
  const[pwdRequest,setPwdRequest]=useState(null);
  const[lastSyncDate,setLastSyncDate]=useState(()=>ls.get("cc_last_sync_date",null));
  const[syncDays,setSyncDays]=useState(30); // days to look back on first sync

  const log=(msg,type="info")=>setSyncLog(prev=>[...prev.slice(-40),{msg,type,t:new Date().toLocaleTimeString()}]);

  const signIn=()=>{
    if(!settings.googleClientId){alert("Google Client ID not set. Go to ⚙ Settings.");return;}
    const p=new URLSearchParams({client_id:settings.googleClientId,redirect_uri:window.location.origin+window.location.pathname,response_type:"token",scope:GMAIL_SCOPES,prompt:"consent"});
    window.location.href=`https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  };
  const signOut=()=>{ls.del("cc_gmail_token");ls.del("cc_gmail_email");setGmailToken(null);setGmailEmail("");setSyncLog([]);};

  useEffect(()=>{
    const hash=new URLSearchParams(window.location.hash.replace("#",""));
    const token=hash.get("access_token");
    if(token){ls.set("cc_gmail_token",token);setGmailToken(token);window.history.replaceState({},"",window.location.pathname);fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).then(d=>{ls.set("cc_gmail_email",d.email||"");setGmailEmail(d.email||"");});}
  },[]);

  const askPassword=(filename,hint)=>new Promise((resolve,reject)=>setPwdRequest({filename,hint,resolve,reject}));

  const runSync=async()=>{
    if(!gmailToken)return;
    setSyncing(true);setSyncLog([]);
    // Quick token check before starting
    try{
      const test=await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token="+gmailToken);
      if(test.status===400||test.status===401){
        log("❌ Gmail token expired — please Disconnect and Sign in again","error");
        signOut(); setSyncing(false); return;
      }
      const info=await test.json();
      const minsLeft=Math.floor((info.expires_in||0)/60);
      log(`✓ Gmail token valid · ${minsLeft} min remaining`);
    }catch{}

    // Calculate date filter
    // If we have a lastSyncDate, use that. Otherwise look back syncDays days.
    let afterDate;
    if(lastSyncDate){
      afterDate=lastSyncDate;
      log(`📅 Fetching emails since last sync: ${lastSyncDate}`);
    } else {
      const d=new Date();d.setDate(d.getDate()-syncDays);
      afterDate=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
      log(`📅 First sync — fetching last ${syncDays} days (since ${afterDate})`);
    }

    log("🔍 Searching Gmail for CC statement emails…");
    try{
      const messages=await fetchStatementEmails(gmailToken,afterDate);
      log(`Total matching emails in date range: ${messages.length}`);
      log(`Already processed: ${processedIds.length} · Remaining: ${messages.filter(m=>!processedIds.includes(m.id)).length}`);
      const fresh=messages.filter(m=>!processedIds.includes(m.id));
      if(fresh.length===0){
        log("✅ All caught up — no new emails in this date range.","success");
        log("💡 Tip: Use 🔄 Re-scan or adjust the date range below if needed.","warn");
        setSyncing(false);return;
      }
      const newRecords=[];
      for(const{id}of fresh){
        try{
          const{subject,date,toAddress,pdfParts,bodyText}=await fetchEmailWithAttachments(id,gmailToken);
          log(`📧 Subject: "${subject}"`);
          log(`   Date: ${date} · PDF attachments found: ${pdfParts.length}`);
          if(pdfParts.length===0){
            log(`   ↳ ⚠ No PDF attachment — skipping. (MIME types: ${bodyText.slice(0,50)})`, "warn");
            onProcessed(id);continue;
          }
          const{last4:emailLast4,last2:emailLast2,nameHint:emailName,emailNameHint,bank:emailBank}=extractHintsFromEmail(subject,bodyText,toAddress);
          log(`   ↳ Hints — Bank: ${emailBank||"?"} · Card: ${emailLast4?"••••"+emailLast4:emailLast2?"••"+emailLast2:"?"} · Name: ${emailName||"?"} · Email: ${emailNameHint||"?"}`);
          if(!emailLast4&&!emailLast2&&!emailName&&!emailNameHint) log(`   ↳ 📋 Body preview: "${(bodyText||"").slice(0,150).replace(/\n/g," ")}"`,"warn");
          for(const part of pdfParts){
            const fname=part.filename||"attachment.pdf";
            const hasAttachId=!!part.body?.attachmentId;
            const hasInlineData=!!part.body?.data;
            log(`   ↳ 📄 ${fname} (attachmentId: ${hasAttachId}, inlineData: ${hasInlineData}, size: ${part.body?.size||"?"})`);
            let b64raw;
            if(hasAttachId){
              log(`   ↳ Downloading attachment...`);
              b64raw=await downloadAttachment(id,part.body.attachmentId,gmailToken);
              log(`   ↳ Downloaded: ${b64raw?.length||0} chars`);
            } else if(hasInlineData){
              b64raw=part.body.data.replace(/-/g,"+").replace(/_/g,"/");
              log(`   ↳ Inline data: ${b64raw?.length||0} chars`);
            } else{
              log(`   ↳ ❌ Cannot get PDF data — no attachmentId or inline data`,"error");
              continue;
            }
            if(!b64raw||b64raw.length<100){log(`   ↳ ❌ PDF data too small or empty (${b64raw?.length} chars)`,"error");continue;}
            const raw=atob(b64raw);const bytes=new Uint8Array(raw.length);
            for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
            log(`   ↳ PDF size: ${(bytes.length/1024).toFixed(1)} KB`);
            const pwdList=resolvePasswords(vault,people||[],emailBank||subject,emailLast4,emailLast2,emailName,emailNameHint,subject+" "+bodyText);
            log(`   ↳ 🔐 ${pwdList.length} passwords to try (matched by: ${emailLast4?"last4":emailLast2?"last2":emailName?"name":emailNameHint?"email-addr":"none"})`);
            if(pwdList.length>0) log(`   ↳ First 3: ${pwdList.slice(0,3).map(p=>p.pwd).join(", ")}`);
            let imgBase64=null;
            try{
              const{imgBase64:img,usedLabel}=await tryPasswordsOnPDF(bytes,pwdList);
              imgBase64=img;
              log(`   ↳ ✓ PDF opened: ${usedLabel}`,"success");
            }catch(e){
              if(e.message==="WRONG_PASSWORD"){
                log(`   ↳ 🔒 All ${pwdList.length} passwords failed — asking manually`,"warn");
                let manualPwd;
                try{manualPwd=await askPassword(fname,emailBank?.toUpperCase()||subject.slice(0,30));}
                catch{log(`   ↳ Skipped by user`,"warn");continue;}
                setPwdRequest(null);
                try{imgBase64=await pdfBytesToBase64Image(bytes,manualPwd);log(`   ↳ ✓ Opened with manual password`,"success");}
                catch(e2){log(`   ↳ ❌ Wrong manual password too`,"error");continue;}
              }else{
                log(`   ↳ ❌ PDF error: ${e.message}`,"error");continue;
              }
            }
            log(`   ↳ 🤖 Sending to Groq for extraction...`);
            try{
              const result=await callGroq(settings.geminiKey,imgBase64);
              result.fileName=fname;result.receivedOn=new Date(date).toLocaleDateString("en-GB");
              result.source="gmail";result.paid=false;result.id=`gmail-${id}-${fname}`;
              newRecords.push(result);
              log(`   ↳ ✅ ${result.cardholderName||"?"} · ${result.bankName||"?"} ••••${result.lastFourDigits||"?"} · Due: ${result.dueAmount||"?"} ${result.currency||""}`,"success");
            }catch(aiErr){
              log(`   ↳ ❌ Groq error: ${aiErr.message}`,"error");
            }
          }
          onProcessed(id);
        }catch(err){
          if(err.message.includes("401")){
            log("❌ Gmail token expired — please Disconnect and Sign in again","error");
            signOut(); setSyncing(false); return; // stop immediately, no point continuing
          }
          log(`❌ Error processing email: ${err.message}`,"error");
          onProcessed(id);
        }
      }
      if(newRecords.length>0){
        await onNewRecords(newRecords);
        log(`🎉 Successfully added ${newRecords.length} statement(s) to tracker!`,"success");
      } else {
        log("⚠ No new data extracted. Check logs above for details.","warn");
        log("💡 Common causes: all emails already processed, PDFs blocked, wrong passwords","warn");
      }
      // Save today as last sync date so next sync only reads new emails
      const today=new Date();
      const todayStr=`${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,"0")}/${String(today.getDate()).padStart(2,"0")}`;
      setLastSyncDate(todayStr);
      ls.set("cc_last_sync_date",todayStr);
      log(`📅 Last sync date saved: ${todayStr}`);
    }catch(err){
      if(err.message.includes("401")){log("❌ Gmail session expired. Please sign in again.","error");signOut();}
      else log(`❌ Sync error: ${err.message}`,"error");
    }
    setSyncing(false);
  };

  return(
    <div>
      {pwdRequest&&<PasswordModal file={{name:pwdRequest.filename}} hint={pwdRequest.hint} onSubmit={(pwd,setErr)=>{if(!pwd.trim()){setErr("Enter password");return;}pwdRequest.resolve(pwd);}} onSkip={()=>{pwdRequest.reject("skipped");setPwdRequest(null);}}/>}
      {!gmailToken?(
        <div>
          <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:20}}>Connect Gmail to auto-find CC statement emails and extract data.</p>
          {!settings.googleClientId&&<div style={{background:"#2d1b0e",border:"1px solid #92400e",borderRadius:8,padding:"12px 14px",fontSize:12,color:"#fb923c",marginBottom:16,lineHeight:1.7}}>⚠ Google Client ID not set. Go to <strong>⚙ Settings</strong>.</div>}
          <button onClick={signIn} disabled={!settings.googleClientId} style={{...S.btn("#15803d",!settings.googleClientId),display:"flex",alignItems:"center",gap:10,padding:"12px 24px"}}>
            <span style={{fontSize:18,fontWeight:700}}>G</span> Sign in with Google
          </button>
        </div>
      ):(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{background:"#052e16",border:"1px solid #14532d",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#4ade80"}}>✓ {gmailEmail||"Gmail connected"}</div>
            <button onClick={signOut} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",borderRadius:7,padding:"7px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>Disconnect</button>
          </div>
          <div style={{background:"#2d1b0e",border:"1px solid #92400e",borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:11,color:"#fb923c",lineHeight:1.7}}>
            ⚠ <strong>Gmail tokens expire after 1 hour.</strong> If you see 401 errors, click Disconnect → Sign in again → Sync immediately.
          </div>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            <button onClick={runSync} disabled={syncing} style={{...S.btn(syncing?"#1e293b":"#1d4ed8",syncing),display:"flex",alignItems:"center",gap:8}}>
              {syncing?"⟳ Syncing Gmail…":"⚡ Sync Gmail Now"}
            </button>
            <button onClick={()=>{onResetProcessed();log("🔄 Reset — will re-scan emails in current date range","success");}} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>
              🔄 Re-scan
            </button>
          </div>
          {/* Date range controls */}
          <div style={{...S.card,padding:"12px 14px",marginBottom:16,fontSize:11}}>
            <div style={{color:"#60a5fa",fontWeight:600,marginBottom:8,fontSize:10,letterSpacing:"0.06em"}}>📅 DATE RANGE</div>
            {lastSyncDate?(
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{color:"#475569"}}>Reading emails since: <strong style={{color:"#94a3b8"}}>{lastSyncDate}</strong></span>
                <button onClick={()=>{setLastSyncDate(null);ls.del("cc_last_sync_date");log("📅 Date reset — will use days setting below","success");}} style={{background:"none",border:"1px solid #334155",color:"#475569",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>Reset date</button>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{color:"#475569"}}>First sync — look back:</span>
                {[15,30,60,90].map(d=>(
                  <button key={d} onClick={()=>setSyncDays(d)} style={{background:syncDays===d?"#1e40af":"none",border:`1px solid ${syncDays===d?"#3b82f6":"#1e293b"}`,color:syncDays===d?"#fff":"#475569",borderRadius:5,padding:"3px 10px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>{d} days</button>
                ))}
              </div>
            )}
            <div style={{color:"#1e3a5f",fontSize:10,marginTop:6}}>After each sync, only new emails are read — old ones are never re-processed</div>
          </div>
          {syncLog.length>0&&(
            <div style={{background:"#050810",border:"1px solid #0f172a",borderRadius:8,padding:"12px 14px",maxHeight:240,overflowY:"auto",fontFamily:"'DM Mono',monospace",fontSize:11}}>
              {syncLog.map((l,i)=><div key={i} style={{color:l.type==="error"?"#f87171":l.type==="success"?"#4ade80":l.type==="warn"?"#fb923c":"#475569",lineHeight:1.9}}><span style={{color:"#1e293b",marginRight:8}}>{l.t}</span>{l.msg}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({settings,onUpdate,onReset}){
  const[geminiKey,setGeminiKey]=useState(settings.geminiKey||"");
  const[googleClientId,setGoogleClientId]=useState(settings.googleClientId||"");
  const[saved,setSaved]=useState(false);
  const save=()=>{onUpdate({...settings,geminiKey:geminiKey.trim(),googleClientId:googleClientId.trim()});setSaved(true);setTimeout(()=>setSaved(false),2000);};
  return(
    <div>
      <div style={{marginBottom:20}}><label style={S.label}>Groq API Key</label><input type="password" value={geminiKey} onChange={e=>setGeminiKey(e.target.value)} style={{...S.input,marginBottom:6}}/><div style={{color:"#334155",fontSize:10}}><a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>console.groq.com/keys</a></div></div>
      <div style={{marginBottom:24}}><label style={S.label}>Google OAuth Client ID</label><input type="text" value={googleClientId} onChange={e=>setGoogleClientId(e.target.value)} placeholder="xxxxxxx.apps.googleusercontent.com" style={{...S.input,marginBottom:6}}/></div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button onClick={save} style={S.btn("#15803d")}>{saved?"✓ Saved!":"Save Settings"}</button>
        <button onClick={onReset} style={{background:"none",border:"1px solid #3b1111",color:"#f87171",borderRadius:8,padding:"10px 16px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Reset All Data</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App(){
  const[settings,setSettings]   = useState(()=>ls.get(SETTINGS_KEY));
  const[user,setUser]           = useState(null);      // Firebase auth user
  const[authReady,setAuthReady] = useState(false);
  const[records,setRecords]     = useState([]);
  const[vault,setVault]         = useState(()=>{ try{const v=JSON.parse(localStorage.getItem('cc_vault_v2')||'[]');return Array.isArray(v)?v:[];}catch{return [];} });
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

          if(fbRecords.length>0){ setRecords(fbRecords); console.log("[Firebase] Using Firebase records"); }

          if(fbMeta.settings) setSettings(s=>({...s,...fbMeta.settings}));
          if(fbMeta.processedIds) setProcessedIds(fbMeta.processedIds);
          console.log("[Firebase] All data loaded successfully ✓");
        }catch(e){
          console.error("[Firebase] Load FAILED:", e.code, e.message);
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

  const handleSaveKey=(s)=>{ setSettings(s); ls.set(SETTINGS_KEY,s); };

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

  const handleTogglePaid=(r)=>setRecords(prev=>prev.map(rec=>rec.id===r.id?{...rec,paid:!rec.paid}:rec));
  const handleDeleteRecord=(r)=>setRecords(prev=>prev.filter(rec=>rec.id!==r.id));

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
          const pwdList=resolvePasswords(vault,people,item.file.name,"","","","","");
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
  const TABS=[["gmail","⚡ Gmail Sync"],["upload","📂 Upload"],["tracker",`📋 Tracker (${records.length})`],["people",`👥 People (${people.length})`],["vault",`🔐 Vault (${vault.length})`],["settings","⚙ Settings"]];

  return(
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
        {activeTab==="gmail"&&<div style={{...S.card,padding:"24px"}}><h2 style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,marginBottom:4}}>Gmail Auto-Sync</h2><p style={{color:"#334155",fontSize:11,marginBottom:20}}>Auto-finds CC emails, matches vault passwords, extracts data.</p><GmailSyncPanel settings={settings} vault={vault} people={people} uid={user?.uid} onNewRecords={handleNewRecords} processedIds={processedIds} onProcessed={handleProcessed} onResetProcessed={()=>setProcessedIds([])}/></div>}

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
              </div>
              <div className="tbl-sc" style={{border:"1px solid #1e293b",borderRadius:10}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:640}}>
                  <thead><tr style={{background:"#0d1424"}}>{["#","Cardholder","Bank","Card","Due Date","Amount","Src","Status",""].map(h=><th key={h} style={{padding:"9px 10px",textAlign:"left",color:"#334155",fontWeight:500,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:"1px solid #1e293b",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {records.map((r,i)=>(
                      <tr key={r.firestoreId||r.id} className="row-h" style={{background:r.paid?"#071a0f":"#0a0e1a",opacity:r.paid?.6:1}}>
                        <td style={{padding:"9px 10px",color:"#334155"}}>{i+1}</td>
                        <td style={{padding:"9px 10px",color:"#e2e8f0",fontWeight:500,whiteSpace:"nowrap"}}>{r.cardholderName||<span style={{color:"#1e293b"}}>—</span>}</td>
                        <td style={{padding:"9px 10px",color:"#94a3b8",whiteSpace:"nowrap"}}>{r.bankName||"—"}</td>
                        <td style={{padding:"9px 10px"}}>{r.lastFourDigits?<span style={{background:"#1e293b",padding:"2px 6px",borderRadius:4,color:"#60a5fa",fontWeight:600}}>••••{r.lastFourDigits}</span>:"—"}</td>
                        <td style={{padding:"9px 10px",color:r.paid?"#64748b":"#fbbf24",fontWeight:500,whiteSpace:"nowrap"}}>{r.dueDate||"—"}</td>
                        <td style={{padding:"9px 10px",color:r.paid?"#4ade80":"#f87171",fontWeight:700,whiteSpace:"nowrap"}}>{r.dueAmount!=null?`${r.currency||""} ${Number(r.dueAmount).toLocaleString("en-IN",{minimumFractionDigits:2})}`:"—"}</td>
                        <td style={{padding:"9px 10px"}}><span style={{fontSize:9,color:r.source==="gmail"?"#60a5fa":"#334155"}}>{r.source==="gmail"?"📧":"📂"}</span></td>
                        <td style={{padding:"9px 10px"}}><button onClick={()=>handleTogglePaid(r)} style={{background:r.paid?"#052e16":"#1e293b",color:r.paid?"#4ade80":"#94a3b8",border:"none",borderRadius:5,padding:"3px 9px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>{r.paid?"✓ PAID":"PENDING"}</button></td>
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
  );
}
