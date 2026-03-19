// Password generation, bank rules, and email hint extraction

// ─── AUTO PASSWORD GENERATOR ─────────────────────────────────────────────────
// Person shape: { id, fullName, dob:"DD/MM/YYYY", cards:[{last4,bankName}] }

export function generatePasswords(person, last4Hint, formatHint=null) {
  const passwords = [];
  if (!person) return passwords;
  const name = (person.fullName||"").toUpperCase().replace(/[^A-Z]/g,"");
  const dob  = person.dob||"";
  const parts = dob.includes("/")?dob.split("/"):dob.includes("-")?dob.split("-"):dob.split("/");
  const dd = (parts[0]||"").padStart(2,"0"), mm = (parts[1]||"").padStart(2,"0"), yyyy = parts[2]||"";
  const namePrefixes = [name.slice(0,4),name.slice(0,3),name.slice(0,5)].filter(Boolean);
  const cardLast4s = [];
  if (last4Hint) cardLast4s.push(last4Hint);
  (person.cards||[]).forEach(c=>{ if(c.last4&&!cardLast4s.includes(c.last4)) cardLast4s.push(c.last4); });
  const seen = new Set();
  const add = (pwd,label) => {
    if(!pwd||seen.has(pwd.toLowerCase())) return;
    seen.add(pwd.toLowerCase());
    passwords.push({pwd,label});
    const lower=pwd.toLowerCase();
    if(lower!==pwd){ seen.add(lower); passwords.push({pwd:lower,label:label+" (lower)"}); }
  };

  // If bank told us the exact format, only try that format first
  if (formatHint==="ddmm") {
    namePrefixes.forEach(np=>add(np+(dd+mm),`${person.fullName}: name+DDMM`));
    if (dd&&mm) { add(dd+mm,`${person.fullName}: DDMM only`); add(mm+dd,`${person.fullName}: MMDD only`); }
  } else if (formatHint==="ddmmyy"||formatHint==="name4+ddmmyy") {
    // RBL Bank: First 4 letters + DDMMYY (last 2 of year)
    const yy = yyyy.slice(-2); // e.g. "87" from "1987"
    namePrefixes.forEach(np=>{
      add(np+(dd+mm+yy),`${person.fullName}: name+DDMMYY`);  // SNEH140987
      add(np+(dd+mm+yyyy),`${person.fullName}: name+DDMMYYYY`); // SNEH14091987
      add(np+(mm+dd+yy),`${person.fullName}: name+MMDDYY`);
    });
    if (formatHint==="ddmmyy") {
      add(dd+mm+yy,`${person.fullName}: DDMMYY only`);
    }
  } else if (formatHint==="name4+last4") {
    namePrefixes.forEach(np=>cardLast4s.forEach(l4=>add(np+l4,`${person.fullName}: name4+last4`)));
  } else if (formatHint==="name4+dob" || formatHint==="dob") {
    namePrefixes.forEach(np=>{
      add(np+(dd+mm),`${person.fullName}: name+DDMM`);
      add(np+(mm+dd),`${person.fullName}: name+MMDD`);
      if(yyyy) add(np+yyyy,`${person.fullName}: name+YYYY`);
    });
  }

  // Always add all combinations as fallback (in case format hint is wrong)
  const dateSuffixes = [];
  if (dd&&mm) { dateSuffixes.push(dd+mm); dateSuffixes.push(mm+dd); }
  if (yyyy) dateSuffixes.push(yyyy);
  if (dd&&mm&&yyyy) { dateSuffixes.push(dd+mm+yyyy); dateSuffixes.push(yyyy+mm+dd); }
  if (mm&&yyyy) dateSuffixes.push(mm+yyyy);

  namePrefixes.forEach(np=>{
    dateSuffixes.forEach(ds=>add(np+ds,`${person.fullName}: ${np}+${ds}`));
    cardLast4s.forEach(l4=>add(np+l4,`${person.fullName}: ${np}+${l4}`));
  });
  dateSuffixes.forEach(ds=>cardLast4s.forEach(l4=>add(ds+l4,`${person.fullName}: date+last4`)));
  cardLast4s.forEach(l4=>dateSuffixes.forEach(ds=>add(l4+ds,`${person.fullName}: last4+date`)));
  return passwords;
}

