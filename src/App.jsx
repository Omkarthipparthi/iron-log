import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from "recharts";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  linkWithCredential,
  EmailAuthProvider
} from "firebase/auth";

// ─── Exercise Database ────────────────────────────────────────
const EXERCISE_DB = {
  Chest: [
    "Barbell bench press","Incline barbell press","Dumbbell bench press","Incline dumbbell press",
    "Decline bench press","Dumbbell flyes","Cable flyes","Chest dips","Push-ups","Cable crossovers",
    "Machine chest press","Pec deck"
  ],
  Back: [
    "Deadlift","Barbell row","Dumbbell row","Pull-ups","Chin-ups","Lat pulldown",
    "Seated cable row","T-bar row","Face pulls","Straight arm pulldown",
    "Rack pulls","Pendlay row","Meadows row","Hyperextensions"
  ],
  Shoulders: [
    "Overhead press","Dumbbell shoulder press","Arnold press","Lateral raises",
    "Front raises","Rear delt flyes","Upright rows","Cable lateral raises",
    "Face pulls","Shrugs"
  ],
  Legs: [
    "Barbell squat","Front squat","Leg press","Romanian deadlift","Bulgarian split squat",
    "Lunges","Leg extension","Leg curl","Hip thrust","Calf raises",
    "Goblet squat","Hack squat","Sumo deadlift","Step-ups","Sissy squat","Nordic curl"
  ],
  Arms: [
    "Barbell curl","Dumbbell curl","Hammer curl","Preacher curl","Cable curl",
    "Tricep pushdown","Skull crushers","Overhead tricep extension","Close grip bench press",
    "Dips (tricep)","Concentration curl"
  ],
  Core: [
    "Plank","Hanging leg raise","Cable crunch","Ab wheel rollout","Russian twist",
    "Bicycle crunch","Dead bug","Pallof press","Woodchoppers"
  ]
};

const MUSCLE_GROUPS = Object.keys(EXERCISE_DB);
const WORKOUT_TYPES = ["Strength","Hypertrophy","Cardio","HIIT","Endurance","Flexibility","CrossFit"];
const DAYS = ["M","T","W","T","F","S","S"];
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const today = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};
const dayOfWeek = () => (new Date().getDay() + 6) % 7; // 0=Mon ... 6=Sun
const dayFromDate = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  return (d.getDay() + 6) % 7;
};
const dateFromDay = (currentDateStr, targetDay) => {
  const d = new Date(currentDateStr + "T12:00:00");
  const currentDay = (d.getDay() + 6) % 7; // 0=Mon
  const diff = targetDay - currentDay;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};
const formatDate = (s) => {
  const d = new Date(s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

const kgToLbs = (kg) => Math.round(kg * 2.20462 * 10) / 10;
const lbsToKg = (lbs) => Math.round(lbs / 2.20462 * 10) / 10;

const emptyExercise = () => ({
  id: Date.now() + Math.random(),
  name: "",
  notes: "",
  sets: [{ reps: "", weight: "" },{ reps: "", weight: "" },{ reps: "", weight: "" }]
});

const emptyWorkout = () => ({
  id: Date.now(),
  date: today(),
  day: dayOfWeek(),
  startTime: nowTime(),
  finishTime: "",
  workoutType: "Strength",
  muscleGroup: "Chest",
  energy: 3,
  exercises: [emptyExercise()],
  unit: "kg"
});

// ─── Storage Abstraction Layer ────────────────────────────────
const STORAGE_BACKEND = "firebase"; // "local" | "firebase" | "mongo"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

if (typeof window !== "undefined") {
  getAnalytics(app);
}

// ── Local (window.storage / window.localStorage) adapter ──
const localAdapter = {
  async get(key) {
    try {
      if (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") {
        const r = await window.storage.get(key);
        return r ? JSON.parse(r.value) : null;
      } else if (typeof window !== "undefined" && window.localStorage) {
        const r = window.localStorage.getItem(key);
        return r ? JSON.parse(r) : null;
      }
      return null;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      if (typeof window !== "undefined" && window.storage && typeof window.storage.set === "function") {
        await window.storage.set(key, JSON.stringify(value));
      } else if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    }
    catch (e) { console.error("Storage save failed", e); }
  },
  async delete(key) {
    try {
      if (typeof window !== "undefined" && window.storage && typeof window.storage.delete === "function") {
        await window.storage.delete(key);
      } else if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {}
  }
};

// ── Firebase adapter ──
const firebaseAdapter = {
  async get(userId) {
    const snap = await getDoc(doc(db, "users", userId));
    return snap.exists() ? snap.data() : null;
  },
  async set(userId, value) {
    await setDoc(doc(db, "users", userId), { ...value, updatedAt: new Date() }, { merge: true });
  },
  async delete(userId) {
    await deleteDoc(doc(db, "users", userId));
  }
};

// Expose storage fallback state
export let storageFallbackActive = false;

// Helper to race a promise with a timeout duration (ms)
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), ms);
    promise.then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Unified storage interface with automatic fallback ──
const store = {
  async get(key) {
    const user = auth.currentUser;
    if (!user) return null;
    
    if (STORAGE_BACKEND === "firebase" && !storageFallbackActive) {
      try {
        return await withTimeout(firebaseAdapter.get(user.uid), 1500);
      } catch (e) {
        console.error("Firebase load failed or timed out, falling back to LocalStorage", e);
        storageFallbackActive = true;
      }
    }
    return await localAdapter.get(`${user.uid}_${key}`);
  },
  async set(key, value) {
    const user = auth.currentUser;
    if (!user) return;

    if (STORAGE_BACKEND === "firebase" && !storageFallbackActive) {
      try {
        await withTimeout(firebaseAdapter.set(user.uid, value), 1500);
        return;
      } catch (e) {
        console.error("Firebase save failed or timed out, falling back to LocalStorage", e);
        storageFallbackActive = true;
      }
    }
    await localAdapter.set(`${user.uid}_${key}`, value);
  },
  async delete(key) {
    const user = auth.currentUser;
    if (!user) return;

    if (STORAGE_BACKEND === "firebase" && !storageFallbackActive) {
      try {
        await withTimeout(firebaseAdapter.delete(user.uid), 1500);
        return;
      } catch (e) {
        console.error("Firebase delete failed or timed out, falling back to LocalStorage", e);
        storageFallbackActive = true;
      }
    }
    await localAdapter.delete(`${user.uid}_${key}`);
  }
};

// ─── Play Synthesized Rest Sound ────────────────────────────────
const playRestCompleteSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    playTone(880, 0, 0.15); 
    playTone(1320, 0.15, 0.3);
  } catch (e) {
    console.error("Web Audio Sound synthesis failed", e);
  }
};

