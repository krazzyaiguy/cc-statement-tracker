# 🔧 Setup Guide — CC Statement Tracker

This guide covers two things:
1. Deploying the app to Vercel (free)
2. Setting up Gmail access via Google Cloud (free, one-time 10-minute setup)

---

## PART 1 — Deploy to Vercel

### Step 1 — GitHub
1. Go to github.com → Sign up (free) → Click + → New repository
2. Name it: cc-statement-tracker
3. Click Create repository
4. Click "uploading an existing file"
5. Upload all files from this folder (public/, src/, package.json, etc.)
6. Click Commit changes

### Step 2 — Vercel
1. Go to vercel.com → Sign up with GitHub (free)
2. Click Add New Project → Select cc-statement-tracker → Import
3. Leave all settings as default → Click Deploy
4. Wait ~2 minutes → you get a URL like: https://cc-statement-tracker.vercel.app
5. SAVE THIS URL — you'll need it in Part 2

---

## PART 2 — Google Cloud Setup (for Gmail Auto-Sync)

This lets the app sign in with your Google account and read your Gmail.
It's free and takes about 10 minutes.

### Step 1 — Create a Google Cloud Project
1. Go to: https://console.cloud.google.com
2. Sign in with your Google account
3. Click the project dropdown at the top → "New Project"
4. Name it: CC Statement Tracker
5. Click Create
6. Wait a few seconds, then select the new project from the dropdown

### Step 2 — Enable the Gmail API
1. In the left menu, go to: APIs & Services → Library
2. Search for: Gmail API
3. Click Gmail API → Click Enable

### Step 3 — Configure OAuth Consent Screen
1. Go to: APIs & Services → OAuth consent screen
2. Choose User Type: External → Click Create
3. Fill in:
   - App name: CC Statement Tracker
   - User support email: (your Gmail)
   - Developer contact email: (your Gmail)
4. Click Save and Continue
5. On "Scopes" page → Click Save and Continue (no changes needed)
6. On "Test users" page → Click + Add Users → Add your Gmail address
7. Click Save and Continue → Back to Dashboard

### Step 4 — Create OAuth Credentials
1. Go to: APIs & Services → Credentials
2. Click + Create Credentials → OAuth client ID
3. Application type: Web application
4. Name: CC Statement Tracker Web
5. Under "Authorized JavaScript origins" → Click + Add URI:
   → Add: https://your-vercel-url.vercel.app
   → Also add: http://localhost:3000 (for local testing)
6. Under "Authorized redirect URIs" → Click + Add URI:
   → Add: https://your-vercel-url.vercel.app
   → Also add: http://localhost:3000
7. Click Create

### Step 5 — Copy your Client ID
1. A popup shows your credentials
2. Copy the "Client ID" — it looks like: 1234567890-abcdef.apps.googleusercontent.com
3. Keep this — you'll paste it into the app

### Step 6 — Enter the Client ID in the App
1. Open your Vercel app URL
2. On first launch → enter your Gemini API key
3. Paste your Google Client ID in the second field
4. Click Save & Continue

OR if you already set up the app:
1. Go to ⚙ Settings tab
2. Paste Client ID → Save Settings

---

## PART 3 — Using the App

### First-time setup
1. Open the app → Enter Gemini API key (from aistudio.google.com/apikey)
2. Enter Google Client ID (from Step 5 above)
3. Go to 🔐 Password Vault → Add your bank passwords:
   - Bank name: hdfc → Password: (your HDFC PDF password)
   - Bank name: icici → Password: (your ICICI PDF password)
   - etc.

### Every month (takes 30 seconds)
1. Open the app
2. Go to ⚡ Gmail Sync tab
3. Click "Sign in with Google" (first time only)
4. Click "⚡ Sync Gmail Now"
5. App finds all new statement emails automatically
6. Unlocks PDFs using saved vault passwords
7. Extracts all data → adds to tracker

### Mark bills as paid
- Go to 📋 Tracker tab
- Tap PENDING on any row when you've paid that card
- Red → Green, row dims

### Export to Excel
- Click ⬇ Export Excel in Tracker tab
- Opens as .xlsx file with all data + paid/pending status

---

## Troubleshooting

**"This app isn't verified" warning in Google sign-in:**
→ Click "Advanced" → "Go to CC Statement Tracker (unsafe)"
→ This appears because the app is in test mode. It's your own app — it's safe.
→ To remove this: complete Google's app verification process (optional).

**Gmail sync finds 0 emails:**
→ Make sure your bank statements arrive as email with PDF attachments
→ Try searching your Gmail manually for: has:attachment filename:pdf statement

**Wrong password error during sync:**
→ Go to 🔐 Password Vault → check the bank name spelling
→ The vault matches bank name against the email subject line
→ Make sure the bank name you entered appears in the email subject

**OAuth redirect error:**
→ Double-check that your exact Vercel URL is in "Authorized JavaScript origins"
→ No trailing slash: https://your-app.vercel.app ✓ (not https://your-app.vercel.app/)

---

## Cost Summary

| Item              | Cost        |
|-------------------|-------------|
| Vercel hosting    | Free        |
| GitHub            | Free        |
| Google Cloud      | Free        |
| Gmail API         | Free        |
| Gemini API        | Free (1,500 req/day) |
| **Total/month**   | **₹0**      |
