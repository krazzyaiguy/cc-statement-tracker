import { useState } from "react";

function fmt(n){ return Number(n||0).toLocaleString("en-IN"); }
function parseDate(s){ if(!s)return null; const[d,m,y]=s.split("/"); return new Date(y,m-1,d); }
function daysUntil(s){ const d=parseDate(s); if(!d)return null; return Math.ceil((d-new Date().setHours(0,0,0,0))/86400000); }

export function Dashboard({ records, people }) {
  const [now] = useState(new Date());

  const unpaid = records.filter(r => !r.paid);
  const paid   = records.filter(r => r.paid);

  const totalOutstanding = unpaid.reduce((s,r) => s + (parseFloat(r.dueAmount)||0), 0);
  const totalPaidMonth   = paid.filter(r => {
    const d = parseDate(r.dueDate);
    return d && d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,r) => s + (parseFloat(r.dueAmount)||0), 0);

  const overdue   = unpaid.filter(r => { const d=daysUntil(r.dueDate); return d!==null&&d<0; });
  const dueToday  = unpaid.filter(r => daysUntil(r.dueDate)===0);
  const due3days  = unpaid.filter(r => { const d=daysUntil(r.dueDate); return d!==null&&d>0&&d<=3; });

  // Monthly spend trend (last 6 months)
  const months = [];
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = d.toLocaleString("en-IN",{month:"short"});
    const total = records.filter(r=>{
      const rd = parseDate(r.dueDate||r.statementDate);
      return rd && rd.getFullYear()===d.getFullYear() && rd.getMonth()===d.getMonth();
    }).reduce((s,r)=>s+(parseFloat(r.dueAmount)||0),0);
    months.push({label, total, key});
  }
  const maxMonth = Math.max(...months.map(m=>m.total), 1);

  // Per-person outstanding
  const byPerson = {};
  unpaid.forEach(r => {
    const p = r.cardholderName||"Unknown";
    if(!byPerson[p]) byPerson[p]=0;
    byPerson[p] += parseFloat(r.dueAmount)||0;
  });
  const topPeople = Object.entries(byPerson).sort((a,b)=>b[1]-a[1]).slice(0,5);

  return (
    <div>
      {/* Summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:24}}>
        {[
          ["💳 Outstanding",`₹${fmt(totalOutstanding)}`,"#450a0a","#f87171"],
          ["✅ Paid This Month",`₹${fmt(totalPaidMonth)}`,"#052e16","#4ade80"],
          ["🔴 Overdue",overdue.length,"#450a0a","#fca5a5"],
          ["⚠ Due Today",dueToday.length,"#1c0a00","#fb923c"],
          ["📅 Due in 3 days",due3days.length,"#1a1200","#fbbf24"],
          ["📋 Total Cards",records.length,"#0d1424","#60a5fa"],
        ].map(([label,val,bg,color])=>(
          <div key={label} style={{background:bg,border:`1px solid ${color}33`,borderRadius:10,padding:"14px 16px"}}>
            <div style={{color,fontSize:22,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{val}</div>
            <div style={{color:"#475569",fontSize:10,marginTop:4}}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        {/* Monthly trend chart */}
        <div style={{background:"#0d1424",border:"1px solid #1e293b",borderRadius:10,padding:"16px"}}>
          <div style={{color:"#94a3b8",fontSize:12,fontWeight:600,marginBottom:14}}>📈 Monthly Due Amounts</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:100}}>
            {months.map(m=>(
              <div key={m.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <div style={{fontSize:8,color:"#334155"}}>₹{m.total>=100000?`${(m.total/100000).toFixed(1)}L`:m.total>=1000?`${(m.total/1000).toFixed(0)}K`:"0"}</div>
                <div style={{width:"100%",borderRadius:"3px 3px 0 0",
                  height:`${Math.max((m.total/maxMonth)*80,2)}px`,
                  background:m.key===`${now.getFullYear()}-${now.getMonth()}`?"#3b82f6":"#1e3a5f",
                  transition:"height 0.3s"}}/>
                <div style={{fontSize:9,color:"#475569"}}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top outstanding by person */}
        <div style={{background:"#0d1424",border:"1px solid #1e293b",borderRadius:10,padding:"16px"}}>
          <div style={{color:"#94a3b8",fontSize:12,fontWeight:600,marginBottom:14}}>👥 Outstanding by Person</div>
          {topPeople.length===0
            ? <div style={{color:"#334155",fontSize:11,marginTop:20,textAlign:"center"}}>All paid up! 🎉</div>
            : topPeople.map(([name,amt])=>(
              <div key={name} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{color:"#94a3b8",fontSize:11}}>{name}</span>
                  <span style={{color:"#f87171",fontSize:11,fontFamily:"'DM Mono',monospace"}}>₹{fmt(amt)}</span>
                </div>
                <div style={{background:"#1e293b",borderRadius:4,height:4}}>
                  <div style={{background:"#ef4444",borderRadius:4,height:4,width:`${(amt/totalOutstanding)*100}%`,transition:"width 0.3s"}}/>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Urgent cards */}
      {(overdue.length>0||dueToday.length>0||due3days.length>0)&&(
        <div style={{background:"#1a0505",border:"1px solid #7f1d1d",borderRadius:10,padding:"16px"}}>
          <div style={{color:"#f87171",fontSize:12,fontWeight:600,marginBottom:12}}>🚨 Needs Immediate Attention</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[...overdue,...dueToday,...due3days].map(r=>{
              const days=daysUntil(r.dueDate);
              return(
                <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  background:"#0d1424",borderRadius:8,padding:"10px 14px"}}>
                  <div>
                    <span style={{color:"#e2e8f0",fontSize:12}}>{r.cardholderName||"?"}</span>
                    <span style={{color:"#475569",fontSize:11,marginLeft:8}}>{r.bankName} ••••{r.lastFourDigits}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{color:"#f87171",fontSize:13,fontFamily:"'DM Mono',monospace",fontWeight:700}}>₹{fmt(r.dueAmount)}</div>
                    <div style={{color:days<0?"#f87171":days===0?"#fb923c":"#fbbf24",fontSize:10}}>
                      {days<0?`${-days}d overdue`:days===0?"Due TODAY":`Due in ${days}d`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