// ─── Styles ───────────────────────────────────────────────────
const S = {
  app: { fontFamily: "'Outfit', 'DM Sans', sans-serif", maxWidth: 520, margin: "0 auto", color: "#e2e8f0", background: "#0b0f19", minHeight: "100vh", position: "relative", paddingBottom: 84, boxShadow: "0 0 40px rgba(0,0,0,0.6)", borderLeft: "1px solid #1e293b", borderRight: "1px solid #1e293b", boxSizing: "border-box" },
  header: { padding: "18px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", background: "rgba(21, 28, 44, 0.4)", backdropFilter: "blur(10px)" },
  logo: { fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: "#ffffff", display: "flex", alignItems: "center" },
  accentLogo: { color: "#00f59b", textShadow: "0 0 10px rgba(0, 245, 155, 0.4)" },
  unitToggle: { display: "flex", background: "#0f1524", borderRadius: 10, overflow: "hidden", fontSize: 12, border: "1px solid #1e293b", padding: 2 },
  unitBtn: (active) => ({ padding: "5px 12px", cursor: "pointer", background: active ? "#00f59b" : "transparent", color: active ? "#05070c" : "#94a3b8", transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)", border: "none", fontWeight: 700, fontSize: 12, borderRadius: 8 }),
  nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 520, display: "flex", justifyContent: "space-around", background: "rgba(11, 15, 25, 0.85)", backdropFilter: "blur(12px)", borderTop: "1px solid #1e293b", padding: "8px 0 16px", zIndex: 100 },
  navItem: (active) => ({ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 10, fontWeight: active ? 700 : 500, color: active ? "#00f59b" : "#64748b", cursor: "pointer", padding: "4px 8px", transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)", border: "none", background: "none" }),
  navIcon: (active) => ({ fontSize: 20, color: active ? "#00f59b" : "#64748b", textShadow: active ? "0 0 10px rgba(0, 245, 155, 0.4)" : "none", transition: "all .2s" }),
  page: { padding: "20px" },
  card: { background: "#151c2c", borderRadius: 16, border: "1px solid #1e293b", padding: "18px", marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)" },
  cardTitle: { fontSize: 15, fontWeight: 700, color: "#ffffff", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 10, fontWeight: 700, color: "#00f59b", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #1e293b", borderRadius: 10, fontSize: 14, background: "#0f1524", outline: "none", boxSizing: "border-box", color: "#f8fafc", fontFamily: "'Outfit', sans-serif", transition: "all .2s" },
  select: { width: "100%", padding: "10px 12px", border: "1px solid #1e293b", borderRadius: 10, fontSize: 14, background: "#0f1524", outline: "none", boxSizing: "border-box", color: "#f8fafc", appearance: "auto", fontFamily: "'Outfit', sans-serif" },
  row: { display: "flex", gap: 12 },
  col: { flex: 1 },
  dayPill: (active) => ({ width: 32, height: 32, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, cursor: "pointer", border: active ? "1px solid #00f59b" : "1px solid #1e293b", background: active ? "rgba(0, 245, 155, 0.15)" : "#0f1524", color: active ? "#00f59b" : "#94a3b8", transition: "all .2s", textShadow: active ? "0 0 8px rgba(0, 245, 155, 0.3)" : "none" }),
  energyBar: (filled) => ({ width: 22, height: 24, borderRadius: 6, border: `1.5px solid ${filled ? "#00f59b" : "#334155"}`, background: filled ? "rgba(0, 245, 155, 0.2)" : "transparent", cursor: "pointer", transition: "all .15s", boxShadow: filled ? "inset 0 0 6px rgba(0, 245, 155, 0.3)" : "none" }),
  btn: { padding: "12px 20px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all .2s cubic-bezier(0.4, 0, 0.2, 1)", fontFamily: "'Outfit', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 },
  btnPrimary: { background: "#00f59b", color: "#05070c", boxShadow: "0 4px 12px rgba(0, 245, 155, 0.25)" },
  btnOutline: { background: "#0f1524", border: "1px solid #1e293b", color: "#e2e8f0" },
  btnDanger: { background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)" },
  exerciseTable: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 },
  th: { padding: "8px 4px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "1px solid #1e293b", textTransform: "uppercase", letterSpacing: 0.8 },
  setInput: { width: "100%", padding: "6px 4px", border: "1px solid #1e293b", borderRadius: 8, textAlign: "center", fontSize: 13, background: "#0f1524", outline: "none", boxSizing: "border-box", color: "#ffffff", fontFamily: "'Outfit', sans-serif" },
  notesInput: { width: "100%", padding: "8px 10px", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12, background: "#0f1524", outline: "none", boxSizing: "border-box", color: "#94a3b8", fontStyle: "italic", marginTop: 8 },
  chip: (bg, color) => ({ display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: bg, color, textTransform: "uppercase", letterSpacing: 0.5 }),
  histItem: { padding: "14px 0", borderBottom: "1px solid #1e293b", cursor: "pointer" },
  searchBox: { width: "100%", padding: "11px 12px 11px 38px", border: "1px solid #1e293b", borderRadius: 12, fontSize: 14, background: "#151c2c", outline: "none", boxSizing: "border-box", color: "#ffffff", fontFamily: "'Outfit', sans-serif", transition: "all .2s" },
  muscleCard: (active) => ({ padding: "12px 16px", borderRadius: 12, border: active ? "1.5px solid #00f59b" : "1px solid #1e293b", background: active ? "rgba(0, 245, 155, 0.05)" : "#151c2c", cursor: "pointer", transition: "all .2s", boxShadow: active ? "0 0 12px rgba(0, 245, 155, 0.1)" : "none" }),
  toast: { position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", background: "#00f59b", color: "#05070c", padding: "12px 28px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, boxShadow: "0 8px 30px rgba(0, 245, 155, 0.3)", animation: "fadeIn .3s cubic-bezier(0.16, 1, 0.3, 1)", letterSpacing: 0.3 }
};

// ─── Components ───────────────────────────────────────────────

function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, []);
  return <div style={S.toast}>{msg}</div>;
}

// ─── AUTH SCREEN ──────────────────────────────────────────────
function AuthScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // Main app useEffect will detect user state change
    } catch (e) {
      console.error(e);
      setError("Google authentication failed.");
      setLoading(false);
    }
  };

  const handlePinUnlock = async (e) => {
    e.preventDefault();
    if (!username.trim() || !pin) {
      setError("Enter a valid username and PIN.");
      return;
    }
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits.");
      return;
    }

    setLoading(true);
    setError("");

    const virtualEmail = `${username.trim().toLowerCase()}@ironlog.app`;
    const virtualPassword = `${pin}_ironlog_pin_secure`;

    try {
      await signInWithEmailAndPassword(auth, virtualEmail, virtualPassword);
    } catch (e) {
      console.error(e);
      setError("Invalid username or PIN. First-time users must sign up with Google first.");
      setLoading(false);
    }
  };

  return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "80vh", paddingTop: 40 }}>
      
      {/* Visual Title / Brand */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 60, marginBottom: 8, display: "inline-block", animation: "pulseGlow 2s infinite", borderRadius: "50%", padding: 10 }}>🏋️</div>
        <h2 style={{ fontSize: 32, fontWeight: 700, margin: 0, letterSpacing: -0.5, color: "#fff" }}>
          IRON <span style={S.accentLogo}>LOG</span>
        </h2>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 4, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700 }}>
          Premium Lifter Dashboard
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 12, padding: "12px 16px", color: "#ef4444", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Login Panels */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        
        {/* Google Signup Mandate */}
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", textAlign: "center", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
            New User / Register
          </div>
          <button 
            onClick={handleGoogleLogin} 
            disabled={loading}
            style={{ ...S.btn, ...S.btnPrimary, width: "100%", height: 48, position: "relative" }}
          >
            <span style={{ marginRight: 6 }}>🌐</span> 
            {loading ? "Authenticating..." : "Continue with Google"}
          </button>
          <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>
            *Mandatory for first-time sign-ups to link your secure identity.
          </div>
        </div>

        {/* Separator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
          <span style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>OR QUICK UNLOCK</span>
          <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
        </div>

        {/* PIN Unlock Keypad Form */}
        <form onSubmit={handlePinUnlock} style={{ ...S.card, margin: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={S.label}>Username</label>
              <input 
                type="text" 
                placeholder="Enter username"
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                style={S.input}
                disabled={loading}
                autoCapitalize="none"
              />
            </div>
            <div>
              <label style={S.label}>Numeric PIN</label>
              <input 
                type="password" 
                pattern="[0-9]*" 
                inputMode="numeric"
                maxLength="6"
                placeholder="••••"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                style={{ ...S.input, letterSpacing: pin ? 6 : 0, textAlign: pin ? "center" : "left", fontSize: 16 }}
                disabled={loading}
              />
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              style={{ ...S.btn, ...S.btnOutline, width: "100%", height: 48, borderColor: "#00f59b", color: "#00f59b", textShadow: "0 0 6px rgba(0, 245, 155, 0.2)", marginTop: 8 }}
            >
              🔓 {loading ? "Unlocking..." : "Unlock Dashboard"}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

// ─── FIRST TIME ONBOARDING MODAL ──────────────────────────────
function OnboardingModal({ user, onComplete }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, "");
    if (!cleanUsername || cleanUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (!pin || pin.length < 4 || pin.length > 6) {
      setError("PIN must be a 4 to 6 digit number.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 1. Verify username uniqueness in Firestore
      const userRef = doc(db, "usernames", cleanUsername);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        setError("Username is already taken. Try a different one.");
        setLoading(false);
        return;
      }

      // 2. Link Email/Password credential to the Google Account!
      const virtualEmail = `${cleanUsername}@ironlog.app`;
      const virtualPassword = `${pin}_ironlog_pin_secure`;
      const credential = EmailAuthProvider.credential(virtualEmail, virtualPassword);

      // Link to Google Account
      await linkWithCredential(user, credential);

      // 3. Register username lookup
      await setDoc(userRef, { uid: user.uid });

      // 4. Migrate local workouts if they exist in localStorage under default keys
      const localW = await localAdapter.get("workouts-data") || [];
      const localU = await localAdapter.get("unit-pref") || "kg";

      // 5. Initialize user profile document
      await setDoc(doc(db, "users", user.uid), {
        username: cleanUsername,
        workouts: localW,
        unit: localU
      });

      // 6. Delete old local keys to clean up storage
      await localAdapter.delete("workouts-data");
      await localAdapter.delete("unit-pref");

      onComplete();
    } catch (e) {
      console.error(e);
      setError("Registration failed. Please check your connection.");
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(5, 7, 12, 0.9)", backdropFilter: "blur(8px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleRegister} style={{ ...S.card, width: 340, padding: 24, background: "#0f1524", borderColor: "#00f59b", animation: "fadeIn .3s", boxShadow: "0 10px 40px rgba(0, 245, 155, 0.2)" }}>
        
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 36, display: "block", marginBottom: 6 }}>🌱</span>
          <h3 style={{ margin: "0 0 4px", color: "#ffffff", fontSize: 18 }}>SECURE QUICK-LOG</h3>
          <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.4 }}>
            Link a unique username and a numeric PIN to unlock your dashboard quickly on the gym floor.
          </p>
        </div>

        {error && (
          <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 10, padding: 10, color: "#ef4444", fontSize: 12, marginBottom: 12, textAlign: "center" }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
          <div>
            <label style={S.label}>Create Username</label>
            <input 
              type="text" 
              placeholder="e.g. iron_beast"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              style={S.input}
              disabled={loading}
              autoCapitalize="none"
            />
          </div>
          <div>
            <label style={S.label}>Choose Numeric PIN (4-6 digits)</label>
            <input 
              type="password" 
              pattern="[0-9]*" 
              inputMode="numeric"
              maxLength="6"
              placeholder="e.g. 1234"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
              style={{ ...S.input, letterSpacing: pin ? 6 : 0, textAlign: pin ? "center" : "left", fontSize: 16 }}
              disabled={loading}
            />
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading}
          style={{ ...S.btn, ...S.btnPrimary, width: "100%", height: 44 }}
        >
          {loading ? "Registering..." : "Complete Setup"}
        </button>
      </form>
    </div>
  );
}

