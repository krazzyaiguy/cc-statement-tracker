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

// Pre-filled bank milestone data for quick setup
// Source: Official bank websites & verified sources (March 2026)
export const BANK_MILESTONES = [
  // ── HDFC ──────────────────────────────────────────────────────────────────
  { bank:"HDFC", card:"Millennia",      fee:1000,  waiver:100000,  note:"Annual fee ₹1,000 waived on ₹1L spend" },
  { bank:"HDFC", card:"MoneyBack+",     fee:500,   waiver:50000,   note:"Annual fee ₹500 waived on ₹50K spend" },
  { bank:"HDFC", card:"Regalia Gold",   fee:2500,  waiver:150000,  note:"Annual fee ₹2,500 waived on ₹1.5L spend" },
  { bank:"HDFC", card:"Swiggy",         fee:500,   waiver:200000,  note:"Annual fee ₹500 waived on ₹2L spend" },
  { bank:"HDFC", card:"IRCTC",          fee:500,   waiver:50000,   note:"Annual fee ₹500 waived on ₹50K spend" },
  { bank:"HDFC", card:"Diners Privilege",fee:2500, waiver:300000,  note:"Annual fee ₹2,500 waived on ₹3L spend" },
  { bank:"HDFC", card:"Infinia",        fee:12500, waiver:1000000, note:"Annual fee ₹12,500 waived on ₹10L spend (changing to ₹18L from Apr 2027)" },
  { bank:"HDFC", card:"Diners Black",   fee:10000, waiver:800000,  note:"Annual fee ₹10,000 waived on ₹8L spend" },
  // ── SBI ───────────────────────────────────────────────────────────────────
  { bank:"SBI",  card:"SimplyCLICK",    fee:499,   waiver:100000,  note:"Annual fee ₹499 waived on ₹1L spend" },
  { bank:"SBI",  card:"BPCL",           fee:499,   waiver:50000,   note:"Annual fee ₹499 waived on ₹50K spend" },
  { bank:"SBI",  card:"BPCL Octane",    fee:1499,  waiver:200000,  note:"Annual fee ₹1,499 waived on ₹2L spend" },
  { bank:"SBI",  card:"Prime",          fee:2999,  waiver:300000,  note:"Annual fee ₹2,999 waived on ₹3L spend" },
  { bank:"SBI",  card:"Elite",          fee:4999,  waiver:500000,  note:"Annual fee ₹4,999 waived on ₹5L spend" },
  { bank:"SBI",  card:"Cashback",       fee:999,   waiver:200000,  note:"Annual fee ₹999 waived on ₹2L spend" },
  // ── ICICI ─────────────────────────────────────────────────────────────────
  { bank:"ICICI",card:"Coral",          fee:500,   waiver:125000,  note:"Annual fee ₹500 waived on ₹1.25L spend" },
  { bank:"ICICI",card:"Rubyx",          fee:2000,  waiver:300000,  note:"Annual fee ₹2,000 waived on ₹3L spend" },
  { bank:"ICICI",card:"Sapphiro",       fee:3500,  waiver:600000,  note:"Annual fee ₹3,500 waived on ₹6L spend" },
  { bank:"ICICI",card:"Emeralde",       fee:12000, waiver:1000000, note:"Annual fee ₹12,000 waived on ₹10L spend" },
  { bank:"ICICI",card:"Amazon Pay",     fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  // ── AXIS ──────────────────────────────────────────────────────────────────
  { bank:"Axis", card:"ACE",            fee:499,   waiver:200000,  note:"Annual fee ₹499 waived on ₹2L spend (rent/wallet excluded)" },
  { bank:"Axis", card:"Flipkart",       fee:500,   waiver:200000,  note:"Annual fee ₹500 waived on ₹2L spend" },
  { bank:"Axis", card:"Magnus",         fee:12500, waiver:1500000, note:"Annual fee ₹12,500 waived on ₹15L spend" },
  { bank:"Axis", card:"Atlas",          fee:4999,  waiver:750000,  note:"Annual fee ₹4,999 waived on ₹7.5L spend" },
  { bank:"Axis", card:"Vistara Signature",fee:3000,waiver:300000,  note:"Annual fee ₹3,000 waived on ₹3L spend" },
  // ── RBL ───────────────────────────────────────────────────────────────────
  { bank:"RBL",  card:"Shoprite",       fee:500,   waiver:150000,  note:"Annual fee ₹500 waived on ₹1.5L spend" },
  { bank:"RBL",  card:"Platinum Maxima",fee:2000,  waiver:200000,  note:"Annual fee ₹2,000 waived on ₹2L spend" },
  { bank:"RBL",  card:"World Safari",   fee:3000,  waiver:500000,  note:"Annual fee ₹3,000 waived on ₹5L spend" },
  // ── IDFC FIRST ────────────────────────────────────────────────────────────
  { bank:"IDFC", card:"Classic",        fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  { bank:"IDFC", card:"Select",         fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  { bank:"IDFC", card:"Wealth",         fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  { bank:"IDFC", card:"First WOW",      fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  // ── IndusInd ──────────────────────────────────────────────────────────────
  { bank:"IndusInd",card:"Platinum",    fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  { bank:"IndusInd",card:"Legend",      fee:3000,  waiver:300000,  note:"Annual fee ₹3,000 waived on ₹3L spend" },
  { bank:"IndusInd",card:"Nexxt",       fee:1500,  waiver:150000,  note:"Annual fee ₹1,500 waived on ₹1.5L spend" },
  // ── Kotak ─────────────────────────────────────────────────────────────────
  { bank:"Kotak", card:"811",           fee:0,     waiver:0,       note:"Lifetime free — no annual fee" },
  { bank:"Kotak", card:"Zen Signature", fee:1500,  waiver:100000,  note:"Annual fee ₹1,500 waived on ₹1L spend" },
  { bank:"Kotak", card:"League Platinum",fee:999,  waiver:50000,   note:"Annual fee ₹999 waived on ₹50K spend" },
  // ── AU Small Finance ──────────────────────────────────────────────────────
  { bank:"AU",   card:"LIT",            fee:499,   waiver:40000,   note:"Annual fee ₹499 waived on ₹40K spend" },
  { bank:"AU",   card:"Altura Plus",    fee:499,   waiver:40000,   note:"Annual fee ₹499 waived on ₹40K spend" },
];

export function MilestonePanel() {
  const [milestones, setMilestones] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(MILESTONE_KEY)||"[]"); }catch{ return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
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
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <button onClick={()=>{setShowAdd(!showAdd);resetForm();setShowQuick(false);}}
          style={S.btn("#1d4ed8")}>
          {showAdd?"✕ Cancel":"+ Add Custom Milestone"}
        </button>
        <button onClick={()=>{setShowQuick(!showQuick);setShowAdd(false);}}
          style={{...S.btn("#7c3aed"),background:showQuick?"#4c1d95":"#7c3aed"}}>
          {showQuick?"✕ Close":"⚡ Quick Add from Bank List"}
        </button>
      </div>

      {/* Quick add from bank list */}
      {showQuick&&(
        <div style={{...S.card,padding:"16px",marginBottom:20}}>
          <div style={{color:"#a78bfa",fontSize:11,fontWeight:600,marginBottom:12,letterSpacing:"0.05em"}}>⚡ QUICK ADD — SELECT YOUR CARD</div>
          <input value={quickFilter} onChange={e=>setQuickFilter(e.target.value)}
            placeholder="Search bank or card name..." style={{...S.input,marginBottom:12}}/>
          <div style={{maxHeight:300,overflowY:"auto"}}>
            {BANK_MILESTONES
              .filter(m=>!quickFilter||m.bank.toLowerCase().includes(quickFilter.toLowerCase())||m.card.toLowerCase().includes(quickFilter.toLowerCase()))
              .map((m,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"8px 10px",borderBottom:"1px solid #0f1929",background:"#0a0e1a"}}>
                  <div>
                    <span style={{color:"#94a3b8",fontWeight:600,fontSize:12}}>{m.bank} {m.card}</span>
                    <div style={{color:"#334155",fontSize:10,marginTop:2}}>{m.note}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {m.waiver>0
                      ?<span style={{color:"#4ade80",fontSize:11,fontWeight:600,fontFamily:"'DM Mono',monospace"}}>₹{(m.waiver/100000).toFixed(1)}L</span>
                      :<span style={{color:"#475569",fontSize:10}}>Free</span>}
                    {m.waiver>0&&<button onClick={()=>{
                      setForm(f=>({...f,bankName:m.bank,cardName:m.card,
                        milestoneType:"Annual Fee Waiver",
                        targetAmount:m.waiver.toString(),
                        notes:m.note}));
                      setShowQuick(false);setShowAdd(true);
                    }} style={{...S.btn("#1d4ed8"),padding:"4px 10px",fontSize:10}}>Select →</button>}
                  </div>
                </div>
              ))}
          </div>
          <div style={{color:"#1e3a5f",fontSize:10,marginTop:8}}>
            Data sourced from official bank websites · March 2026 · Always verify with your bank for latest terms
          </div>
        </div>
      )}

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
