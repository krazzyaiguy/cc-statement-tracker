import { useState, useEffect } from "react";
import { S } from "./Panels";

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
