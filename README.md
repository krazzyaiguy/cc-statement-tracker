# 💳 CC Statement Tracker

Auto-extract credit card statement data from PDFs and images using **Google Gemini AI (Free)** — track and export to Excel.

Works on mobile, tablet, and desktop.

---

## ✨ Features
- Upload PDFs or images (tap to browse or drag & drop)
- Auto-detects password-protected PDFs — prompts for password
- AI extracts: cardholder name, bank, last 4 digits, statement date, due date, amount
- Records persist across sessions — add statements as they arrive throughout the month
- Mark statements PAID / PENDING with one tap
- Export all records to Excel (.xlsx)
- Fully mobile-friendly — add to home screen like an app
- 100% free — Gemini free tier covers 1,500 requests/day

---

## 🚀 Deploy to Vercel (Free — 10 Minutes)

### Step 1 — GitHub
1. Go to github.com → Sign up (free) → Click + → New repository
2. Name it cc-statement-tracker → Create repository
3. Click "uploading an existing file"
4. Upload all files from this folder (keep folder structure)
5. Click Commit changes

### Step 2 — Vercel
1. Go to vercel.com → Sign up with GitHub (free)
2. Click Add New Project → Select cc-statement-tracker → Import
3. Leave all settings default → Click Deploy
4. Wait ~2 minutes → you get a live URL like: https://cc-statement-tracker.vercel.app

### Step 3 — Get your FREE Gemini API Key
1. Go to: https://aistudio.google.com/apikey
2. Sign in with your Google account (Gmail)
3. Click "Create API key" → Copy it (starts with AIza...)
4. Open your app URL → paste the key → tap Save & Continue

### Step 4 — Add to Home Screen
iPhone/iPad (Safari): Share button → Add to Home Screen
Android (Chrome): 3-dot menu → Add to Home screen

---

## 💰 Cost: ₹0/month
- Vercel: Free
- GitHub: Free  
- Gemini API for 100 statements: Free (within 1,500/day free tier)

---

## 🔐 Privacy
- PDFs unlocked in your browser — password never sent anywhere
- API key stored only in your browser's localStorage
- No backend server — everything runs client-side

---

## 🛠 Run Locally
npm install
npm start
# Opens at http://localhost:3000
