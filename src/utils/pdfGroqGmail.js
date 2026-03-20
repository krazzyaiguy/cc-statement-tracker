// PDF processing, Groq AI extraction, Gmail API helpers

const AI_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const EXTRACTION_PROMPT = `You are a credit card statement parser. Extract billing information from this statement image.
Return ONLY valid JSON, no markdown, no explanation:
{
  "cardholderName": "string or null",
  "bankName": "string or null",
  "lastFourDigits": "string (exactly 4 digits only) or null",
  "statementDate": "DD/MM/YYYY or null",
  "dueDate": "DD/MM/YYYY or null",
  "dueAmount": number or null,
  "currency": "INR or null",
  "paymentsReceived": number or null,
  "accumulatedSpends": number or null
}
STRICT RULES:
- cardholderName: Full name as printed on statement. Remove prefixes like MR, MRS, MS. e.g. "RAVI SHARMA" not "MR RAVI SHARMA"
- lastFourDigits: ONLY the last 4 numeric digits of the card. If card shows "XXXX XXXX XXXX 1234" return "1234". Never return X or * characters.
- dueAmount: The TOTAL AMOUNT DUE / TOTAL OUTSTANDING as a plain number in rupees. e.g. 18243.00
- dueDate: Payment due date in DD/MM/YYYY format
- statementDate: Statement generation date in DD/MM/YYYY format
- paymentsReceived: Look for "Payments, Reversals & other Credits" or "Payment Received" or "Credits" in Account Summary. This is what the customer PAID last month. e.g. 1013.00
- accumulatedSpends: Look for "Accumulated Spends till statement date" or "Total Spends" or "Year to date spends". e.g. 40845.00
- Return null for any field you cannot find with confidence`;

// ─── PDF ──────────────────────────────────────────────────────────────────────
export async function getPDFLib() {
  if (window._pdfjsLib) return window._pdfjsLib;
  await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  window._pdfjsLib=window.pdfjsLib; return window._pdfjsLib;
}

export async function pdfBytesToBase64Image(bytes, password="") {
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

export async function tryPasswordsOnPDF(bytes, passwordList) {
  try{return{imgBase64:await pdfBytesToBase64Image(bytes,""),usedLabel:"no password"};}
  catch(e){if(e.message!=="WRONG_PASSWORD")throw e;}
  for(const{pwd,label}of passwordList){
    try{return{imgBase64:await pdfBytesToBase64Image(bytes,pwd),usedLabel:label};}
    catch(e){if(e.message!=="WRONG_PASSWORD")throw e;}
  }
  throw new Error("WRONG_PASSWORD");
}

export async function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file);});}

// ─── GROQ ───────────────────────────────────────────────────────────────────
export async function callGroq(apiKey,base64,mimeType="image/jpeg"){
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
export async function gmailFetch(path,token){const res=await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`,{headers:{Authorization:`Bearer ${token}`}});if(!res.ok)throw new Error(`Gmail API ${res.status}`);return res.json();}
export async function fetchStatementEmails(token, afterDate=null){
  // afterDate = "YYYY/MM/DD" Gmail format
  const base = 'has:attachment filename:pdf (subject:statement OR subject:e-statement OR subject:"credit card" OR subject:"account statement" OR subject:bill OR subject:"due date" OR subject:outstanding)';
  const dateFilter = afterDate ? ` after:${afterDate}` : "";
  const q = encodeURIComponent(base + dateFilter);
  const d = await gmailFetch(`users/me/messages?q=${q}&maxResults=100`, token);
  return d.messages||[];
}
export async function fetchEmailWithAttachments(messageId,token){
  const msg=await gmailFetch(`users/me/messages/${messageId}?format=full`,token);
  const hdr=(name)=>msg.payload?.headers?.find(h=>h.name===name)?.value||"";
  const toAddress=hdr("To")||hdr("Delivered-To")||"";
  const pdfParts=[];let bodyText="";let htmlText="";
  function collect(parts){
    if(!parts)return;
    for(const p of parts){
      // Read plain text
      if(p.mimeType==="text/plain"&&p.body?.data){
        try{bodyText+=atob(p.body.data.replace(/-/g,"+").replace(/_/g,"/"));}catch{}
      }
      // Read HTML and strip tags for better text extraction
      if(p.mimeType==="text/html"&&p.body?.data){
        try{
          const html=atob(p.body.data.replace(/-/g,"+").replace(/_/g,"/"));
          // Strip HTML tags, decode entities, normalize whitespace
          const stripped=html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
            .replace(/<[^>]+>/g," ")
            .replace(/&nbsp;/g," ").replace(/&amp;/g,"&")
            .replace(/&lt;/g,"<").replace(/&gt;/g,">")
            .replace(/&#\d+;/g," ")
            .replace(/\s+/g," ").trim();
          htmlText+=stripped;
        }catch{}
      }
      if(p.mimeType==="application/pdf"||(p.filename&&p.filename.toLowerCase().endsWith(".pdf")))pdfParts.push(p);
      if(p.parts)collect(p.parts);
    }
  }
  collect(msg.payload?.parts);
  // Use plain text if available, otherwise fall back to HTML-stripped text
  const finalBodyText = bodyText.trim() || htmlText.trim();
  return{messageId,subject:hdr("Subject"),date:hdr("Date"),toAddress,pdfParts,bodyText:finalBodyText}; // eslint-disable-line
}
export async function downloadAttachment(msgId,attId,token){const d=await gmailFetch(`users/me/messages/${msgId}/attachments/${attId}`,token);return d.data.replace(/-/g,"+").replace(/_/g,"/");}


