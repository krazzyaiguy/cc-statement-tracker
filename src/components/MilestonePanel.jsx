import { useState, useEffect } from "react";
import { S } from "./Panels";

// ─── MILESTONE / SPEND TRACKER ───────────────────────────────────────────────
// Tracks spend milestones per card (annual fee waiver, cashback tiers etc.)
// Period starts from card issue/renewal date (NOT April 1 like ITR)

const MILESTONE_KEY = "cc_milestones_v1";

const MILESTONE_TEMPLATES = [
  { label:"Annual Fee Waiver",  icon:"🎁", description:"Spend target to get annual fee reversed" },
  { label:"Cashback Tier",      icon:"💵", description:"Spend target to unlock higher cashback rate" },
  { label:"Reward Milestone",   icon:"⭐", description:"Spend target for bonus reward points" },
  { label:"Lounge Access",      icon:"✈️", description:"Spend target to unlock airport lounge visits" },
  { label:"Custom",             icon:"🎯", description:"Custom milestone" },
];

export function MilestonePanel() {
  const [milestones, setMilestones] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(MILESTONE_KEY)||"[]"); }catch{ return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  // Form state
  const [form, setForm] = useState({
    cardName:"", bankName:"", last4:"", cardholderName:"",
    milestoneType:"Annual Fee Waiver", targetAmount:"", startDate:"",
    currentSpend:"", notes:""
  });

  useEffect(()=>{
    localStorage.setItem(MILESTONE_KEY, JSON.stringify(milestones));
  }, [milestones]);

  const resetForm = () => setForm({
    cardName:"", bankName:"", last4:"", cardholderName:"",
    milestoneType:"Annual Fee Waiver", targetAmount:"", startDate:"",
    currentSpend:"", notes:""
  });

  const addMilestone = () => {
    if(!form.bankName||!form.targetAmount||!form.startDate) return;
    const m = {
      id: Date.now().toString(),
      ...form,
      targetAmount: parseFloat(form.targetAmount)||0,
      currentSpend: parseFloat(form.currentSpend)||0,
      createdAt: new Date().toISOString(),
      spendHistory: []
    };
    setMilestones(prev=>[...prev, m]);
    resetForm(); setShowAdd(false);
  };

  const addSpend = (id, amount, date, note) => {
    const amt = parseFloat(amount)||0;
    if(!amt) return;
    setMilestones(prev=>prev.map(m=>{
      if(m.id!==id) return m;
      const newSpend = m.currentSpend + amt;
      return {
        ...m,
        currentSpend: Math.round(newSpend*100)/100,
        spendHistory: [...(m.spendHistory||[]), {
          amount: amt, date, note: note||"",
          addedAt: new Date().toISOString()
        }]
      };
    }));
  };

  const deleteMilestone = (id) => {
    if(window.confirm("Delete this milestone?"))
      setMilestones(prev=>prev.filter(m=>m.id!==id));
  };

  const getDaysRemaining = (startDate) => {
    const start = new Date(startDate);
    const end = new Date(start);
    end.setFullYear(end.getFullYear()+1); // 1 year from start
    const today = new Date();
    return Math.ceil((end-today)/(86400000));
  };

  const getStatus = (m) => {
    const pct = m.targetAmount > 0 ? (m.currentSpend/m.targetAmount)*100 : 0;
    const remaining = m.targetAmount - m.currentSpend;
    const daysLeft = getDaysRemaining(m.startDate);
    const dailyNeeded = daysLeft > 0 ? remaining/daysLeft : 0;
    return { pct: Math.min(100,pct), remaining, daysLeft, dailyNeeded };
  };

  const fmt = (n) => `₹${Number(n).toLocaleString("en-IN",{maximumFractionDigits:0})}`;
  const fmtDec = (n) => `₹${Number(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return (
    <div>
      <p style={{color:"#475569",fontSize:12,marginBottom:20,lineHeight:1.7}}>
        Track spend milestones per card — annual fee waivers, cashback tiers, reward milestones.
        Each card tracks from its own <strong style={{color:"#94a3b8"}}>issue/renewal date</strong>, not April 1.
      </p>

      {/* Add button */}
      <button onClick={()=>{setShowAdd(!showAdd);resetForm();}}
        style={{...S.btn("#1d4ed8"),marginBottom:16}}>
        {showAdd?"✕ Cancel":"+ Add Card Milestone"}
      </button>

      {/* Add form */}
      {showAdd&&(
        <div style={{...S.card,padding:"16px",marginBottom:20}}>
          <div style={{color:"#60a5fa",fontSize:11,fontWeight:600,marginBottom:12,letterSpacing:"0.05em"}}>NEW MILESTONE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <div><label style={S.label}>Cardholder Name</label>
              <input value={form.cardholderName} onChange={e=>setForm(f=>({...f,cardholderName:e.target.value.toUpperCase()}))} placeholder="e.g. SNEHA SUNNY" style={S.input}/></div>
            <div><label style={S.label}>Bank Name *</label>
              <input value={form.bankName} onChange={e=>setForm(f=>({...f,bankName:e.target.value}))} placeholder="e.g. Axis Bank" style={S.input}/></div>
            <div><label style={S.label}>Card Name</label>
              <input value={form.cardName} onChange={e=>setForm(f=>({...f,cardName:e.target.value}))} placeholder="e.g. ACE, Swiggy" style={S.input}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <div><label style={S.label}>Last 4 Digits</label>
              <input value={form.last4} onChange={e=>setForm(f=>({...f,last4:e.target.value.replace(/\D/g,"").slice(0,4)}))} maxLength={4} placeholder="1234" style={{...S.input,letterSpacing:"0.2em"}}/></div>
            <div><label style={S.label}>Milestone Type</label>
              <select value={form.milestoneType} onChange={e=>setForm(f=>({...f,milestoneType:e.target.value}))} style={{...S.input,cursor:"pointer"}}>
                {MILESTONE_TEMPLATES.map(t=><option key={t.label} value={t.label}>{t.icon} {t.label}</option>)}
              </select></div>
            <div><label style={S.label}>Target Spend (₹) *</label>
              <input type="number" value={form.targetAmount} onChange={e=>setForm(f=>({...f,targetAmount:e.target.value}))} placeholder="200000" style={S.input}/></div>
            <div><label style={S.label}>Period Start Date *</label>
              <input type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} style={S.input}
                title="Card issue date or renewal date — NOT April 1"/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div><label style={S.label}>Current Spend Already Done (₹)</label>
              <input type="number" value={form.currentSpend} onChange={e=>setForm(f=>({...f,currentSpend:e.target.value}))} placeholder="0 if starting fresh" style={S.input}/></div>
            <div><label style={S.label}>Notes / Benefit</label>
              <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. Annual fee ₹499 reversed on ₹2L spend" style={S.input}/></div>
          </div>
          <button onClick={addMilestone} disabled={!form.bankName||!form.targetAmount||!form.startDate}
            style={S.btn("#15803d",!form.bankName||!form.targetAmount||!form.startDate)}>
            ✓ Add Milestone
          </button>
        </div>
      )}

      {/* Milestone cards */}
      {milestones.length===0&&!showAdd&&(
        <div style={{textAlign:"center",padding:"40px",color:"#334155",fontSize:12}}>
          <div style={{fontSize:36,marginBottom:10}}>🎯</div>
          No milestones yet. Add your first card milestone above.
        </div>
      )}

      {milestones.map(m=>{
        const {pct,remaining,daysLeft,dailyNeeded} = getStatus(m);
        const template = MILESTONE_TEMPLATES.find(t=>t.label===m.milestoneType)||MILESTONE_TEMPLATES[4];
        const isAchieved = m.currentSpend >= m.targetAmount;
        const isExpired  = daysLeft < 0;
        const isUrgent   = !isAchieved && !isExpired && daysLeft <= 30;
        const barColor   = isAchieved?"#4ade80":isExpired?"#475569":isUrgent?"#f97316":"#3b82f6";

        return (
          <div key={m.id} style={{...S.card,padding:"16px",marginBottom:12,
            border:`1px solid ${isAchieved?"#14532d":isExpired?"#1e293b":isUrgent?"#7c2d12":"#1e293b"}`}}>

            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:18}}>{template.icon}</span>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#e2e8f0"}}>
                    {m.bankName} {m.cardName&&`· ${m.cardName}`} {m.last4&&<span style={{color:"#60a5fa"}}>••••{m.last4}</span>}
                  </span>
                  {isAchieved&&<span style={{background:"#052e16",color:"#4ade80",fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>✓ ACHIEVED!</span>}
                  {isExpired&&!isAchieved&&<span style={{background:"#1e293b",color:"#475569",fontSize:9,padding:"2px 8px",borderRadius:10}}>EXPIRED</span>}
                  {isUrgent&&!isAchieved&&<span style={{background:"#7c2d12",color:"#fb923c",fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>⚠ {daysLeft}d left!</span>}
                </div>
                {m.cardholderName&&<div style={{color:"#475569",fontSize:11}}>👤 {m.cardholderName}</div>}
                <div style={{color:"#334155",fontSize:10,marginTop:2}}>{m.milestoneType} · Period: {m.startDate} → {(()=>{const d=new Date(m.startDate);d.setFullYear(d.getFullYear()+1);return d.toISOString().slice(0,10);})()} </div>
                {m.notes&&<div style={{color:"#475569",fontSize:10,marginTop:2,fontStyle:"italic"}}>💡 {m.notes}</div>}
              </div>
              <button onClick={()=>deleteMilestone(m.id)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:16}}>✕</button>
            </div>

            {/* Progress bar */}
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,fontSize:11}}>
                <span style={{color:"#94a3b8",fontWeight:600}}>{fmtDec(m.currentSpend)} <span style={{color:"#334155"}}>of {fmt(m.targetAmount)}</span></span>
                <span style={{color:barColor,fontWeight:700}}>{pct.toFixed(1)}%</span>
              </div>
              <div style={{height:8,background:"#0d1424",borderRadius:4}}>
                <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:4,transition:"width 0.5s"}}/>
              </div>
            </div>

            {/* Stats row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8,marginBottom:12}}>
              <div style={{background:"#080c14",borderRadius:6,padding:"8px 10px"}}>
                <div style={{color:"#334155",fontSize:9,marginBottom:2}}>REMAINING</div>
                <div style={{color:isAchieved?"#4ade80":"#f87171",fontWeight:700,fontSize:13}}>{isAchieved?"✓ Done":fmt(remaining)}</div>
              </div>
              <div style={{background:"#080c14",borderRadius:6,padding:"8px 10px"}}>
                <div style={{color:"#334155",fontSize:9,marginBottom:2}}>DAYS LEFT</div>
                <div style={{color:daysLeft<0?"#475569":daysLeft<=30?"#f97316":"#94a3b8",fontWeight:700,fontSize:13}}>{daysLeft<0?"Expired":`${daysLeft} days`}</div>
              </div>
              {!isAchieved&&!isExpired&&<div style={{background:"#080c14",borderRadius:6,padding:"8px 10px"}}>
                <div style={{color:"#334155",fontSize:9,marginBottom:2}}>NEED/DAY</div>
                <div style={{color:dailyNeeded>5000?"#f97316":"#94a3b8",fontWeight:700,fontSize:13}}>{fmt(dailyNeeded)}</div>
              </div>}
              <div style={{background:"#080c14",borderRadius:6,padding:"8px 10px"}}>
                <div style={{color:"#334155",fontSize:9,marginBottom:2}}>ENTRIES</div>
                <div style={{color:"#94a3b8",fontWeight:700,fontSize:13}}>{(m.spendHistory||[]).length} txns</div>
              </div>
            </div>

            {/* Add spend input */}
            {!isAchieved&&!isExpired&&(
              <AddSpendRow onAdd={(amt,date,note)=>addSpend(m.id,amt,date,note)}/>
            )}

            {/* Spend history */}
            {(m.spendHistory||[]).length>0&&(
              <details style={{marginTop:8}}>
                <summary style={{cursor:"pointer",color:"#3b82f6",fontSize:10,listStyle:"none"}}>
                  📋 View {m.spendHistory.length} spend entries
                </summary>
                <div style={{marginTop:8,border:"1px solid #1e293b",borderRadius:6,overflow:"hidden"}}>
                  {[...(m.spendHistory||[])].reverse().map((s,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",
                      borderBottom:i<m.spendHistory.length-1?"1px solid #0f1929":"none",fontSize:10}}>
                      <span style={{color:"#475569"}}>{s.date} {s.note&&`· ${s.note}`}</span>
                      <span style={{color:"#4ade80",fontWeight:600,fontFamily:"'DM Mono',monospace"}}>{fmtDec(s.amount)}</span>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0d1424",fontSize:10,fontWeight:700}}>
                    <span style={{color:"#475569"}}>Total</span>
                    <span style={{color:"#4ade80"}}>{fmtDec(m.currentSpend)}</span>
                  </div>
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddSpendRow({ onAdd }) {
  const [amt, setAmt]   = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [note, setNote] = useState("");

  const submit = () => {
    if(!amt) return;
    onAdd(amt, date, note);
    setAmt(""); setNote("");
  };

  return (
    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:4}}>
      <input type="number" value={amt} onChange={e=>setAmt(e.target.value)}
        placeholder="Add spend ₹" style={{...S.input,width:110,padding:"6px 8px",fontSize:11}}
        onKeyDown={e=>e.key==="Enter"&&submit()}/>
      <input type="date" value={date} onChange={e=>setDate(e.target.value)}
        style={{...S.input,width:120,padding:"6px 8px",fontSize:11}}/>
      <input value={note} onChange={e=>setNote(e.target.value)}
        placeholder="Note (optional)" style={{...S.input,flex:1,minWidth:80,padding:"6px 8px",fontSize:11}}
        onKeyDown={e=>e.key==="Enter"&&submit()}/>
      <button onClick={submit} disabled={!amt}
        style={{...S.btn("#15803d",!amt),padding:"6px 12px",fontSize:11}}>+ Add</button>
    </div>
  );
}