// ── Generate passwords using a specific formula ───────────────────────────────
export function generateByFormula(formula, person, last4Hint) {
  const name = (person.fullName||"").toUpperCase().replace(/[^A-Z]/g,"");
  const dob  = person.dob||"";
  const parts = dob.includes("/")?dob.split("/"):dob.includes("-")?dob.split("-"):[dob];
  const dd = (parts[0]||"").padStart(2,"0");
  const mm = (parts[1]||"").padStart(2,"0");
  const yyyy = parts[2]||"";
  const yy = yyyy.slice(-2);
  const n4 = name.slice(0,4);
  const n3 = name.slice(0,3);
  const cardLast4s = [];
  if (last4Hint) cardLast4s.push(last4Hint);
  (person.cards||[]).forEach(c=>{ if(c.last4&&!cardLast4s.includes(c.last4)) cardLast4s.push(c.last4); });

  const results = [];
  const seen = new Set();
  const add = (pwd) => {
    if(!pwd||seen.has(pwd.toLowerCase())) return;
    seen.add(pwd.toLowerCase());
    results.push(pwd);
    if(pwd!==pwd.toLowerCase()) { seen.add(pwd.toLowerCase()); results.push(pwd.toLowerCase()); }
  };

  switch(formula) {
    case "name4+ddmm":
      add(n4+dd+mm); add(n3+dd+mm); break;
    case "name4+mmdd":
      add(n4+mm+dd); add(n3+mm+dd); break;
    case "name4+ddmmyy":
      add(n4+dd+mm+yy); add(n3+dd+mm+yy); break;
    case "name4+ddmmyyyy":
      add(n4+dd+mm+yyyy); add(n3+dd+mm+yyyy); break;
    case "name4+mmddyy":
      add(n4+mm+dd+yy); break;
    case "name4+yyyy":
      add(n4+yyyy); add(n3+yyyy); break;
    case "name4+last4":
      cardLast4s.forEach(l4=>{ add(n4+l4); add(n3+l4); }); break;
    case "ddmm":
      add(dd+mm); add(mm+dd); break;
    case "ddmmyy":
      add(dd+mm+yy); break;
    case "ddmmyyyy":
      add(dd+mm+yyyy); break;
    case "name4+dob_ddmm":
      add(n4+dd+mm); add(n4+mm+dd); break;
    default:
      break;
  }
  return results;
}

// Common Indian bank password formulas (pre-filled defaults)
export const DEFAULT_BANK_RULES = [
  { id:"hdfc",    bankName:"HDFC",               formula:"name4+ddmm",     notes:"e.g. RAVI0512" },
  { id:"icici",   bankName:"ICICI",              formula:"name4+ddmmyyyy", notes:"e.g. RAVI05121975" },
  { id:"sbi",     bankName:"SBI",                formula:"name4+ddmm",     notes:"e.g. RAVI0512" },
  { id:"rbl",     bankName:"RBL",                formula:"name4+ddmmyy",   notes:"e.g. ANSH140987" },
  { id:"idfc",    bankName:"IDFC FIRST",         formula:"ddmm",           notes:"e.g. 1409 (just DOB DDMM)" },
  { id:"axis",    bankName:"Axis",               formula:"name4+ddmmyyyy", notes:"e.g. RAVI05121975" },
  { id:"kotak",   bankName:"Kotak",              formula:"name4+ddmm",     notes:"e.g. RAVI0512" },
  { id:"indusind",bankName:"IndusInd",           formula:"name4+ddmm",     notes:"e.g. RAVI0512" },
  { id:"amex",    bankName:"Amex",               formula:"name4+last4",    notes:"e.g. RAVI1234" },
  { id:"yes",     bankName:"Yes Bank",           formula:"name4+ddmmyyyy", notes:"e.g. RAVI05121975" },
  { id:"lit",     bankName:"LIT",                formula:"name4+last4",    notes:"e.g. SHUB2308" },
  { id:"au",      bankName:"AU Small Finance",   formula:"name4+ddmm",     notes:"e.g. RAVI0512" },
  { id:"scb",     bankName:"Standard Chartered", formula:"name4+ddmmyyyy", notes:"e.g. RAVI05121975" },
];

// findPersonForCard is now defined inside extractHintsFromEmail block above