// ─── REST TIMER DRAW ER ────────────────────────────────────────
function RestTimer({ triggerSeconds, onCancel }) {
  const [remaining, setRemaining] = useState(triggerSeconds);
  const total = triggerSeconds;

  useEffect(() => {
    setRemaining(triggerSeconds);
  }, [triggerSeconds]);

  useEffect(() => {
    if (remaining <= 0) {
      playRestCompleteSound();
      onCancel();
      return;
    }
    const timer = setInterval(() => setRemaining(r => r - 1), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const percentage = (remaining / total) * 100;
  const strokeDashoffset = 283 - (283 * percentage) / 100;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(5, 7, 12, 0.8)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 280, textAlign: "center", padding: 24, background: "#0f1524", borderColor: "#00f59b", animation: "fadeIn .3s", boxShadow: "0 10px 40px rgba(0, 245, 155, 0.15)" }}>
        <h4 style={{ margin: "0 0 16px", color: "#ffffff", letterSpacing: 0.5 }}>REST INTERVAL</h4>
        
        {/* Countdown Circle */}
        <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 20px" }}>
          <svg style={{ width: 120, height: 120, transform: "rotate(-90deg)" }}>
            <circle cx="60" cy="60" r="45" stroke="#1e293b" strokeWidth="6" fill="transparent" />
            <circle 
              cx="60" cy="60" r="45" 
              stroke="#00f59b" strokeWidth="6" fill="transparent" 
              strokeDasharray="283"
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 28, fontWeight: 700, color: "#00f59b", textShadow: "0 0 8px rgba(0, 245, 155, 0.4)" }}>
            {remaining}s
          </div>
        </div>

        <button onClick={onCancel} style={{ ...S.btn, ...S.btnDanger, width: "100%" }}>Skip Timer</button>
      </div>
    </div>
  );
}

