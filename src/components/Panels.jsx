import { useState, useRef, useEffect } from "react";
import { DEFAULT_BANK_RULES, generatePasswords } from "../utils/passwords";

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
export const S={
  card:{background:"#0d1424",border:"1px solid #1e293b",borderRadius:12},
  input:{width:"100%",background:"#0a0e1a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",color:"#e2e8f0",fontFamily:"'DM Mono',monospace",fontSize:13,outline:"none"},
  btn:(color="#1d4ed8",disabled=false)=>({background:disabled?"#1e293b":color,color:disabled?"#475569":"#fff",border:"none",borderRadius:8,padding:"10px 20px",cursor:disabled?"not-allowed":"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,opacity:disabled?0.5:1,transition:"opacity 0.15s"}),
  label:{color:"#64748b",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",display:"block",marginBottom:6},
};

// ─── BADGE ────────────────────────────────────────────────────────────────────
export function Badge({status}){
  const map={pending:["#1e293b","#94a3b8","Pending"],"needs-password":["#2d1b0e","#fb923c","🔒 Locked"],processing:["#1e3a5f","#60a5fa","Extracting…"],done:["#052e16","#4ade80","✓ Done"],error:["#3b1111","#f87171","Error"],skipped:["#1e293b","#475569","Skipped"]};
  const[bg,color,label]=map[status]||map.pending;
  return<span style={{fontSize:10,fontWeight:600,letterSpacing:"0.06em",padding:"2px 9px",borderRadius:20,background:bg,color,textTransform:"uppercase",whiteSpace:"nowrap"}}>{label}</span>;
}

// ─── PASSWORD MODAL ───────────────────────────────────────────────────────────
export function PasswordModal({file,hint,onSubmit,onSkip}){
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

export function VaultPanel({vault,uid,onAdd,onUpdate,onDelete}){
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
export function PeoplePanel({people, uid, onAdd, onUpdate, onDelete}) {
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
              <input value={card.last4} onChange={e=>updateCard(i,"last4",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="Last 4" maxLength={4} style={{...S.input,width:80,letterSpacing:"0.2em",fontSize:14,fontWeight:700,textAlign:"center"}}/>
              <input value={card.prefix||""} onChange={e=>updateCard(i,"prefix",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="First 4" maxLength={4} title="Optional: first 4 digits of card (e.g. 4315)" style={{...S.input,width:70,letterSpacing:"0.1em",fontSize:11,color:"#475569"}}/>
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
                        <input value={card.last4} onChange={e=>updateEditCard(i,"last4",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="Last 4" maxLength={4} style={{...S.input,width:80,letterSpacing:"0.2em",fontSize:14,fontWeight:700,textAlign:"center"}}/>
                        <input value={card.prefix||""} onChange={e=>updateEditCard(i,"prefix",e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="First 4" maxLength={4} title="Optional: first 4 digits (e.g. 4315)" style={{...S.input,width:70,letterSpacing:"0.1em",fontSize:11,color:"#475569"}}/>
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
// ─── GMAIL SYNC PANEL ─────────────────────────────────────────────────────────

// ── BANK RULES PANEL ─────────────────────────────────────────────────────────
export const FORMULA_OPTIONS = [
  // ── UPPERCASE (most banks) ───────────────────────────────────────────────
  { value:"name4+ddmm",         label:"UPPERCASE: Name(4) + DDMM",      example:"RAVI0512" },
  { value:"name4+mmdd",         label:"UPPERCASE: Name(4) + MMDD",      example:"RAVI1205" },
  { value:"name4+ddmmyy",       label:"UPPERCASE: Name(4) + DDMMYY",    example:"ANSH140987" },
  { value:"name4+ddmmyyyy",     label:"UPPERCASE: Name(4) + DDMMYYYY",  example:"RAVI05121975" },
  { value:"name4+yyyy",         label:"UPPERCASE: Name(4) + YYYY",      example:"RAVI1975" },
  { value:"name4+last4",        label:"UPPERCASE: Name(4) + Last4",     example:"SHUB2308" },
  // ── LOWERCASE (ICICI and some others) ────────────────────────────────────
  { value:"name4l+ddmm",        label:"lowercase: name(4) + DDMM",      example:"ravi0512" },
  { value:"name4l+mmdd",        label:"lowercase: name(4) + MMDD",      example:"ravi1205" },
  { value:"name4l+ddmmyy",      label:"lowercase: name(4) + DDMMYY",    example:"ansh140987" },
  { value:"name4l+ddmmyyyy",    label:"lowercase: name(4) + DDMMYYYY",  example:"ravi05121975" },
  { value:"name4l+yyyy",        label:"lowercase: name(4) + YYYY",      example:"ravi1975" },
  { value:"name4l+last4",       label:"lowercase: name(4) + Last4",     example:"shub2308" },
  // ── DATE + CARD (SBI style) ──────────────────────────────────────────────
  { value:"ddmmyyyy+last4",     label:"DDMMYYYY + Last4 (SBI)",          example:"01041980 1234" },
  { value:"ddmmyy+last4",       label:"DDMMYY + Last4",                  example:"010480 1234" },
  { value:"ddmm+last4",         label:"DDMM + Last4",                    example:"0104 1234" },
  // ── DATE ONLY ─────────────────────────────────────────────────────────────
  { value:"ddmm",               label:"DDMM only (no name)",             example:"0512" },
  { value:"ddmmyy",             label:"DDMMYY only",                     example:"051275" },
  { value:"ddmmyyyy",           label:"DDMMYYYY only",                   example:"05121975" },
];

export function BankRulesPanel({ rules, onUpdate }) {
  const [editId, setEditId] = useState(null);
  const [editFormula, setEditFormula] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [addBank, setAddBank] = useState("");
  const [addFormula, setAddFormula] = useState("name4+ddmm");
  const [addNotes, setAddNotes] = useState("");

  const startEdit = (rule) => { setEditId(rule.id); setEditFormula(rule.formula); setEditNotes(rule.notes||""); };
  const saveEdit = () => {
    onUpdate(rules.map(r=>r.id===editId?{...r,formula:editFormula,notes:editNotes}:r));
    setEditId(null);
  };
  const addRule = () => {
    if(!addBank.trim()) return;
    const newRule = { id: addBank.toLowerCase().replace(/\s+/g,"-")+"-"+Date.now(), bankName:addBank.trim(), formula:addFormula, notes:addNotes };
    onUpdate([...rules, newRule]);
    setAddBank(""); setAddFormula("name4+ddmm"); setAddNotes("");
  };
  const removeRule = (id) => onUpdate(rules.filter(r=>r.id!==id));
  const resetDefaults = () => { if(window.confirm("Reset to default bank rules?")) onUpdate(DEFAULT_BANK_RULES); };

  return (
    <div>
      <p style={{color:"#475569",fontSize:12,lineHeight:1.8,marginBottom:16}}>
        Define the exact password formula for each bank. The app will try <strong style={{color:"#94a3b8"}}>only these combinations</strong> — no more 80 wrong attempts.
      </p>

      {/* Add custom bank */}
      <div style={{...S.card,padding:"14px",marginBottom:16}}>
        <div style={{color:"#60a5fa",fontSize:11,fontWeight:600,marginBottom:12,letterSpacing:"0.05em"}}>+ ADD BANK RULE</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div><label style={S.label}>Bank Name</label>
            <input value={addBank} onChange={e=>setAddBank(e.target.value)} placeholder="e.g. HDFC, SBI" style={S.input}/>
          </div>
          <div><label style={S.label}>Password Formula</label>
            <select value={addFormula} onChange={e=>setAddFormula(e.target.value)}
              style={{...S.input,cursor:"pointer"}}>
              {FORMULA_OPTIONS.map(f=><option key={f.value} value={f.value}>{f.label} → {f.example}</option>)}
            </select>
          </div>
        </div>
        <div style={{marginBottom:10}}>
          <label style={S.label}>Notes (optional)</label>
          <input value={addNotes} onChange={e=>setAddNotes(e.target.value)} placeholder="e.g. e-statement@hdfc.com" style={S.input}/>
        </div>
        <button onClick={addRule} disabled={!addBank.trim()} style={S.btn("#1d4ed8",!addBank.trim())}>+ Add Rule</button>
      </div>

      {/* Rules list */}
      <div style={{border:"1px solid #1e293b",borderRadius:10,overflow:"hidden",marginBottom:12}}>
        {rules.map((rule,idx)=>(
          <div key={rule.id} style={{background:"#0a0e1a",borderBottom:idx<rules.length-1?"1px solid #0f1929":"none"}}>
            {editId===rule.id ? (
              <div style={{padding:"12px 14px"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={S.label}>Formula</label>
                    <select value={editFormula} onChange={e=>setEditFormula(e.target.value)} style={{...S.input,cursor:"pointer"}}>
                      {FORMULA_OPTIONS.map(f=><option key={f.value} value={f.value}>{f.label} → {f.example}</option>)}
                    </select>
                  </div>
                  <div><label style={S.label}>Notes</label>
                    <input value={editNotes} onChange={e=>setEditNotes(e.target.value)} style={S.input}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveEdit} style={S.btn("#15803d")}>✓ Save</button>
                  <button onClick={()=>setEditId(null)} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",fontSize:12}}>
                <div style={{minWidth:100,color:"#e2e8f0",fontWeight:600}}>{rule.bankName}</div>
                <div style={{flex:1}}>
                  <span style={{background:"#1e3a5f",color:"#60a5fa",padding:"2px 8px",borderRadius:5,fontSize:11,fontFamily:"'DM Mono',monospace"}}>{rule.formula}</span>
                  {rule.notes&&<span style={{color:"#334155",fontSize:10,marginLeft:8}}>{rule.notes}</span>}
                </div>
                <button onClick={()=>startEdit(rule)} style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:11,padding:"0 4px"}}>✏</button>
                <button onClick={()=>removeRule(rule.id)} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13,padding:"0 4px"}}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <button onClick={resetDefaults} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>↺ Reset to Defaults</button>
      <div style={{color:"#1e3a5f",fontSize:10,marginTop:8,lineHeight:1.7}}>
        💡 When the bank is detected from email, the app uses ONLY this formula — no guessing needed<br/>
        📧 Bank is detected from email subject e.g. "RBL Bank" → uses RBL rule
      </div>
    </div>
  );
}

export function SettingsPanel({settings,onUpdate,onReset}){
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


// ─── ITR REPAYMENT TRACKER ────────────────────────────────────────────────────
// Tracks credit card repayments per person per bank for ITR reporting
// Financial year: April to March
// RBI rule: bank reports to ITR if total repayment >= 10L per person per bank

const ITR_KEY = "cc_itr_v1";

function getCurrentFY() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  return month >= 4 ? `${year}-${year+1}` : `${year-1}-${year}`;
}

function getFYRange(fy) {
  const [startY] = fy.split("-").map(Number);
  return {
    start: new Date(startY, 3, 1),    // April 1
    end:   new Date(startY+1, 2, 31)  // March 31
  };
}

export function ITRPanel({ records, onAddPayment }) {
  const [fy, setFY] = useState(getCurrentFY());
  const [itrData, setItrData] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(ITR_KEY)||"{}"); }catch{ return {}; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [manualPerson, setManualPerson] = useState("");
  const [manualBank, setManualBank] = useState("");
  const [manualAmt, setManualAmt] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0,10));

  // Save to localStorage whenever data changes
  useEffect(()=>{
    try{ localStorage.setItem(ITR_KEY, JSON.stringify(itrData)); }catch{}
  }, [itrData]);

  // Get all FYs available
  const allFYs = [...new Set([getCurrentFY(), ...Object.keys(itrData)])].sort().reverse();

  // Get payments for current FY
  const currentData = itrData[fy] || {};

  // Build summary: { personName: { bankName: { total, payments:[] } } }
  const summary = {};
  Object.entries(currentData).forEach(([person, banks])=>{
    summary[person] = {};
    Object.entries(banks).forEach(([bank, data])=>{
      summary[person][bank] = {
        total: data.payments?.reduce((s,p)=>s+p.amount,0)||0,
        payments: data.payments||[]
      };
    });
  });

  const addPayment = (person, bank, amount, date) => {
    const amt = parseFloat(amount)||0;
    if(!amt||!person||!bank) return;
    setItrData(prev=>{
      const d = JSON.parse(JSON.stringify(prev));
      if(!d[fy]) d[fy]={};
      if(!d[fy][person]) d[fy][person]={};
      if(!d[fy][person][bank]) d[fy][person][bank]={payments:[]};
      d[fy][person][bank].payments.push({ amount:amt, date, addedAt:new Date().toISOString() });
      return d;
    });
  };

  const removePayment = (person, bank, idx) => {
    setItrData(prev=>{
      const d = JSON.parse(JSON.stringify(prev));
      d[fy]?.[person]?.[bank]?.payments?.splice(idx,1);
      return d;
    });
  };

  const WARNING = 800000;  // ₹8L warning
  const LIMIT   = 1000000; // ₹10L limit

  const fmt = (n) => `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:0})}`;

  const statusColor = (total) =>
    total >= LIMIT   ? "#ef4444" :
    total >= WARNING ? "#f97316" : "#4ade80";

  const statusLabel = (total) =>
    total >= LIMIT   ? "🚨 OVER 10L" :
    total >= WARNING ? "⚠️ Near limit" : "✅ Safe";

  return (
    <div>
      <p style={{color:"#475569",fontSize:12,marginBottom:16,lineHeight:1.7}}>
        Tracks credit card repayments per person per bank for ITR. Banks report to IT dept if repayments ≥ ₹10L/year per person.
        <span style={{color:"#f97316"}}> Payments auto-captured when you record partial payments in Tracker.</span>
      </p>

      {/* FY selector */}
      <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{color:"#475569",fontSize:11}}>Financial Year:</span>
        {allFYs.map(f=>(
          <button key={f} onClick={()=>setFY(f)}
            style={{background:fy===f?"#1e40af":"none",border:`1px solid ${fy===f?"#3b82f6":"#1e293b"}`,
              color:fy===f?"#fff":"#475569",borderRadius:6,padding:"4px 12px",cursor:"pointer",
              fontFamily:"'DM Mono',monospace",fontSize:11}}>
            {f} {f===getCurrentFY()&&<span style={{color:"#4ade80",fontSize:9}}> ◉ current</span>}
          </button>
        ))}
        <button onClick={()=>setFY(`${parseInt(fy)-1}-${parseInt(fy)}`)}
          style={{background:"none",border:"1px solid #1e293b",color:"#334155",borderRadius:6,
            padding:"4px 10px",cursor:"pointer",fontSize:11}}>+ Earlier FY</button>
      </div>

      {/* Summary cards per person */}
      {Object.keys(summary).length===0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:"#334155",fontSize:12}}>
          No repayment data for FY {fy}.<br/>
          <span style={{color:"#475569",fontSize:11}}>Payments are auto-added when you record payments in 📋 Tracker tab.</span>
        </div>
      ) : (
        Object.entries(summary).sort((a,b)=>a[0].localeCompare(b[0])).map(([person, banks])=>{
          const totalAll = Object.values(banks).reduce((s,b)=>s+b.total,0);
          return (
            <div key={person} style={{...S.card,padding:"16px",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#e2e8f0"}}>
                  👤 {person}
                </div>
                <div style={{color:"#475569",fontSize:11}}>Total repaid FY{fy}: <strong style={{color:"#94a3b8"}}>{fmt(totalAll)}</strong></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                {Object.entries(banks).sort((a,b)=>b[1].total-a[1].total).map(([bank, data])=>{
                  const pct = Math.min(100, (data.total/LIMIT)*100);
                  return (
                    <div key={bank} style={{background:"#080c14",border:`1px solid ${data.total>=LIMIT?"#7f1d1d":data.total>=WARNING?"#7c2d12":"#1e293b"}`,borderRadius:8,padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <span style={{color:"#94a3b8",fontWeight:600,fontSize:12,textTransform:"uppercase"}}>{bank}</span>
                        <span style={{fontSize:10,color:statusColor(data.total)}}>{statusLabel(data.total)}</span>
                      </div>
                      <div style={{fontSize:16,fontWeight:700,color:statusColor(data.total),marginBottom:6}}>{fmt(data.total)}</div>
                      {/* Progress bar */}
                      <div style={{height:4,background:"#0d1424",borderRadius:2,marginBottom:6}}>
                        <div style={{height:"100%",width:`${pct}%`,background:statusColor(data.total),borderRadius:2,transition:"width 0.3s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#334155"}}>
                        <span>{data.payments.length} payment{data.payments.length!==1?"s":""}</span>
                        <span>{fmt(LIMIT-data.total)} remaining</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* Manual add payment */}
      <div style={{...S.card,padding:"14px",marginTop:8}}>
        <button onClick={()=>setShowAdd(!showAdd)}
          style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:12,padding:0,fontFamily:"'DM Mono',monospace"}}>
          {showAdd?"▲ Hide":"▼ Add Manual Payment"}
        </button>
        {showAdd&&(
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
            <div>
              <label style={S.label}>Person Name</label>
              <input value={manualPerson} onChange={e=>setManualPerson(e.target.value)} placeholder="e.g. SNEHA SUNNY" style={S.input}/>
            </div>
            <div>
              <label style={S.label}>Bank</label>
              <input value={manualBank} onChange={e=>setManualBank(e.target.value)} placeholder="e.g. HDFC" style={S.input}/>
            </div>
            <div>
              <label style={S.label}>Amount Paid (₹)</label>
              <input type="number" value={manualAmt} onChange={e=>setManualAmt(e.target.value)} placeholder="e.g. 50000" style={S.input}/>
            </div>
            <div>
              <label style={S.label}>Date</label>
              <input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)} style={S.input}/>
            </div>
            <button onClick={()=>{
              if(manualPerson&&manualBank&&manualAmt){
                addPayment(manualPerson.trim().toUpperCase(), manualBank.trim().toUpperCase(), manualAmt, manualDate);
                setManualAmt(""); setShowAdd(false);
              }
            }} style={S.btn("#15803d")}>+ Add</button>
          </div>
        )}
      </div>

      <div style={{color:"#1e3a5f",fontSize:10,marginTop:12,lineHeight:1.8}}>
        💡 Data stored per financial year (Apr-Mar) · Never auto-deleted · ₹10L limit is per person per bank<br/>
        📊 Payments auto-captured from Tracker when you press Enter in the "pay" column
      </div>
    </div>
  );
}
