import { useState, useEffect } from "react";

const CHECKLIST_KEY = "cc_checklist_v1";

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}

function getMonthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(y, m-1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function getAllMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  }
  return months;
}

export function MonthlyChecklist({ people, records }) {
  const [month, setMonth]         = useState(getMonthKey());
  const [checklist, setChecklist] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "{}"); }
    catch { return {}; }
  });

  useEffect(() => {
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checklist)); }
    catch {}
  }, [checklist]);

  // Build master card list from People registry
  const allCards = [];
  (people || []).forEach(person => {
    (person.cards || []).forEach(card => {
      allCards.push({
        personName: person.fullName || "Unknown",
        bank: card.bankName || "Unknown",
        last4: card.last4 || "????",
        key: `${(person.fullName||"").toUpperCase()}_${(card.bankName||"").toUpperCase()}_${card.last4}`
      });
    });
  });

  // Check if this card has a record this month
  function getCardStatus(last4, bank) {
    const [y, m] = month.split("-");
    const monthRecords = (records || []).filter(r => {
      if (!r.statementDate && !r.dueDate) return false;
      const dateStr = r.statementDate || r.dueDate || "";
      const d = new Date(dateStr);
      return d.getFullYear() === parseInt(y) && (d.getMonth()+1) === parseInt(m);
    });
    const found = monthRecords.find(r =>
      r.lastFourDigits === last4 &&
      (r.bankName || "").toUpperCase().includes((bank || "").toUpperCase().slice(0,4))
    );
    return found || null;
  }

  // Checklist state per card per month
  function getCheck(cardKey, field) {
    return checklist[month]?.[cardKey]?.[field] || false;
  }

  function setCheck(cardKey, field, val) {
    setChecklist(prev => ({
      ...prev,
      [month]: {
        ...(prev[month] || {}),
        [cardKey]: {
          ...(prev[month]?.[cardKey] || {}),
          [field]: val
        }
      }
    }));
  }

  function resetMonth() {
    if (!window.confirm(`Reset all checkboxes for ${getMonthLabel(month)}?`)) return;
    setChecklist(prev => { const d = {...prev}; delete d[month]; return d; });
  }

  const allMonths = getAllMonths();

  // Summary counts
  const total = allCards.length;
  const tracked = allCards.filter(c => getCardStatus(c.last4, c.bank)).length;
  const verified = allCards.filter(c => getCheck(c.key, "verified")).length;
  const paid = allCards.filter(c => getCheck(c.key, "paid")).length;
  const missed = allCards.filter(c => !getCardStatus(c.last4, c.bank) && !getCheck(c.key, "verified")).length;

  return (
    <div>
      {/* Month selector */}
      <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{color:"#475569",fontSize:11}}>Month:</span>
        {allMonths.map(m => (
          <button key={m} onClick={() => setMonth(m)}
            style={{background:month===m?"#1e40af":"none",border:`1px solid ${month===m?"#3b82f6":"#1e293b"}`,
              color:month===m?"#fff":"#475569",borderRadius:6,padding:"4px 12px",
              cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>
            {getMonthLabel(m)}{m===getMonthKey()&&<span style={{color:"#4ade80",fontSize:9}}> ◉</span>}
          </button>
        ))}
        <button onClick={resetMonth}
          style={{marginLeft:"auto",background:"none",border:"1px solid #7f1d1d",
            color:"#f87171",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11}}>
          🔄 Reset Month
        </button>
      </div>

      {/* Summary bar */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {[
          ["📋 Total Cards", total, "#334155", "#94a3b8"],
          ["🤖 Auto-Tracked", tracked, "#052e16", "#4ade80"],
          ["✅ Last4 Verified", verified, "#1e3a5f", "#60a5fa"],
          ["💰 Paid", paid, "#1a1200", "#fbbf24"],
        ].map(([label, count, bg, color]) => (
          <div key={label} style={{background:bg,border:`1px solid ${color}22`,borderRadius:8,padding:"10px 14px",textAlign:"center"}}>
            <div style={{color,fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{count}</div>
            <div style={{color:"#475569",fontSize:10,marginTop:2}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Missed alert */}
      {missed > 0 && (
        <div style={{background:"#2d0f0f",border:"1px solid #7f1d1d",borderRadius:8,padding:"10px 16px",marginBottom:16,color:"#f87171",fontSize:12}}>
          ⚠ <strong>{missed} card{missed>1?"s":""}</strong> not tracked by app this month — check manually
        </div>
      )}

      {/* No cards warning */}
      {allCards.length === 0 && (
        <div style={{background:"#0f1a2e",border:"1px solid #1e3a5f",borderRadius:8,padding:"20px",textAlign:"center",color:"#475569",fontSize:13}}>
          No cards found. Add cardholders with their card last 4 digits in the <strong style={{color:"#60a5fa"}}>👥 People</strong> tab first.
        </div>
      )}

      {/* Card list */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {/* Header */}
        {allCards.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 100px 120px 110px 100px",gap:8,padding:"6px 14px",
            color:"#334155",fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>
            <span>Card</span>
            <span style={{textAlign:"center"}}>App Tracked</span>
            <span style={{textAlign:"center"}}>Last4 Verified</span>
            <span style={{textAlign:"center"}}>Statement Read</span>
            <span style={{textAlign:"center"}}>Paid</span>
          </div>
        )}

        {allCards.map(card => {
          const autoRecord = getCardStatus(card.last4, card.bank);
          const isVerified = getCheck(card.key, "verified");
          const isRead     = getCheck(card.key, "read");
          const isPaid     = getCheck(card.key, "paid");
          const hasIssue   = !autoRecord && !isVerified;

          return (
            <div key={card.key} style={{
              display:"grid", gridTemplateColumns:"1fr 100px 120px 110px 100px", gap:8,
              alignItems:"center", padding:"12px 14px",
              background: isPaid ? "#041a0c" : hasIssue ? "#1a0d0d" : "#0d1424",
              border: `1px solid ${isPaid ? "#14532d" : hasIssue ? "#7f1d1d" : "#1e293b"}`,
              borderRadius:8, transition:"all 0.2s"
            }}>
              {/* Card info */}
              <div>
                <div style={{color:"#e2e8f0",fontSize:12,fontWeight:600}}>{card.personName}</div>
                <div style={{color:"#475569",fontSize:10,marginTop:2,fontFamily:"'DM Mono',monospace"}}>
                  {card.bank} <span style={{color:"#60a5fa"}}>••••{card.last4}</span>
                  {autoRecord && autoRecord.dueAmount && (
                    <span style={{color:"#fbbf24",marginLeft:8}}>
                      Due: ₹{Number(autoRecord.dueAmount).toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              </div>

              {/* Auto-tracked by app */}
              <div style={{textAlign:"center"}}>
                {autoRecord
                  ? <span style={{color:"#4ade80",fontSize:13}}>✅</span>
                  : <span style={{color:"#f87171",fontSize:13}}>❌</span>}
              </div>

              {/* Last4 Verified — manual checkbox */}
              <div style={{textAlign:"center"}}>
                <label style={{cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <input type="checkbox" checked={isVerified}
                    onChange={e => setCheck(card.key, "verified", e.target.checked)}
                    style={{accentColor:"#60a5fa",width:15,height:15,cursor:"pointer"}}/>
                  <span style={{color:isVerified?"#60a5fa":"#334155",fontSize:10}}>
                    {isVerified ? "Confirmed" : "Check"}
                  </span>
                </label>
              </div>

              {/* Statement read — manual checkbox */}
              <div style={{textAlign:"center"}}>
                <label style={{cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <input type="checkbox" checked={isRead}
                    onChange={e => setCheck(card.key, "read", e.target.checked)}
                    style={{accentColor:"#a78bfa",width:15,height:15,cursor:"pointer"}}/>
                  <span style={{color:isRead?"#a78bfa":"#334155",fontSize:10}}>
                    {isRead ? "Read" : "Pending"}
                  </span>
                </label>
              </div>

              {/* Paid — manual checkbox */}
              <div style={{textAlign:"center"}}>
                <label style={{cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <input type="checkbox" checked={isPaid}
                    onChange={e => setCheck(card.key, "paid", e.target.checked)}
                    style={{accentColor:"#4ade80",width:15,height:15,cursor:"pointer"}}/>
                  <span style={{color:isPaid?"#4ade80":"#334155",fontSize:10}}>
                    {isPaid ? "Paid ✓" : "Unpaid"}
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {allCards.length > 0 && (
        <div style={{marginTop:16,color:"#334155",fontSize:10,lineHeight:2}}>
          <strong style={{color:"#475569"}}>How to use:</strong><br/>
          ✅ <strong>App Tracked</strong> = app found this card's statement email automatically this month<br/>
          ❌ <strong>App Tracked</strong> = app missed it — check Gmail manually or re-sync<br/>
          <span style={{color:"#60a5fa"}}>Last4 Verified</span> = you confirmed the last 4 digits are correct for this card<br/>
          <span style={{color:"#a78bfa"}}>Statement Read</span> = you have read/checked the statement yourself<br/>
          <span style={{color:"#4ade80"}}>Paid</span> = you have made the payment for this card this month
        </div>
      )}
    </div>
  );
}

