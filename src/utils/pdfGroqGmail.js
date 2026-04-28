// PDF processing, Multi-provider AI extraction, Gmail API helpers

// ─── AI PROVIDERS CONFIG ──────────────────────────────────────────────────────
export const AI_PROVIDERS = {
  groq: {
    label: "Groq (Llama 4)",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    models: [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct",
      "llama-3.2-90b-vision-preview",
      "llama-3.2-11b-vision-preview",
    ],
    keyPlaceholder: "gsk_...",
    keyLink: "https://console.groq.com/keys",
    keyNote: "Free, no credit card needed",
    testUrl: (key) => fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } }),
  },
  gemini: {
    label: "Google Gemini",
  defaultModel: "gemini-1.5-flash-latest",
models: ["gemini-1.5-flash-latest", "gemini-1.5-pro-latest", "gemini-2.0-flash"],
    keyPlaceholder: "AIza...",
    keyLink: "https://aistudio.google.com/apikey",
    keyNote: "Free — 1500 req/day",
    testUrl: (key) => fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`),
  },
  openai: {
    label: "OpenAI GPT-4o",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    keyPlaceholder: "sk-...",
    keyLink: "https://platform.openai.com/api-keys",
    keyNote: "Paid — best accuracy",
    testUrl: (key) => fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } }),
  },
  claude: {
    label: "Claude (Anthropic)",
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"],
    keyPlaceholder: "sk-ant-...",
    keyLink: "https://console.anthropic.com/keys",
    keyNote: "Paid — excellent accuracy",
    testUrl: null, // Claude doesn't have a cheap test endpoint
  },
  mistral: {
    label: "Mistral Pixtral",
    defaultModel: "pixtral-12b-2409",
    models: ["pixtral-12b-2409", "pixtral-large-2411"],
    keyPlaceholder: "...",
    keyLink: "https://console.mistral.ai/api-keys",
    keyNote: "Paid",
    testUrl: (key) => fetch("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${key}` } }),
  },
};

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are a credit card statement parser specialising in Indian bank statements. Extract billing information from this statement image.
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

CRITICAL RULES — READ EVERY RULE CAREFULLY:

▸ cardholderName: Full name on statement. Strip MR/MRS/MS prefix.

▸ lastFourDigits: ONLY last 4 numeric digits of card number.
  — NEVER return X, *, or masked digits.
  — Look for patterns like "xxxx xxxx xxxx 1234" or "Card No. ...1234" or "ending in 1234".
  — Read each digit EXTREMELY carefully. Common OCR confusions: 0↔O, 1↔I/l, 5↔S, 8↔B, 6↔G, 2↔Z.
  — If you see a 16-digit card number, count from the right and take only the last 4.

▸ dueAmount: The FINAL amount customer must PAY NOW.
  — Look for: "Total Amount Due", "Total Outstanding", "Amount Payable", "Net Payable".
  — Use TOTAL not minimum. This is AFTER subtracting payments.
  — It is the CLOSING BALANCE or NET PAYABLE amount.
  — DO NOT use "Previous Balance", "Opening Balance", or intermediate calculations.
  — DO NOT subtract or add anything yourself — just read the final "Total Outstanding" figure.
  — Example SBI: Previous Balance 18938.95, Credits 1013, Total Outstanding 18243 → return 18243.
  — Read every digit carefully. Thousands separators (commas) are NOT decimal points.

▸ dueDate: Payment due date in DD/MM/YYYY. NOT statement date.

▸ statementDate: Date statement was generated.

