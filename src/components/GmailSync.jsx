import { useState, useEffect } from "react";
import { ls } from "../utils/storage";
import { resolvePasswords, extractHintsFromEmail } from "../utils/passwords";
import { pdfBytesToBase64Image, tryPasswordsOnPDF, callGroq, fetchStatementEmails, fetchEmailWithAttachments, downloadAttachment } from "../utils/pdfGroqGmail";
import { PasswordModal, S } from "./Panels";

const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

export function GmailSyncPanel({settings,vault,people,bankRules,uid,onNewRecords,processedIds,onProcessed,onResetProcessed}){
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
          const{last4:emailLast4,last2:emailLast2,nameHint:emailName,emailNameHint,bank:emailBank,pwdFormatHint}=extractHintsFromEmail(subject,bodyText,toAddress);
          log(`   ↳ Hints — Bank: ${emailBank||"?"} · Card: ${emailLast4?"••••"+emailLast4:emailLast2?"••"+emailLast2:"?"} · Name: ${emailName||"?"} · Email: ${emailNameHint||"?"} · PwdFormat: ${pwdFormatHint||"unknown"}`);
          if(!emailLast4&&!emailLast2&&!emailName&&!emailNameHint) log(`   ↳ 📋 Body preview: "${(bodyText||"").slice(0,150).replace(/\n/g," ")}"`,"warn");
          for(const part of pdfParts){
            const fname=part.filename||"attachment.pdf";
            // Extract card prefix from filename e.g. "4315XXXXXXXX2004_..." → "4315"
            const fnamePrefix = fname.match(/^(\d{4})[Xx*]+\d{4}/)?.[1]||null;
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
            const pwdList=resolvePasswords(vault,people||[],bankRules,emailBank||subject,emailLast4,emailLast2,emailName,emailNameHint,pwdFormatHint,subject+" "+bodyText,fnamePrefix);
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

              // ── Post-process and clean extracted data ──────────────────────
              // Fix lastFourDigits — remove any X, x, * characters, keep only digits
              if(result.lastFourDigits){
                const digits = (result.lastFourDigits+"").replace(/[^0-9]/g,"");
                result.lastFourDigits = digits.length>=4 ? digits.slice(-4) : (digits||null);
              }
              // Use email-detected last4 if Groq returned garbage
              if(!result.lastFourDigits && emailLast4) result.lastFourDigits = emailLast4;

              // Fix cardholderName — remove MR/MRS/MS prefix, fix reversed names
              if(result.cardholderName){
                result.cardholderName = result.cardholderName
                  .replace(/^(MR\.?\s+|MRS\.?\s+|MS\.?\s+|DR\.?\s+)/i,"")
                  .trim();
              }

              // Fix dueAmount — if suspiciously large (>1 crore) might be in paise
              if(result.dueAmount && result.dueAmount > 1000000){
                result.dueAmount = Math.round(result.dueAmount / 100 * 100) / 100;
              }

              // Fix bankName — use email-detected bank if Groq missed it
              if(!result.bankName && emailBank) result.bankName = emailBank.toUpperCase();

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