export function resolvePasswords(vault, people, bankRules, bankHint, last4Hint, last2Hint, nameHint, emailNameHint, formatHint, emailText) {
  const results = [];
  const seen = new Set();
  const addPwd = (pwd,label) => { if(pwd&&!seen.has(pwd)&&results.length<80){seen.add(pwd);results.push({pwd,label});} };

  console.log("[PwdResolve] hints:", {last4Hint,last2Hint,nameHint,bankHint,peopleCount:people?.length,bankRulesCount:bankRules?.length});

  // 0. Bank Rules: if we know the bank, use ONLY the defined formula (fastest path)
  const bankKey = (bankHint||"").toLowerCase();
  const matchedRule = (bankRules||[]).find(r=>bankKey.includes(r.bankName.toLowerCase())||r.bankName.toLowerCase().includes(bankKey.split(" ")[0]));
  if (matchedRule && matchedRule.formula !== "custom") {
    console.log("[PwdResolve] Using bank rule:", matchedRule.bankName, matchedRule.formula);
    const person = findPersonForCard(people||[], last4Hint, last2Hint, nameHint, emailNameHint, emailText);
    const targetPeople = person ? [person] : (people||[]);
    const cardHint = last4Hint || last2Hint || "";
    targetPeople.forEach(p => {
      const pwds = generateByFormula(matchedRule.formula, p, cardHint);
      pwds.forEach(pwd => addPwd(pwd, `${matchedRule.bankName} rule: ${matchedRule.formula}`));
    });
    console.log("[PwdResolve] Bank rule generated:", results.length, "passwords. First:", results[0]?.pwd);
    // Still add vault as fallback
    (vault||[]).forEach(e=>addPwd(e.password,`Vault: ${e.bankName||""}`));
    return results;
  }

  // 1. Find best matching person using all available hints
  const person = findPersonForCard(people||[], last4Hint, last2Hint, nameHint, emailNameHint, emailText);
  console.log("[PwdResolve] matched person:", person?.fullName||"none");

  if (person) {
    const cardLast4 = last4Hint || person.cards?.find(c=>last2Hint&&c.last4?.endsWith(last2Hint))?.last4 || "";
    const pwds = generatePasswords(person, cardLast4, formatHint);
    console.log("[PwdResolve] generated passwords for matched person:", pwds.length, "first:", pwds[0]?.pwd);
    pwds.forEach(p=>addPwd(p.pwd,p.label));
  }

  // 2. If no person matched but we have last4, try people whose cards match
  if (results.length===0 && last4Hint) {
    const matched=(people||[]).filter(p=>p.cards?.some(c=>c.last4===last4Hint));
    console.log("[PwdResolve] last4 fallback matches:", matched.map(p=>p.fullName));
    matched.forEach(p=>generatePasswords(p,last4Hint,formatHint).forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 3. If no person matched but we have last2, try people whose cards end with last2
  if (results.length===0 && last2Hint) {
    const matched=(people||[]).filter(p=>p.cards?.some(c=>c.last4?.endsWith(last2Hint)));
    console.log("[PwdResolve] last2 fallback matches:", matched.map(p=>p.fullName));
    matched.forEach(p=>generatePasswords(p,last2Hint,formatHint).forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 4. If STILL nothing — try ALL people (last resort, capped at 80)
  if (results.length===0 && people?.length>0) {
    console.log("[PwdResolve] No hints matched — trying all people as last resort");
    (people||[]).forEach(p=>generatePasswords(p,last4Hint||last2Hint||"",formatHint).forEach(pw=>addPwd(pw.pwd,pw.label)));
  }

  // 5. Manual vault passwords
  const bank=(bankHint||"").toLowerCase(); const last4=(last4Hint||"").trim();
  if(bank&&last4)(vault||[]).filter(e=>e.bankName&&e.bankName.toLowerCase().includes(bank)&&e.last4===last4).forEach(e=>addPwd(e.password,`Vault: ${e.bankName} ••••${e.last4}`));
  if(bank)(vault||[]).filter(e=>e.bankName&&e.bankName.toLowerCase().includes(bank)&&!e.last4).forEach(e=>addPwd(e.password,`Vault: ${e.bankName}`));
  (vault||[]).forEach(e=>addPwd(e.password,`Vault: ${e.bankName||""}${e.last4?" ••••"+e.last4:""}`));

  console.log("[PwdResolve] total passwords:", results.length);
  return results;
}

export function extractHintsFromEmail(subject, bodyText, toAddress) {
  const fullText = subject+" "+(bodyText||"");
  const text = fullText.toLowerCase();

  // ── Card number extraction ────────────────────────────────────────────────
  let last4 = null, last2 = null;

  // Patterns: XXXX7456, xxxx7456, ****7456, X7456, ending 7456
  const patterns4 = [
    /(?:x{3,}|\*{3,}|#{3,})(\d{4})(?!\d)/gi,
    /(?:ending|ending in|ending with|last 4|last four)\s*:?\s*(\d{4})(?!\d)/gi,
    /(?:account|card)\s*(?:no\.?|number|#)?\s*:?\s*(?:[xX*#-]+)(\d{4})(?!\d)/gi,
    /[xX*-]{2,}(\d{4})(?!\d)/g,
    // filename pattern: xxxx-xxxx-xx-xxxx1234
    /[xX-]{4,}(\d{4})(?!\d)/g,
  ];

  for (const p of patterns4) {
    p.lastIndex = 0;
    const m = p.exec(fullText);
    if (m?.[1]) { last4 = m[1]; break; }
  }

  if (!last4) {
    const patterns2 = [
      /(?:x{3,}|\*{3,})(\d{2})(?!\d)/gi,  // XXXX08
      /(?:ending|ending in)\s*:?\s*(\d{2})(?!\d)/gi,
      /card\s*number\s+[xX*-]+(\d{2})(?!\d)/gi,
      /[xX]{2,}-?(\d{2})(?:[^\d]|$)/g,
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
    // "Hi SNEHA SUNNY," — all caps name after Hi/Dear
    /(?:dear|hi|hello)[,\s]+(?:mr\.?\s*|mrs\.?\s*|ms\.?\s*|dr\.?\s*)?([A-Z]{2,}(?:\s+[A-Z]{2,})*)/,
    // "Dear Sneha Sunny" — title case
    /(?:dear|hi|hello)[,\s]+(?:mr\.?\s*|mrs\.?\s*|ms\.?\s*|dr\.?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    // "Cardholder Name: Sneha Sunny"
    /cardholder\s*(?:name)?\s*:?\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
    // "Name: SNEHA SUNNY"
    /\bname\s*:?\s*([A-Z]{2,}(?:\s+[A-Z]{2,})*)/,
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

  // ── Password format hint from email body ─────────────────────────────────
  // Banks sometimes explicitly say how the password is formed
  let pwdFormatHint = null;
  const bodyLower = (bodyText||"").toLowerCase();
  if (bodyLower.includes("ddmmyy") || bodyLower.includes("ddmmyyyy")) {
    // RBL: "First 4 letters CAPITAL + DDMMYY"
    if (bodyLower.includes("first 4")||bodyLower.includes("first four")) pwdFormatHint = "name4+ddmmyy";
    else pwdFormatHint = "ddmmyy";
  } else if ((bodyLower.includes("date of birth")||bodyLower.includes("dob")) && bodyLower.includes("ddmm")) {
    pwdFormatHint = "ddmm";
  } else if (bodyLower.includes("date of birth") && bodyLower.includes("dd/mm")) {
    pwdFormatHint = "ddmm";
  } else if (bodyLower.includes("date of birth") && bodyLower.includes("mmdd")) {
    pwdFormatHint = "mmdd";
  } else if (bodyLower.includes("date of birth") || bodyLower.includes("birth date")) {
    pwdFormatHint = "dob";
  } else if ((bodyLower.includes("first 4")||bodyLower.includes("first four")) && bodyLower.includes("name") && bodyLower.includes("last 4")) {
    pwdFormatHint = "name4+last4";
  } else if ((bodyLower.includes("first 4")||bodyLower.includes("first four")) && bodyLower.includes("name") && (bodyLower.includes("birth")||bodyLower.includes("ddmm"))) {
    pwdFormatHint = "name4+dob";
  }

  return { last4, last2, nameHint, emailNameHint, bank: bankFound, pwdFormatHint };
}

// Match a person from registry using multiple signals
export function findPersonForCard(people, last4Hint, last2Hint, nameHint, emailNameHint, emailText) {
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