▸ paymentsReceived: "Payments, Reversals & other Credits" from Account Summary.
  — Historical (last month's payment). Does NOT affect dueAmount.

▸ accumulatedSpends: "Accumulated Spends till statement date" or "Year to date spends".

▸ Return null for any field you cannot read with confidence.`;

const VERIFY_PROMPT = (first) => `You are a quality-check specialist for Indian credit card statements.

A previous extraction produced this result:
${JSON.stringify(first, null, 2)}

RE-EXAMINE the SAME statement image and verify every field.

Pay SPECIAL attention to these common error sources:
1. lastFourDigits — recount digits from right of card number. Watch: 0↔O, 1↔I/l, 5↔S, 8↔B
2. dueAmount — re-read every digit. Is the decimal point in the right place? Does ₹18,243 look like 18243 or 18.243?
3. cardholderName — is this really the cardholder name, not the bank name?
4. dueDate vs statementDate — are these swapped?

Return ONLY valid JSON with same structure. Correct any errors you find. If all looks correct, return same values.
{
  "cardholderName": "string or null",
  "bankName": "string or null",
  "lastFourDigits": "string (exactly 4 digits) or null",
  "statementDate": "DD/MM/YYYY or null",
  "dueDate": "DD/MM/YYYY or null",
  "dueAmount": number or null,
  "currency": "INR or null",
  "paymentsReceived": number or null,
  "accumulatedSpends": number or null
}`;

// ─── PDF ──────────────────────────────────────────────────────────────────────
export async function getPDFLib() {
  if (window._pdfjsLib) return window._pdfjsLib;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  window._pdfjsLib = window.pdfjsLib;
  return window._pdfjsLib;
}

export async function pdfBytesToBase64Image(bytes, password = "") {
  const pdfjsLib = await getPDFLib();
  const dataCopy = bytes instanceof Uint8Array
    ? new Uint8Array(bytes.buffer.slice(0)) : bytes.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: dataCopy, password });
  let pdf;
  try { pdf = await loadingTask.promise; }
  catch (err) { if (err.name === "PasswordException") throw new Error("WRONG_PASSWORD"); throw err; }
  const pages = []; let totalH = 0, maxW = 0;
  for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    pages.push(canvas); totalH += vp.height; maxW = Math.max(maxW, vp.width);
  }
  const merged = document.createElement("canvas");
  merged.width = maxW; merged.height = totalH;
  const ctx = merged.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, maxW, totalH);
  let y = 0; for (const c of pages) { ctx.drawImage(c, 0, y); y += c.height; }
  return merged.toDataURL("image/jpeg", 0.85).split(",")[1];
}

export async function tryPasswordsOnPDF(bytes, passwordList) {
  try { return { imgBase64: await pdfBytesToBase64Image(bytes, ""), usedLabel: "no password" }; }
  catch (e) { if (e.message !== "WRONG_PASSWORD") throw e; }
  for (const { pwd, label } of passwordList) {
    try { return { imgBase64: await pdfBytesToBase64Image(bytes, pwd), usedLabel: label }; }
    catch (e) { if (e.message !== "WRONG_PASSWORD") throw e; }
  }
  throw new Error("WRONG_PASSWORD");
}

export async function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── CORE AI CALL — routes to correct provider ────────────────────────────────
async function callAI(provider, apiKey, model, prompt, base64, mimeType = "image/jpeg") {
  let raw = "";

  if (provider === "groq") {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: 1000, temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]}]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    raw = data.choices?.[0]?.message?.content || "";

  } else if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.05, maxOutputTokens: 1000 }
        })
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  } else if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: 1000, temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: prompt }
        ]}]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    raw = data.choices?.[0]?.message?.content || "";

  } else if (provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model, max_tokens: 1000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
          { type: "text", text: prompt }
        ]}]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    raw = data.content?.[0]?.text || "";

  } else if (provider === "mistral") {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: 1000, temperature: 0.05,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: prompt }
        ]}]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    raw = data.choices?.[0]?.message?.content || "";
  }

  // Parse JSON — strip any accidental markdown fences
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ─── MAIN EXPORT: Extract from image (with optional verification pass) ─────────
export async function callGroq(apiKey, base64, mimeType = "image/jpeg", providerOverride = null, modelOverride = null) {
  // Determine provider + model
  // providerOverride comes from settings.aiProvider; modelOverride from settings.aiModel
  // Falls back to groq for backwards compatibility
  const provider = providerOverride || "groq";
  const model = modelOverride || AI_PROVIDERS[provider]?.defaultModel ||
    "meta-llama/llama-4-scout-17b-16e-instruct";

  // Pass 1: Extract
  const first = await callAI(provider, apiKey, model, EXTRACTION_PROMPT, base64, mimeType);

  // Pass 2: Verify (always — cheap insurance against digit misreads)
  let result;
  try {
    const verified = await callAI(provider, apiKey, model, VERIFY_PROMPT(first), base64, mimeType);
    // Merge: prefer verified values for numeric fields (most likely to have errors)
    result = {
      ...first,
      lastFourDigits: verified.lastFourDigits ?? first.lastFourDigits,
      dueAmount:      verified.dueAmount      ?? first.dueAmount,
      dueDate:        verified.dueDate        ?? first.dueDate,
      cardholderName: verified.cardholderName ?? first.cardholderName,
      bankName:       verified.bankName       ?? first.bankName,
      statementDate:  verified.statementDate  ?? first.statementDate,
      paymentsReceived: verified.paymentsReceived ?? first.paymentsReceived,
      accumulatedSpends: verified.accumulatedSpends ?? first.accumulatedSpends,
    };
  } catch (_) {
    // If verification fails, use first pass result — don't block the flow
    result = first;
  }

  return result;
}

// ─── GMAIL ────────────────────────────────────────────────────────────────────
export async function gmailFetch(path, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

export async function fetchStatementEmails(token, afterDate = null) {
  const base = 'has:attachment filename:pdf (subject:statement OR subject:e-statement OR subject:"credit card" OR subject:"account statement" OR subject:bill OR subject:"due date" OR subject:outstanding)';
  const dateFilter = afterDate ? ` after:${afterDate}` : "";
  const q = encodeURIComponent(base + dateFilter);
  const d = await gmailFetch(`users/me/messages?q=${q}&maxResults=100`, token);
  return d.messages || [];
}

export async function fetchEmailWithAttachments(messageId, token) {
  const msg = await gmailFetch(`users/me/messages/${messageId}?format=full`, token);
  const hdr = (name) => msg.payload?.headers?.find(h => h.name === name)?.value || "";
  const toAddress = hdr("To") || hdr("Delivered-To") || "";
  const pdfParts = []; let bodyText = ""; let htmlText = "";
  function collect(parts) {
    if (!parts) return;
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        try { bodyText += atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/")); } catch {}
      }
      if (p.mimeType === "text/html" && p.body?.data) {
        try {
          const html = atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/"));
          const stripped = html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&#\d+;/g, " ")
            .replace(/\s+/g, " ").trim();
          htmlText += stripped;
        } catch {}
      }
      if (p.mimeType === "application/pdf" || (p.filename && p.filename.toLowerCase().endsWith(".pdf")))
        pdfParts.push(p);
      if (p.parts) collect(p.parts);
    }
  }
  collect(msg.payload?.parts);
  const finalBodyText = bodyText.trim() || htmlText.trim();
  return { messageId, subject: hdr("Subject"), date: hdr("Date"), toAddress, pdfParts, bodyText: finalBodyText };
}

export async function downloadAttachment(msgId, attId, token) {
  const d = await gmailFetch(`users/me/messages/${msgId}/attachments/${attId}`, token);
  return d.data.replace(/-/g, "+").replace(/_/g, "/");
}