// ─── BARBELL PLATE CALCULATOR ─────────────────────────────────
function PlateCalculator({ target, onClose, unit }) {
  const [barWeight, setBarWeight] = useState(20);
  const targetWeight = Number(target) || 0;

  const getPlatesPerSide = () => {
    if (targetWeight <= barWeight) return [];
    
    const kgPlates = [25, 20, 15, 10, 5, 2.5, 1.25];
    const lbsPlates = [45, 35, 25, 10, 5, 2.5];
    const plates = unit === "lbs" ? lbsPlates : kgPlates;

    let targetPerSide = (targetWeight - barWeight) / 2;
    const loading = [];

    plates.forEach(plate => {
      while (targetPerSide >= plate) {
        loading.push(plate);
        targetPerSide -= plate;
      }
    });

    return loading;
  };

  const plates = getPlatesPerSide();

  const getPlateColor = (val) => {
    if (unit === "kg") {
      if (val >= 25) return "#ef4444"; 
      if (val >= 20) return "#3b82f6"; 
      if (val >= 15) return "#eab308"; 
      if (val >= 10) return "#22c55e"; 
      return "#64748b"; 
    } else {
      if (val >= 45) return "#ef4444";
      if (val >= 35) return "#3b82f6";
      if (val >= 25) return "#eab308";
      return "#64748b";
    }
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(5, 7, 12, 0.8)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 340, padding: 20, background: "#0f1524", borderColor: "#1e293b", animation: "fadeIn .3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: "#ffffff", fontSize: 16 }}>PLATE CALCULATOR</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Bar Weight ({unit})</label>
          <select value={barWeight} onChange={e => setBarWeight(Number(e.target.value))} style={S.select}>
            <option value={unit === "lbs" ? 45 : 20}>{unit === "lbs" ? "45 lbs (Standard Bar)" : "20 kg (Olympic Bar)"}</option>
            <option value={unit === "lbs" ? 35 : 15}>{unit === "lbs" ? "35 lbs (Light Bar)" : "15 kg (Olympic Bar)"}</option>
            <option value="0">0 (No Bar weight)</option>
          </select>
        </div>

        <div style={{ textAlign: "center", background: "#151c2c", padding: "16px", borderRadius: 12, border: "1px solid #1e293b", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>Target Weight</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#00f59b" }}>{targetWeight} {unit}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            Load per side: {plates.length > 0 ? `${((targetWeight - barWeight)/2).toFixed(1)} ${unit}` : "None"}
          </div>
        </div>

        {/* Plates stack representation */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 3, background: "#0b0f19", height: 110, borderRadius: 10, border: "1px solid #1e293b", position: "relative", overflow: "hidden", marginBottom: 16 }}>
          
          <div style={{ position: "absolute", width: "100%", height: 6, background: "#334155", top: "50%", transform: "translateY(-50%)", zIndex: 1 }} />
          <div style={{ width: 10, height: 44, background: "#64748b", border: "1px solid #475569", borderRadius: 2, zIndex: 2, marginRight: 8 }} />

          {plates.length > 0 ? (
            <div style={{ display: "flex", gap: 2, zIndex: 2, alignItems: "center" }}>
              {plates.map((plate, index) => {
                const height = 40 + Math.min(plate * 1.5, 45); 
                const width = Math.max(10, 16 - index); 
                return (
                  <div 
                    key={index}
                    style={{ 
                      width, 
                      height, 
                      background: getPlateColor(plate), 
                      borderRadius: 4, 
                      border: "1px solid rgba(0,0,0,0.3)", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 8,
                      fontWeight: 700,
                      writingMode: "vertical-rl",
                      textOrientation: "mixed"
                    }}
                  >
                    {plate}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "#475569", fontSize: 12, zIndex: 2 }}>Only bar weight required</div>
          )}

          <div style={{ width: 6, height: 14, background: "#475569", zIndex: 2, marginLeft: 6, borderRadius: "0 2px 2px 0" }} />
        </div>

        <button onClick={onClose} style={{ ...S.btn, ...S.btnPrimary, width: "100%" }}>Done</button>
      </div>
    </div>
  );
}

// ─── LOG WORKOUT ──────────────────────────────────────────────
function LogWorkout({ workout, setWorkout, unit, onSave, savedWorkouts }) {
  const w = workout;
  const [calcTarget, setCalcTarget] = useState(null);
  const [activeRestSeconds, setActiveRestSeconds] = useState(null);

  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);

  useEffect(() => {
    let interval = null;
    if (timerRunning) {
      interval = setInterval(() => {
        setElapsed(e => e + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerRunning]);

  const formatElapsed = () => {
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const upd = (k, v) => setWorkout(p => ({ ...p, [k]: v }));
  const updDateAndSync = (newDate) => {
    setWorkout(p => ({ ...p, date: newDate, day: dayFromDate(newDate) }));
  };
  const updDayAndSync = (newDay) => {
    setWorkout(p => ({ ...p, day: newDay, date: dateFromDay(p.date, newDay) }));
  };
  const updExercise = (i, k, v) => {
    setWorkout(p => {
      const ex = [...p.exercises];
      ex[i] = { ...ex[i], [k]: v };
      return { ...p, exercises: ex };
    });
  };
  const updSet = (ei, si, k, v) => {
    setWorkout(p => {
      const ex = [...p.exercises];
      const sets = [...ex[ei].sets];
      sets[si] = { ...sets[si], [k]: v };
      ex[ei] = { ...ex[ei], sets };
      return { ...p, exercises: ex };
    });
  };
  const addSet = (ei) => {
    setWorkout(p => {
      const ex = [...p.exercises];
      if (ex[ei].sets.length < 8) {
        ex[ei] = { ...ex[ei], sets: [...ex[ei].sets, { reps: "", weight: "" }] };
      }
      return { ...p, exercises: ex };
    });
  };
  const removeSet = (ei) => {
    setWorkout(p => {
      const ex = [...p.exercises];
      if (ex[ei].sets.length > 1) {
        ex[ei] = { ...ex[ei], sets: ex[ei].sets.slice(0, -1) };
      }
      return { ...p, exercises: ex };
    });
  };
  const addExercise = () => setWorkout(p => ({ ...p, exercises: [...p.exercises, emptyExercise()] }));
  const removeExercise = (i) => setWorkout(p => ({ ...p, exercises: p.exercises.filter((_, j) => j !== i) }));

  const lastWeights = useCallback((exName) => {
    if (!exName) return null;
    for (let i = savedWorkouts.length - 1; i >= 0; i--) {
      const sw = savedWorkouts[i];
      const found = sw.exercises.find(e => e.name === exName);
      if (found) {
        const last = found.sets.filter(s => s.weight).map(s => Number(s.weight));
        if (last.length) return `Last Max: ${Math.max(...last)} ${sw.unit || "kg"}`;
      }
    }
    return null;
  }, [savedWorkouts]);

  return (
    <div style={S.page}>
      
      {activeRestSeconds && <RestTimer triggerSeconds={activeRestSeconds} onCancel={() => setActiveRestSeconds(null)} />}
      {calcTarget && <PlateCalculator target={calcTarget} unit={unit} onClose={() => setCalcTarget(null)} />}

      {/* Stopwatch & Rest Preset Bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ ...S.card, flex: 1, margin: 0, padding: "10px 16px", display: "flex", alignItems: "center", justifySpace: "space-between", justifyContent: "space-between", borderColor: "rgba(0, 245, 155, 0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>⏱️</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "monospace", color: "#00f59b", textShadow: "0 0 6px rgba(0, 245, 155, 0.3)" }}>{formatElapsed()}</span>
          </div>
          <button 
            onClick={() => setTimerRunning(!timerRunning)}
            style={{ background: "none", border: "none", color: timerRunning ? "#ef4444" : "#00f59b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            {timerRunning ? "PAUSE" : "RESUME"}
          </button>
        </div>

        <div style={{ ...S.card, flex: 1.5, margin: 0, padding: "10px 12px", display: "flex", alignItems: "center", gap: 6, overflowX: "auto" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>REST:</span>
          {[60, 90, 120].map(s => (
            <button 
              key={s} 
              onClick={() => setActiveRestSeconds(s)}
              style={{ padding: "4px 8px", borderRadius: 6, background: "#0f1524", border: "1px solid #1e293b", color: "#00f59b", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
            >
              {s}s
            </button>
          ))}
        </div>
      </div>

      {/* Date & Day */}
      <div style={S.card}>
        <div style={{ ...S.row, marginBottom: 10 }}>
          <div style={S.col}>
            <label style={S.label}>Date</label>
            <input type="date" value={w.date} onChange={e => updDateAndSync(e.target.value)} style={S.input} />
          </div>
          <div style={{ ...S.col, maxWidth: 200 }}>
            <label style={S.label}>Day</label>
            <div style={{ display: "flex", gap: 4 }}>
              {DAYS.map((d, i) => (
                <div key={i} style={S.dayPill(w.day === i)} onClick={() => updDayAndSync(i)}>{d}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ ...S.row, marginBottom: 10 }}>
          <div style={S.col}>
            <label style={S.label}>Start time</label>
            <input type="time" value={w.startTime} onChange={e => upd("startTime", e.target.value)} style={S.input} />
          </div>
          <div style={S.col}>
            <label style={S.label}>Finish time</label>
            <input type="time" value={w.finishTime} onChange={e => upd("finishTime", e.target.value)} style={S.input} />
          </div>
        </div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Workout type</label>
            <select value={w.workoutType} onChange={e => upd("workoutType", e.target.value)} style={S.select}>
              {WORKOUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={S.col}>
            <label style={S.label}>Muscle group</label>
            <select value={w.muscleGroup} onChange={e => upd("muscleGroup", e.target.value)} style={S.select}>
              {MUSCLE_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        {/* Energy */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ ...S.label, margin: 0 }}>Energy</label>
          <div style={{ display: "flex", gap: 3 }}>
            {[1,2,3,4,5].map(n => (
              <div key={n} style={S.energyBar(n <= w.energy)} onClick={() => upd("energy", n)} />
            ))}
          </div>
        </div>
      </div>

      {/* Exercises */}
      {w.exercises.map((ex, ei) => (
        <div key={ex.id} style={{ ...S.card, position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <select
              value={ex.name}
              onChange={e => updExercise(ei, "name", e.target.value)}
              style={{ ...S.select, fontWeight: 700, border: "none", padding: "4px 0", background: "transparent", fontSize: 16, color: "#fff" }}
            >
              <option value="">Select exercise...</option>
              {MUSCLE_GROUPS.map(g => (
                <optgroup key={g} label={g} style={{ background: "#0f1524" }}>
                  {EXERCISE_DB[g].map(e => <option key={e} value={e}>{e}</option>)}
                </optgroup>
              ))}
            </select>
            {w.exercises.length > 1 && (
              <button onClick={() => removeExercise(ei)} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 20, padding: "2px 6px" }}>×</button>
            )}
          </div>
          {lastWeights(ex.name) && (
            <div style={{ fontSize: 11, color: "#00f59b", fontWeight: 600, marginBottom: 8 }}>{lastWeights(ex.name)}</div>
          )}
          <table style={S.exerciseTable}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left", width: 40 }}>Set</th>
                {ex.sets.map((_, si) => <th key={si} style={S.th}>{si + 1}</th>)}
                <th style={{ ...S.th, width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "4px 4px", fontSize: 10, color: "#64748b", fontWeight: 700 }}>REPS</td>
                {ex.sets.map((s, si) => (
                  <td key={si} style={{ padding: "3px 2px" }}>
                    <input type="number" value={s.reps} onChange={e => updSet(ei, si, "reps", e.target.value)} style={S.setInput} placeholder="—" min="0" />
                  </td>
                ))}
                <td rowSpan={2} style={{ verticalAlign: "middle", textAlign: "center" }}>
                  <button onClick={() => addSet(ei)} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#00f59b", padding: 0 }}>+</button>
                  {ex.sets.length > 1 && <button onClick={() => removeSet(ei)} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: 0, display: "block", margin: "4px auto 0" }}>−</button>}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "4px 4px", fontSize: 10, color: "#64748b", fontWeight: 700 }}>{unit.toUpperCase()}</td>
                {ex.sets.map((s, si) => (
                  <td key={si} style={{ padding: "3px 2px", position: "relative" }}>
                    <input 
                      type="number" 
                      value={s.weight} 
                      onChange={e => updSet(ei, si, "weight", e.target.value)} 
                      style={S.setInput} 
                      placeholder="—" 
                      min="0" 
                      step="0.5" 
                    />
                    {s.weight && (
                      <span 
                        onClick={() => setCalcTarget(s.weight)}
                        title="Calculate barbell plates"
                        style={{ position: "absolute", bottom: -6, right: 0, fontSize: 8, cursor: "pointer", opacity: 0.7, color: "#00f59b" }}
                      >
                        🎛️
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <input
            type="text"
            value={ex.notes}
            onChange={e => updExercise(ei, "notes", e.target.value)}
            style={S.notesInput}
            placeholder="Add notes for this exercise..."
          />
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={addExercise} style={{ ...S.btn, ...S.btnOutline, flex: 1 }}>+ Add exercise</button>
        <button onClick={onSave} style={{ ...S.btn, ...S.btnPrimary, flex: 1 }}>Save workout</button>
      </div>
    </div>
  );
}

// ─── HISTORY ──────────────────────────────────────────────────
function History({ workouts, unit, onDelete }) {
  const [expanded, setExpanded] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date));

  if (!sorted.length) return (
    <div style={{ ...S.page, textAlign: "center", paddingTop: 80 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🏋️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>No Workouts Logged</div>
      <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>Commit your first session to lift off</div>
    </div>
  );

  const duration = (w) => {
    if (!w.startTime || !w.finishTime) return null;
    const [sh, sm] = w.startTime.split(":").map(Number);
    const [fh, fm] = w.finishTime.split(":").map(Number);
    const mins = (fh * 60 + fm) - (sh * 60 + sm);
    return mins > 0 ? `${mins} min` : null;
  };

  const displayWeight = (val, wUnit) => {
    if (!val) return "—";
    const n = Number(val);
    if (wUnit === unit) return n;
    return unit === "lbs" ? kgToLbs(n) : lbsToKg(n);
  };

  const handleCopySummary = (w, e) => {
    e.stopPropagation(); 
    const wDuration = duration(w);
    let text = `🏋️ IRON LOG: ${formatDate(w.date)} (${w.workoutType})\n`;
    text += `💪 Target: ${w.muscleGroup} | Energy: ${w.energy}/5${wDuration ? ` | Time: ${wDuration}` : ""}\n`;
    w.exercises.forEach((ex, index) => {
      text += `\n${index + 1}. ${ex.name || "Unnamed Exercise"}\n   `;
      const setsStr = ex.sets
        .filter(s => s.reps || s.weight)
        .map(s => `${s.reps || 0}x${s.weight || 0}${unit}`)
        .join(" | ");
      text += setsStr || "No sets recorded";
      if (ex.notes) text += ` (${ex.notes})`;
    });

    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(w.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div style={S.page}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#fff" }}>Workout History</div>
      {sorted.map((w, i) => (
        <div key={w.id} style={S.card}>
          <div style={{ ...S.histItem, borderBottom: expanded === i ? "1px solid #1e293b" : "none", padding: "0 0 12px" }} onClick={() => setExpanded(expanded === i ? null : i)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{formatDate(w.date)}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  {w.muscleGroup}{duration(w) ? ` · ${duration(w)}` : ""} · {w.exercises.length} exercise{w.exercises.length > 1 ? "s" : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={S.chip(
                  w.workoutType === "Cardio" || w.workoutType === "HIIT" ? "rgba(234, 179, 8, 0.15)" : "rgba(14, 165, 233, 0.15)",
                  w.workoutType === "Cardio" || w.workoutType === "HIIT" ? "#eab308" : "#0ea5e9"
                )}>{w.workoutType}</span>
                <span style={{ fontSize: 16, color: "#64748b", transform: expanded === i ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
              </div>
            </div>
          </div>
          {expanded === i && (
            <div style={{ paddingTop: 14 }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
                {[1,2,3,4,5].map(n => <div key={n} style={{ ...S.energyBar(n <= (w.energy || 3)), width: 14, height: 18 }} />)}
                <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>energy</span>
              </div>
              {w.exercises.map((ex, j) => (
                <div key={j} style={{ marginBottom: 12, background: "#0f1524", padding: 10, borderRadius: 10, border: "1px solid #1e293b" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{ex.name || "Unnamed"}</div>
                  {ex.notes && <div style={{ fontSize: 12, color: "#64748b", fontStyle: "italic", marginBottom: 6 }}>{ex.notes}</div>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {ex.sets.filter(s => s.reps || s.weight).map((s, k) => (
                      <span key={k} style={{ ...S.chip("rgba(255,255,255,0.05)", "#cbd5e1"), fontSize: 11, borderRadius: 6, border: "1px solid #1e293b" }}>
                        {s.reps || 0}×{displayWeight(s.weight, w.unit || "kg")}{unit}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button 
                  onClick={(e) => handleCopySummary(w, e)}
                  style={{ ...S.btn, ...S.btnOutline, fontSize: 12, padding: "8px 16px", flex: 1 }}
                >
                  {copiedId === w.id ? "📋 Copied!" : "📤 Share Log"}
                </button>
                <button 
                  onClick={() => onDelete(w.id)} 
                  style={{ ...S.btn, ...S.btnDanger, fontSize: 12, padding: "8px 16px", flex: 1 }}
                >
                  Delete Workout
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── PROGRESS ─────────────────────────────────────────────────
function Progress({ workouts, unit }) {
  const [selectedExercise, setSelectedExercise] = useState("");

  const allExercises = [...new Set(workouts.flatMap(w => w.exercises.map(e => e.name)).filter(Boolean))];

  useEffect(() => {
    if (!selectedExercise && allExercises.length) setSelectedExercise(allExercises[0]);
  }, [allExercises.length]);

  const weightData = workouts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => {
      const ex = w.exercises.find(e => e.name === selectedExercise);
      if (!ex) return null;
      const weights = ex.sets.filter(s => s.weight).map(s => {
        let v = Number(s.weight);
        if ((w.unit || "kg") !== unit) v = unit === "lbs" ? kgToLbs(v) : lbsToKg(v);
        return v;
      });
      if (!weights.length) return null;
      return { date: w.date.slice(5), max: Math.max(...weights), avg: Math.round(weights.reduce((a,b) => a+b, 0) / weights.length) };
    })
    .filter(Boolean);

  const volumeData = workouts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => {
      let vol = 0;
      w.exercises.forEach(ex => {
        ex.sets.forEach(s => {
          if (s.reps && s.weight) {
            let wt = Number(s.weight);
            if ((w.unit || "kg") !== unit) wt = unit === "lbs" ? kgToLbs(wt) : lbsToKg(wt);
            vol += Number(s.reps) * wt;
          }
        });
      });
      return { date: w.date.slice(5), volume: Math.round(vol) };
    });

  const freqData = (() => {
    const now = new Date();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - (i * 7 + now.getDay()));
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const count = workouts.filter(w => {
        const d = new Date(w.date + "T12:00:00");
        return d >= start && d <= end;
      }).length;
      weeks.push({ week: `W${8-i}`, count });
    }
    return weeks;
  })();

  if (!workouts.length) return (
    <div style={{ ...S.page, textAlign: "center", paddingTop: 80 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>No Analytics Yet</div>
      <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>Log sessions to populate performance graphs</div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#fff" }}>Performance Metrics</div>

      {/* Weight progression */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <label style={{ ...S.label, margin: 0 }}>Weight progression ({unit})</label>
          <select value={selectedExercise} onChange={e => setSelectedExercise(e.target.value)} style={{ ...S.select, width: "auto", fontSize: 11, padding: "4px 8px" }}>
            {allExercises.map(e => <option key={e} value={e} style={{ background: "#0f1524" }}>{e}</option>)}
          </select>
        </div>
        {weightData.length > 1 ? (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={weightData}>
              <defs>
                <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00f59b" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#00f59b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" fontSize={10} stroke="#64748b" />
              <YAxis fontSize={10} stroke="#64748b" />
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #1e293b", background: "#0f1524", color: "#fff" }} />
              <Area type="monotone" dataKey="max" stroke="#00f59b" strokeWidth={2} fill="url(#gw)" name={`Max ${unit}`} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>Need 2+ workouts with this exercise</div>
        )}
      </div>

      {/* Volume */}
      <div style={S.card}>
        <label style={{ ...S.label, marginBottom: 12 }}>Total volume per session ({unit})</label>
        {volumeData.length > 1 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" fontSize={10} stroke="#64748b" />
              <YAxis fontSize={10} stroke="#64748b" />
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #1e293b", background: "#0f1524", color: "#fff" }} />
              <Bar dataKey="volume" fill="#00f59b" radius={[4,4,0,0]} name={`Volume (${unit})`} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 13 }}>Need 2+ workouts to chart</div>
        )}
      </div>

      {/* Frequency */}
      <div style={S.card}>
        <label style={{ ...S.label, marginBottom: 12 }}>Weekly frequency (last 8 weeks)</label>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={freqData}>
            <XAxis dataKey="week" fontSize={10} stroke="#64748b" />
            <YAxis fontSize={10} stroke="#64748b" allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #1e293b", background: "#0f1524", color: "#fff" }} />
            <Bar dataKey="count" fill="rgba(0, 245, 155, 0.4)" radius={[4,4,0,0]} name="Workouts" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ ...S.card, textAlign: "center", margin: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{workouts.length}</div>
          <div style={{ fontSize: 9, color: "#00f59b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 }}>Total workouts</div>
        </div>
        <div style={{ ...S.card, textAlign: "center", margin: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{allExercises.length}</div>
          <div style={{ fontSize: 9, color: "#00f59b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 }}>Unique exercises</div>
        </div>
      </div>
    </div>
  );
}

// ─── EXERCISE LIBRARY ─────────────────────────────────────────
function Library({ onAddExercise }) {
  const [search, setSearch] = useState("");
  const [openGroup, setOpenGroup] = useState(null);

  const filtered = (group) => {
    if (!search) return EXERCISE_DB[group];
    return EXERCISE_DB[group].filter(e => e.toLowerCase().includes(search.toLowerCase()));
  };

  const totalFiltered = MUSCLE_GROUPS.reduce((acc, g) => acc + filtered(g).length, 0);

  return (
    <div style={S.page}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#fff" }}>Exercise Library</div>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: 16 }}>🔍</span>
        <input
          type="text"
          placeholder="Search exercises..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={S.searchBox}
        />
      </div>

      {search && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{totalFiltered} result{totalFiltered !== 1 ? "s" : ""}</div>}

      {MUSCLE_GROUPS.map(group => {
        const exercises = filtered(group);
        if (search && !exercises.length) return null;
        const isOpen = openGroup === group || !!search;
        return (
          <div key={group} style={{ marginBottom: 10 }}>
            <div
              style={S.muscleCard(isOpen)}
              onClick={() => !search && setOpenGroup(isOpen ? null : group)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{group}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{EXERCISE_DB[group].length} exercises</div>
                </div>
                <span style={{ fontSize: 12, color: "#64748b", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s" }}>▶</span>
              </div>
            </div>
            {isOpen && (
              <div style={{ padding: "4px 0 0 8px" }}>
                {exercises.map(ex => (
                  <div key={ex} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 8px", borderBottom: "1px solid #1e293b" }}>
                    <span style={{ fontSize: 13, color: "#cbd5e1" }}>{ex}</span>
                    <button
                      onClick={() => onAddExercise(ex)}
                      style={{ border: "none", background: "none", color: "#00f59b", cursor: "pointer", fontSize: 22, padding: "0 4px", fontWeight: 700 }}
                    >+</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 1-REP MAX (1RM) CALCULATOR DASHBOARD ────────────────────
function OneRepMaxDashboard({ unit }) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  const calculateMaxes = () => {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    if (w <= 0 || r <= 0) return { epley: 0, brzycki: 0, avg: 0 };
    if (r === 1) return { epley: w, brzycki: w, avg: w };

    const epley = w * (1 + r / 30);
    const brzycki = w / (1.0278 - 0.0278 * r);
    const avg = (epley + brzycki) / 2;

    return { epley, brzycki, avg };
  };

  const maxes = calculateMaxes();
  const max1RM = maxes.avg;

  const trainingZones = [
    { percent: 95, label: "Peak Power / Explosive Strength", reps: "1-2" },
    { percent: 90, label: "Maximal Strength Program", reps: "3-4" },
    { percent: 85, label: "Strength & Power Output", reps: "5" },
    { percent: 80, label: "Optimal Hypertrophy Zone", reps: "6-8" },
    { percent: 75, label: "Muscle Growth / Hypertrophy", reps: "8-10" },
    { percent: 70, label: "Endurance & Growth Hypertrophy", reps: "10-12" },
    { percent: 60, label: "Sub-maximal Volume / Endurance", reps: "15+" },
    { percent: 50, label: "Active Recovery & Warm-up Speed", reps: "20+" }
  ];

  return (
    <div style={S.page}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, color: "#fff" }}>1-Rep Max Calculator</div>
      <div style={S.card}>
        <div style={{ ...S.row, marginBottom: 0 }}>
          <div style={S.col}>
            <label style={S.label}>Weight Lifted ({unit})</label>
            <input type="number" placeholder="e.g. 100" value={weight} onChange={e => setWeight(e.target.value)} style={S.input} />
          </div>
          <div style={S.col}>
            <label style={S.label}>Reps Done</label>
            <input type="number" placeholder="e.g. 5" value={reps} onChange={e => setReps(e.target.value)} style={S.input} min="1" max="30" />
          </div>
        </div>
      </div>

      {max1RM > 0 ? (
        <>
          <div style={{ ...S.card, textAlign: "center", background: "rgba(0, 245, 155, 0.05)", borderColor: "#00f59b", boxShadow: "0 0 15px rgba(0, 245, 155, 0.1)" }}>
            <div style={{ fontSize: 13, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.8 }}>Estimated 1-Rep Max</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#00f59b", margin: "8px 0", textShadow: "0 0 10px rgba(0, 245, 155, 0.4)" }}>
              {Math.round(max1RM)} <span style={{ fontSize: 20 }}>{unit}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "#0f1524", padding: 10, borderRadius: 10, marginTop: 10, border: "1px solid #1e293b" }}>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>EPLEY FORMULA</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 2 }}>{Math.round(maxes.epley)} {unit}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>BRZYCKI FORMULA</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 2 }}>{Math.round(maxes.brzycki)} {unit}</div>
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={{ ...S.cardTitle, color: "#ffffff", borderBottom: "1px solid #1e293b", paddingBottom: 8, marginBottom: 12 }}>
              TRAINING LOAD TARGETS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {trainingZones.map(zone => {
                const zoneWeight = Math.round(max1RM * (zone.percent / 100));
                return (
                  <div key={zone.percent} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: "1px solid #0f1524" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                        <span style={{ color: "#00f59b", marginRight: 8 }}>{zone.percent}%</span>
                        {zoneWeight} {unit}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{zone.label}</div>
                    </div>
                    <span style={{ ...S.chip("rgba(255,255,255,0.05)", "#cbd5e1"), fontSize: 10, borderRadius: 6 }}>
                      {zone.reps} reps
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div style={{ ...S.card, textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
          <span style={{ fontSize: 24, display: "block", marginBottom: 8 }}>🧮</span>
          Enter weight and repetitions above to calculate your maximum lifts and training loads.
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [tab, setTab] = useState("log");
  const [unit, setUnit] = useState("kg");
  const [workout, setWorkout] = useState(emptyWorkout());
  const [workouts, setWorkouts] = useState([]);
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Monitor Authentication Session
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Authenticated: check if user document already exists in Firestore
        setLoaded(false);
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            // Returning User: Load cloud workouts and settings
            const data = snap.data();
            setWorkouts(data.workouts || []);
            setUnit(data.unit || "kg");
            setUsername(data.username || "lifter");
            setShowOnboarding(false);
          } else {
            // New Google Signup: Show the mandatory onboarding modal to link Username/PIN
            setShowOnboarding(true);
          }
        } catch (e) {
          console.error("Firestore initialization failed", e);
          // Fallback to local storage
          const localW = await localAdapter.get(`${u.uid}_workouts-data`) || [];
          const localU = await localAdapter.get(`${u.uid}_unit-pref`) || "kg";
          setWorkouts(localW);
          setUnit(localU);
        }
        setLoaded(true);
      } else {
        // Unauthenticated
        setWorkouts([]);
        setUsername("");
        setShowOnboarding(false);
        setLoaded(true);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setToast("Logged out successfully");
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  const toggleUnit = async () => {
    const next = unit === "kg" ? "lbs" : "kg";
    setUnit(next);
    await store.set("user-profile", { workouts, unit: next });
  };

  const handleSave = async () => {
    const filled = workout.exercises.some(ex => ex.name && ex.sets.some(s => s.reps || s.weight));
    if (!filled) {
      setToast("Add at least one exercise with data");
      return;
    }
    const w = { ...workout, unit, finishTime: workout.finishTime || nowTime() };
    const updated = [...workouts, w];
    setWorkouts(updated);
    
    await store.set("user-profile", { workouts: updated, unit });
    
    setWorkout(emptyWorkout());
    setToast("Workout saved!");
  };

  const handleDelete = async (id) => {
    const updated = workouts.filter(w => w.id !== id);
    setWorkouts(updated);
    await store.set("user-profile", { workouts: updated, unit });
    setToast("Workout deleted");
  };

  const addExerciseFromLibrary = (name) => {
    setWorkout(p => ({
      ...p,
      exercises: [...p.exercises, { ...emptyExercise(), name }]
    }));
    setTab("log");
    setToast(`Added: ${name}`);
  };

  const handleSeedData = async () => {
    const MOCK_WORKOUTS = [
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 20, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 20).toISOString().slice(0, 10),
        day: (dayOfWeek() + 1) % 7,
        startTime: "18:00",
        finishTime: "19:15",
        workoutType: "Strength",
        muscleGroup: "Chest",
        energy: 4,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Barbell bench press",
            notes: "Focus on form and slow negatives",
            sets: [
              { reps: "10", weight: "60" },
              { reps: "8", weight: "65" },
              { reps: "6", weight: "70" }
            ]
          },
          {
            id: Math.random(),
            name: "Dumbbell flyes",
            notes: "",
            sets: [
              { reps: "12", weight: "14" },
              { reps: "10", weight: "16" }
            ]
          }
        ]
      },
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 16, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 16).toISOString().slice(0, 10),
        day: (dayOfWeek() + 5) % 7,
        startTime: "08:00",
        finishTime: "09:00",
        workoutType: "Hypertrophy",
        muscleGroup: "Legs",
        energy: 3,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Barbell squat",
            notes: "Deep squat, feel the quad stretch",
            sets: [
              { reps: "12", weight: "80" },
              { reps: "10", weight: "85" },
              { reps: "8", weight: "90" }
            ]
          },
          {
            id: Math.random(),
            name: "Leg extension",
            notes: "",
            sets: [
              { reps: "15", weight: "40" },
              { reps: "12", weight: "45" }
            ]
          }
        ]
      },
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 12, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 12).toISOString().slice(0, 10),
        day: (dayOfWeek() + 2) % 7,
        startTime: "17:30",
        finishTime: "18:45",
        workoutType: "Strength",
        muscleGroup: "Back",
        energy: 5,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Deadlift",
            notes: "Warm up properly. Back neutral.",
            sets: [
              { reps: "5", weight: "100" },
              { reps: "5", weight: "110" },
              { reps: "3", weight: "120" }
            ]
          },
          {
            id: Math.random(),
            name: "Pull-ups",
            notes: "Wide grip",
            sets: [
              { reps: "10", weight: "0" },
              { reps: "8", weight: "0" }
            ]
          }
        ]
      },
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 8, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 8).toISOString().slice(0, 10),
        day: (dayOfWeek() + 6) % 7,
        startTime: "11:00",
        finishTime: "12:15",
        workoutType: "Hypertrophy",
        muscleGroup: "Chest",
        energy: 4,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Barbell bench press",
            notes: "Strength is up!",
            sets: [
              { reps: "10", weight: "65" },
              { reps: "8", weight: "70" },
              { reps: "6", weight: "75" }
            ]
          },
          {
            id: Math.random(),
            name: "Machine chest press",
            notes: "",
            sets: [
              { reps: "12", weight: "50" },
              { reps: "10", weight: "60" }
            ]
          }
        ]
      },
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 4, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 4).toISOString().slice(0, 10),
        day: (dayOfWeek() + 3) % 7,
        startTime: "19:00",
        finishTime: "20:00",
        workoutType: "Hypertrophy",
        muscleGroup: "Legs",
        energy: 5,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Barbell squat",
            notes: "Felt amazing today. Form was perfect.",
            sets: [
              { reps: "10", weight: "85" },
              { reps: "8", weight: "90" },
              { reps: "6", weight: "95" }
            ]
          },
          {
            id: Math.random(),
            name: "Bulgarian split squat",
            notes: "Quads burning",
            sets: [
              { reps: "10", weight: "20" },
              { reps: "10", weight: "20" }
            ]
          }
        ]
      },
      {
        id: Date.now() - 24 * 60 * 60 * 1000 * 1, 
        date: new Date(Date.now() - 24 * 60 * 60 * 1000 * 1).toISOString().slice(0, 10),
        day: (dayOfWeek() + 6) % 7,
        startTime: "18:15",
        finishTime: "19:30",
        workoutType: "Strength",
        muscleGroup: "Chest",
        energy: 4,
        unit: "kg",
        exercises: [
          {
            id: Math.random(),
            name: "Barbell bench press",
            notes: "PR attempt succeeded!",
            sets: [
              { reps: "8", weight: "70" },
              { reps: "6", weight: "75" },
              { reps: "4", weight: "80" }
            ]
          },
          {
            id: Math.random(),
            name: "Incline dumbbell press",
            notes: "",
            sets: [
              { reps: "10", weight: "24" },
              { reps: "8", weight: "26" }
            ]
          }
        ]
      }
    ];

    try {
      const seeded = MOCK_WORKOUTS.map(w => ({ ...w, isDemo: true }));
      const updated = [...workouts, ...seeded];
      await store.set("user-profile", { workouts: updated, unit });
      setWorkouts(updated);
      setToast("Mock workouts seeded successfully!");
    } catch (e) {
      console.error("Seeding mock workouts failed", e);
      setToast("Failed to seed mock workouts.");
    }
  };

  const handleRemoveSeedData = async () => {
    try {
      const updated = workouts.filter(w => !w.isDemo);
      await store.set("user-profile", { workouts: updated, unit });
      setWorkouts(updated);
      setToast("Demo workouts removed!");
    } catch (e) {
      console.error("Removing mock workouts failed", e);
      setToast("Failed to remove demo workouts.");
    }
  };

  if (!loaded) return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ fontSize: 14, color: "#64748b" }}>Loading dashboard...</div>
    </div>
  );

  // If not authenticated, render login portal
  if (!user) {
    return (
      <div style={S.app}>
        {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
        <AuthScreen onLoginSuccess={() => setToast("Unlocked successfully!")} />
      </div>
    );
  }

  return (
    <div style={S.app}>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      
      {/* Onboarding Modal Overlay */}
      {showOnboarding && (
        <OnboardingModal 
          user={user} 
          onComplete={async () => {
            const snap = await getDoc(doc(db, "users", user.uid));
            const data = snap.data();
            setWorkouts(data.workouts || []);
            setUnit(data.unit || "kg");
            setUsername(data.username || "lifter");
            setShowOnboarding(false);
            setToast("Profile created successfully!");
          }} 
        />
      )}

      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={S.logo}>
            <span style={{ marginRight: 6 }}>🏋️</span>
            IRON <span style={S.accentLogo}>LOG</span>
          </div>
          <div style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 4, fontWeight: 700, textTransform: "uppercase" }}>
            <span style={{ color: "#00f59b" }}>👤</span> {username}
            <span onClick={handleLogout} style={{ cursor: "pointer", color: "#ef4444", marginLeft: 8 }} title="Sign Out">LOGOUT</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {workouts.some(w => w.isDemo) ? (
            <button 
              onClick={handleRemoveSeedData}
              style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", background: "#151c2c", borderColor: "#1e293b", color: "#ef4444", fontWeight: 700 }}
            >
              🗑️ Remove Demo
            </button>
          ) : (
            <button 
              onClick={handleSeedData}
              style={{ ...S.btnOutline, fontSize: 11, padding: "5px 10px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", background: "#151c2c", borderColor: "#1e293b", color: "#00f59b", fontWeight: 700 }}
            >
              🌱 Seed Demo
            </button>
          )}
          <div style={S.unitToggle}>
            <button style={S.unitBtn(unit === "kg")} onClick={() => unit !== "kg" && toggleUnit()}>KG</button>
            <button style={S.unitBtn(unit === "lbs")} onClick={() => unit !== "lbs" && toggleUnit()}>LBS</button>
          </div>
        </div>
      </div>

      {/* Content */}
      {tab === "log" && <LogWorkout workout={workout} setWorkout={setWorkout} unit={unit} onSave={handleSave} savedWorkouts={workouts} />}
      {tab === "history" && <History workouts={workouts} unit={unit} onDelete={handleDelete} />}
      {tab === "progress" && <Progress workouts={workouts} unit={unit} />}
      {tab === "library" && <Library onAddExercise={addExerciseFromLibrary} />}
      {tab === "1rm" && <OneRepMaxDashboard unit={unit} />}

      {/* Bottom Nav */}
      <div style={S.nav}>
        {[
          { id: "log", icon: "✏️", label: "Log" },
          { id: "history", icon: "📋", label: "History" },
          { id: "progress", icon: "📊", label: "Progress" },
          { id: "1rm", icon: "🧮", label: "1-RM" },
          { id: "library", icon: "💪", label: "Library" },
        ].map(n => (
          <button key={n.id} style={S.navItem(tab === n.id)} onClick={() => setTab(n.id)}>
            <span style={S.navIcon(tab === n.id)}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}
