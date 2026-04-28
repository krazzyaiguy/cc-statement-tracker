import { useState } from "react";
import { initFirebase } from "../firebase";
import { S } from "./Panels";
import { AI_PROVIDERS } from "../utils/pdfGroqGmail";

export function SetupScreen({ onSave }) {
  const [provider,       setProvider]       = useState("groq");
  const [apiKey,         setApiKey]         = useState("");
  const [selectedModel,  setSelectedModel]  = useState(AI_PROVIDERS.groq.defaultModel);
  const [fbConfig,       setFbConfig]       = useState({ apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" });
  const [googleClientId, setGoogleClientId] = useState("");
  const [step,           setStep]           = useState(1);
  const [testing,        setTesting]        = useState(false);
  const [error,          setError]          = useState("");

  const prov = AI_PROVIDERS[provider];

  const handleProviderChange = (p) => {
    setProvider(p);
    setSelectedModel(AI_PROVIDERS[p].defaultModel);
    setApiKey("");
    setError("");
  };

  const testKey = async () => {
    if (!apiKey.trim()) { setError("Enter an API key first"); return; }
    setTesting(true); setError("");
    try {
      if (provider === "claude") {
        // Claude has no cheap public test endpoint — just accept the key
        setStep(2);
        setTesting(false);
        return;
      }
      const res = await AI_PROVIDERS[provider].testUrl(apiKey.trim());
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      setStep(2);
    } catch (e) {
      setError(`${prov.label} key error: ${e.message}`);
    }
    setTesting(false);
  };

  const finish = () => {
    const fbReady = fbConfig.apiKey.trim() && fbConfig.projectId.trim();
    if (fbReady) {
      try { initFirebase(fbConfig); }
      catch (e) { setError("Firebase config error: " + e.message); return; }
    }
    onSave({
      // Keep "geminiKey" field name for backwards compat — it holds whichever key the user entered
      geminiKey:      apiKey.trim(),
      aiProvider:     provider,
      aiModel:        selectedModel,
      firebaseConfig: fbReady ? fbConfig : null,
      googleClientId: googleClientId.trim(),
    });
  };

  const PROVIDER_LIST = [
    { id: "groq",    icon: "⚡", badge: "Free",    color: "#f97316" },
    { id: "gemini",  icon: "🔷", badge: "Free",    color: "#60a5fa" },
    { id: "openai",  icon: "◎",  badge: "Paid",    color: "#4ade80" },
    { id: "claude",  icon: "🌊", badge: "Paid",    color: "#a78bfa" },
    { id: "mistral", icon: "🌀", badge: "Paid",    color: "#f472b6" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080c14", padding: 24 }}>
      <div style={{ ...S.card, padding: "36px 28px", maxWidth: 540, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: 34, marginBottom: 12 }}>💳</div>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 6, background: "linear-gradient(90deg,#e2e8f0,#64748b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          CC Statement Tracker
        </h1>

        {/* Step indicators */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {["1 AI Provider", "2 Firebase", "3 Gmail"].map((s, i) => (
            <div key={s} style={{ flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: 7, background: step === i + 1 ? "#1e40af" : step > i + 1 ? "#052e16" : "#0d1424", border: `1px solid ${step === i + 1 ? "#3b82f6" : step > i + 1 ? "#14532d" : "#1e293b"}`, fontSize: 10, color: step === i + 1 ? "#93c5fd" : step > i + 1 ? "#4ade80" : "#334155", fontWeight: 600 }}>
              {step > i + 1 ? "✓ " : ""}{s}
            </div>
          ))}
        </div>

        {/* ── STEP 1: AI Provider ── */}
        {step === 1 && (
          <div>
            <p style={{ color: "#475569", fontSize: 12, lineHeight: 1.8, marginBottom: 16 }}>
              Choose an AI provider to read your PDF statements.
            </p>

            {/* Provider grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 18 }}>
              {PROVIDER_LIST.map(({ id, icon, badge, color }) => (
                <button key={id} onClick={() => handleProviderChange(id)}
                  style={{ background: provider === id ? "#0d1f3c" : "#0d1424", border: `1px solid ${provider === id ? "#3b82f6" : "#1e293b"}`, borderRadius: 8, padding: "10px 4px", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 10, color: provider === id ? "#e2e8f0" : "#475569", fontWeight: 600, fontFamily: "'DM Mono',monospace" }}>{AI_PROVIDERS[id].label.split(" ")[0]}</div>
                  <div style={{ fontSize: 9, color, marginTop: 2 }}>{badge}</div>
                  {provider === id && <div style={{ fontSize: 9, color: "#3b82f6", marginTop: 3 }}>● selected</div>}
                </button>
              ))}
            </div>

            {/* Key input */}
            <label style={S.label}>{prov.label} API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && testKey()}
              placeholder={prov.keyPlaceholder}
              style={{ ...S.input, marginBottom: 6 }}
            />
            <div style={{ color: "#334155", fontSize: 10, marginBottom: 10 }}>
              Get key → <a href={prov.keyLink} target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>{prov.keyLink.replace("https://", "")}</a>
              {" · "}{prov.keyNote}
            </div>

            {/* Model selector */}
            <label style={S.label}>Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{ ...S.input, marginBottom: 14, cursor: "pointer" }}
            >
              {prov.models.map(m => (
                <option key={m} value={m} style={{ background: "#0d1424" }}>{m}</option>
              ))}
            </select>

            {/* Provider notes */}
            <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 11, color: "#475569", lineHeight: 1.8 }}>
              {provider === "groq"    && <><span style={{ color: "#f97316" }}>Groq</span> — Fast and free. Llama 4 Scout has vision. Best value for most users.</>}
              {provider === "gemini"  && <><span style={{ color: "#60a5fa" }}>Gemini Flash</span> — Free tier: 1500 req/day. Excellent accuracy on Indian statements.</>}
              {provider === "openai"  && <><span style={{ color: "#4ade80" }}>GPT-4o</span> — Best overall accuracy. Paid per request (~$0.01 per statement).</>}
              {provider === "claude"  && <><span style={{ color: "#a78bfa" }}>Claude Haiku</span> — Excellent accuracy, fast. Paid per request (~$0.005 per statement).</>}
              {provider === "mistral" && <><span style={{ color: "#f472b6" }}>Pixtral</span> — Good vision model. Paid. Useful if other providers are blocked.</>}
            </div>

            {error && <div style={{ background: "#3b1111", color: "#f87171", borderRadius: 6, padding: "8px 12px", fontSize: 11, marginBottom: 12 }}>✕ {error}</div>}
            <button onClick={testKey} disabled={!apiKey.trim() || testing}
              style={{ ...S.btn("#15803d", !apiKey.trim() || testing), width: "100%", padding: "12px" }}>
              {testing ? "⟳ Verifying…" : provider === "claude" ? "Save & Next →" : "Verify & Next →"}
            </button>
          </div>
        )}

        {/* ── STEP 2: Firebase (unchanged) ── */}
        {step === 2 && (
          <div>
            <p style={{ color: "#475569", fontSize: 12, lineHeight: 1.8, marginBottom: 16 }}>
              Firebase syncs your vault & records across <strong style={{ color: "#94a3b8" }}>all devices</strong>. Free forever (Spark plan).
            </p>
            <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 11, color: "#475569", lineHeight: 1.9 }}>
              <div style={{ color: "#60a5fa", fontWeight: 600, marginBottom: 4 }}>Setup Firebase (free, 5 min):</div>
              1. Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>console.firebase.google.com</a><br />
              2. Create project → Add web app → Copy config<br />
              3. Enable <strong style={{ color: "#94a3b8" }}>Authentication</strong> → Sign-in method → Google<br />
              4. Enable <strong style={{ color: "#94a3b8" }}>Firestore Database</strong> → Start in test mode<br />
              5. Paste each config value below
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[["apiKey", "API Key"], ["authDomain", "Auth Domain"], ["projectId", "Project ID"], ["storageBucket", "Storage Bucket"], ["messagingSenderId", "Messaging Sender ID"], ["appId", "App ID"]].map(([k, label]) => (
                <div key={k}>
                  <label style={{ ...S.label, fontSize: 9 }}>{label}</label>
                  <input value={fbConfig[k]} onChange={e => setFbConfig(p => ({ ...p, [k]: e.target.value }))}
                    placeholder={k === "authDomain" ? "xxx.firebaseapp.com" : k === "projectId" ? "your-project-id" : ""}
                    style={{ ...S.input, fontSize: 11, padding: "8px 10px" }} />
                </div>
              ))}
            </div>
            {error && <div style={{ background: "#3b1111", color: "#f87171", borderRadius: 6, padding: "8px 12px", fontSize: 11, marginBottom: 12 }}>✕ {error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep(3)} disabled={!fbConfig.apiKey.trim() || !fbConfig.projectId.trim()}
                style={{ ...S.btn("#1d4ed8", !fbConfig.apiKey.trim() || !fbConfig.projectId.trim()), flex: 1, padding: "11px" }}>Next →</button>
              <button onClick={() => setStep(3)} style={{ background: "none", border: "1px solid #1e293b", color: "#475569", borderRadius: 8, padding: "11px 14px", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11 }}>Skip (local only)</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Gmail (unchanged) ── */}
        {step === 3 && (
          <div>
            <p style={{ color: "#475569", fontSize: 12, lineHeight: 1.8, marginBottom: 16 }}>Google Client ID enables Gmail auto-sync. See SETUP_GUIDE.md.</p>
            <label style={S.label}>Google OAuth Client ID <span style={{ color: "#475569" }}>(optional)</span></label>
            <input type="text" value={googleClientId} onChange={e => setGoogleClientId(e.target.value)}
              placeholder="xxxxxxx.apps.googleusercontent.com"
              style={{ ...S.input, marginBottom: 16 }} />
            <button onClick={finish} style={{ ...S.btn("#15803d"), width: "100%", padding: "12px" }}>
              🚀 Launch App →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
