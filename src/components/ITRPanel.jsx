import { useState, useEffect } from "react";
import { S } from "./Panels";

const ITR_KEY = "cc_itr_v1";

function getCurrentFY() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();
  return month >= 4 ? `${year}-${year+1}` : `${year-1}-${year}`;
}

export function ITRPanel() {
  const [fy, setFY]           = useState(getCurrentFY());
  const [itrData, setItrData] = useState(()=>{ try{ return JSON.parse(localStorage.getItem(ITR_KEY)||"{}"); }catch{ return {}; } });
  const [showAdd, setShowAdd] = useState(false);
  const [manualPerson, setManualPerson] = useState("");
  const [manualBank,   setManualBank]   = useState("");
  const [manualAmt,    setManualAmt]    = useState("");
  const [manualDate,   setManualDate]   = useState(new Date().toISOString().slice(0,10));
  const [renamingPerson, setRenamingPerson] = useState(null);
  const [renameVal,      setRenameVal]      = useState("");
  const [renamingBank,   setRenamingBank]   = useState(null);
  const [renameBankVal,  setRenameBankVal]  = useState("");
  const [expandedKey,    setExpandedKey]    = useState(null);

  useEffect(()=>{ try{ localStorage.setItem(ITR_KEY, JSON.stringify(itrData)); }catch{} }, [itrData]);

  const allFYs = [...new Set([getCurrentFY(), ...Object.keys(itrData)])].sort().reverse();
  const currentData = itrData[fy] || {};

  const summary = {};
  Object.entries(currentData).forEach(([person, banks])=>{
    summary[person] = {};
    Object.entries(banks).forEach(([bank, data])=>{
      summary[person][bank] = { total: data.payments?.reduce((s,p)=>s+p.amount,0)||0, payments: data.payments||[] };
    });
  });

  const renamePerson = (oldName, newName) => {
    const n = newName.trim().toUpperCase();
    if(!n||n===oldName){ setRenamingPerson(null); return; }
    setItrData(prev=>{
      const d = JSON.parse(JSON.stringify(prev));
      if(!d[fy]) return d;
      if(!d[fy][n]) d[fy][n]={};
      Object.entries(d[fy][oldName]||{}).forEach(([bank,bdata])=>{
        if(!d[fy][n][bank]) d[fy][n][bank]={payments:[]};
        d[fy][n][bank].payments=[...d[fy][n][bank].payments,...bdata.payments];
      });
      delete d[fy][oldName];
      return d;
    });
    setRenamingPerson(null);
  };

  const renameBank = (person, oldBank, newBank) => {
    const n = newBank.trim().toUpperCase();
    if(!n||n===oldBank){ setRenamingBank(null); return; }
    setItrData(prev=>{
      const d = JSON.parse(JSON.stringify(prev));
      if(!d[fy]?.[person]) return d;
      if(!d[fy][person][n]) d[fy][person][n]={payments:[]};
      d[fy][person][n].payments=[...d[fy][person][n].payments,...(d[fy][person][oldBank]?.payments||[])];
      delete d[fy][person][oldBank];
      return d;
    });
    setRenamingBank(null);
  };

  const deletePayment = (person, bank, idx) => {
    setItrData(prev=>{
      const d=JSON.parse(JSON.stringify(prev));
      d[fy]?.[person]?.[bank]?.payments?.splice(idx,1);
      return d;
    });
  };

  const addPayment = (person, bank, amount, date) => {
    const amt=parseFloat(amount)||0;
    if(!amt||!person||!bank) return;
    setItrData(prev=>{
      const d=JSON.parse(JSON.stringify(prev));
      if(!d[fy]) d[fy]={};
      if(!d[fy][person]) d[fy][person]={};
      if(!d[fy][person][bank]) d[fy][person][bank]={payments:[]};
      d[fy][person][bank].payments.push({amount:amt,date,addedAt:new Date().toISOString()});
      return d;
    });
  };

  const WARNING=800000, LIMIT=1000000;
  const fmt=(n)=>`${Number(n).toLocaleString("en-IN",{maximumFractionDigits:0})}`;
  const fmtDec=(n)=>`${Number(n).toLocaleString("en-IN",{minimumFractionDigits:2})}`;
  const sColor=(t)=>t>=LIMIT?"#ef4444":t>=WARNING?"#f97316":"#4ade80";
  const sLabel=(t)=>t>=LIMIT?"OVER 10L":t>=WARNING?"Near limit":"Safe";

  return (
    <div>
      <p style={{color:"#475569",fontSize:12,marginBottom:16,lineHeight:1.7}}>
        Tracks repayments per person per bank for ITR. Banks report to IT dept if repayments exceed 10L/year.
        <span style={{color:"#f97316"}}> Click any name or bank to rename or merge entries.</span>
      </p>

      <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{color:"#475569",fontSize:11}}>Financial Year:</span>
        {allFYs.map(f=>(
          <button key={f} onClick={()=>setFY(f)} style={{background:fy===f?"#1e40af":"none",border:`1px solid ${fy===f?"#3b82f6":"#1e293b"}`,color:fy===f?"#fff":"#475569",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>
            {f}{f===getCurrentFY()&&<span style={{color:"#4ade80",fontSize:9}}> ◉</span>}
          </button>
        ))}
        <button onClick={()=>setFY(`${parseInt(fy)-1}-${parseInt(fy)}`)} style={{background:"none",border:"1px solid #1e293b",color:"#334155",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11}}>+ Earlier FY</button>
      </div>

      {Object.keys(summary).length===0 ? (
        <div style={{textAlign:"center",padding:"40px",color:"#334155",fontSize:12}}>
          No repayment data for FY {fy}.<br/>
          <span style={{color:"#475569",fontSize:11}}>Payments auto-added when you record payments in Tracker tab.</span>
        </div>
      ) : Object.entries(summary).sort((a,b)=>a[0].localeCompare(b[0])).map(([person,banks])=>{
        const totalAll=Object.values(banks).reduce((s,b)=>s+b.total,0);
        return (
          <div key={person} style={{...S.card,padding:"16px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {renamingPerson?.oldName===person ? (
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")renamePerson(person,renameVal);if(e.key==="Escape")setRenamingPerson(null);}}
                      placeholder="New name or existing name to merge"
                      style={{...S.input,width:220,padding:"4px 8px",fontSize:12}}/>
                    <button onClick={()=>renamePerson(person,renameVal)} style={{background:"#15803d",border:"none",color:"#fff",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>Save</button>
                    <button onClick={()=>setRenamingPerson(null)} style={{background:"none",border:"1px solid #1e293b",color:"#475569",borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:11}}>Cancel</button>
                    <span style={{color:"#334155",fontSize:10}}>Type existing name to merge</span>
                  </div>
                ) : (
                  <span onClick={()=>{setRenamingPerson({oldName:person});setRenameVal(person);}}
                    style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#e2e8f0",cursor:"pointer",borderBottom:"1px dashed #334155"}}
                    title="Click to rename or merge">
                    {person} <span style={{color:"#475569",fontSize:11}}>✏️</span>
                  </span>
                )}
              </div>
              <div style={{color:"#475569",fontSize:11}}>Total repaid: <strong style={{color:"#94a3b8"}}>₹{fmt(totalAll)}</strong></div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
              {Object.entries(banks).sort((a,b)=>b[1].total-a[1].total).map(([bank,data])=>{
                const pct=Math.min(100,(data.total/LIMIT)*100);
                const key=`${person}::${bank}`;
                return (
                  <div key={bank} style={{background:"#080c14",border:`1px solid ${data.total>=LIMIT?"#7f1d1d":data.total>=WARNING?"#7c2d12":"#1e293b"}`,borderRadius:8,padding:"12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,alignItems:"center",gap:4}}>
                      {renamingBank?.person===person&&renamingBank?.oldBank===bank ? (
                        <div style={{display:"flex",gap:4,alignItems:"center",flex:1}}>
                          <input autoFocus value={renameBankVal} onChange={e=>setRenameBankVal(e.target.value)}
                            onKeyDown={e=>{if(e.key==="Enter")renameBank(person,bank,renameBankVal);if(e.key==="Escape")setRenamingBank(null);}}
                            style={{...S.input,flex:1,padding:"2px 6px",fontSize:11}}/>
                          <button onClick={()=>renameBank(person,bank,renameBankVal)} style={{background:"#15803d",border:"none",color:"#fff",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10}}>✓</button>
                          <button onClick={()=>setRenamingBank(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:12}}>✕</button>
                        </div>
                      ) : (
                        <span onClick={()=>{setRenamingBank({person,oldBank:bank});setRenameBankVal(bank);}}
                          style={{color:"#94a3b8",fontWeight:600,fontSize:12,textTransform:"uppercase",cursor:"pointer",borderBottom:"1px dashed #334155"}}
                          title="Click to rename or merge banks">
                          {bank} <span style={{fontSize:9}}>✏️</span>
                        </span>
                      )}
                      <span style={{fontSize:9,color:sColor(data.total),fontWeight:600}}>{sLabel(data.total)}</span>
                    </div>

                    <div style={{fontSize:16,fontWeight:700,color:sColor(data.total),marginBottom:6}}>₹{fmt(data.total)}</div>
                    <div style={{height:4,background:"#0d1424",borderRadius:2,marginBottom:6}}>
                      <div style={{height:"100%",width:`${pct}%`,background:sColor(data.total),borderRadius:2,transition:"width 0.3s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9}}>
                    {(()=>{const cards=[...new Set(data.payments.filter(p=>p.card).map(p=>p.card))];return cards.length>0&&(<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>{cards.map(c=><span key={c} style={{background:"#0d1424",color:"#60a5fa",fontSize:9,padding:"1px 5px",borderRadius:3,fontFamily:"'DM Mono',monospace"}}>••••{c}</span>)}</div>);})()}
                      <button onClick={()=>setExpandedKey(expandedKey===key?null:key)}
                        style={{background:"none",border:"none",color:"#3b82f6",cursor:"pointer",fontSize:9,padding:0}}>
                        {expandedKey===key?"▲":"▼"} {data.payments.length} payment{data.payments.length!==1?"s":""}
                      </button>
                      <span style={{color:"#334155"}}>₹{fmt(LIMIT-data.total)} left</span>
                    </div>

                    {expandedKey===key&&(
                      <div style={{borderTop:"1px solid #1e293b",paddingTop:6,marginTop:6}}>
                        {data.payments.map((p,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #0a0e1a",alignItems:"center",gap:4}}>
                            <span style={{color:"#334155",fontSize:9}}>{p.date}{p.card&&<span style={{color:"#60a5fa",marginLeft:4,fontFamily:"'DM Mono',monospace"}}>••••{p.card}</span>}</span>
                            <span style={{color:"#4ade80",fontSize:10,fontFamily:"'DM Mono',monospace",fontWeight:600,flex:1,textAlign:"right"}}>₹{fmtDec(p.amount)}</span>
                            <button onClick={()=>deletePayment(person,bank,i)} style={{background:"none",border:"none",color:"#7f1d1d",cursor:"pointer",fontSize:11,padding:"0 2px"}} title="Delete">✕</button>
                          </div>
                        ))}
                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:4,fontSize:10,fontWeight:700}}>
                          <span style={{color:"#475569"}}>Total</span>
                          <span style={{color:"#4ade80"}}>₹{fmtDec(data.total)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{...S.card,padding:"14px",marginTop:8}}>
        <button onClick={()=>setShowAdd(!showAdd)} style={{background:"none",border:"none",color:"#60a5fa",cursor:"pointer",fontSize:12,padding:0,fontFamily:"'DM Mono',monospace"}}>
          {showAdd?"▲ Hide":"▼ Add Manual Payment"}
        </button>
        {showAdd&&(
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
            <div><label style={S.label}>Person Name</label><input value={manualPerson} onChange={e=>setManualPerson(e.target.value)} placeholder="SNEHA SUNNY" style={S.input}/></div>
            <div><label style={S.label}>Bank</label><input value={manualBank} onChange={e=>setManualBank(e.target.value)} placeholder="SBI CARD" style={S.input}/></div>
            <div><label style={S.label}>Amount (₹)</label><input type="number" value={manualAmt} onChange={e=>setManualAmt(e.target.value)} placeholder="50000" style={S.input}/></div>
            <div><label style={S.label}>Date</label><input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)} style={S.input}/></div>
            <button onClick={()=>{ if(manualPerson&&manualBank&&manualAmt){ addPayment(manualPerson.trim().toUpperCase(),manualBank.trim().toUpperCase(),manualAmt,manualDate); setManualAmt("");setShowAdd(false); } }} style={S.btn("#15803d")}>+ Add</button>
          </div>
        )}
      </div>

      <div style={{color:"#1e3a5f",fontSize:10,marginTop:12,lineHeight:1.8}}>
        Click person name or bank name to rename or merge with another entry<br/>
        4 SBI cards of same person auto-combine as long as the same person name is used<br/>
        10L limit is per person per bank combined across all their cards
      </div>
    </div>
  );
}
