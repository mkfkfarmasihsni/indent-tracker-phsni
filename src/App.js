import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc 
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  Building2, 
  ChevronDown, 
  Search, 
  Clock, 
  Plus, 
  LayoutGrid, 
  Settings, 
  Trash2, 
  User, 
  StickyNote, 
  Check, 
  Eraser, 
  AlertCircle,
  Loader2,
  Sparkles,
  BarChart3,
  X,
  MessageSquare,
  CheckCircle2,
  Edit3
} from 'lucide-react';

/**
 * NOTA TEKNIKAL:
 * Kod di bawah menggunakan Environment Variables dari Vercel.
 */
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const appId = typeof __app_id !== 'undefined' 
  ? __app_id 
  : 'pharmacy-tracker-v2';

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const INITIAL_UNITS = {
  "Farmasi Satelit 1": ["Floor Stock", "Troli Ubat", "Ubat Tambahan"],
  "Farmasi Satelit 2": ["Floor Stock", "Troli Ubat", "Ubat Tambahan"],
  "Farmasi Pengeluaran": ["Galenikal & Losyen", "Special Drip"],
  "Farmasi Stor Pukal 3": ["IV Drip"],
  "Farmasi Kecemasan": ["Ubat Urgent (AOH)"]
};

const DEFAULT_APP_NAME = "AiPharmHSNI-Indent Tracking";

// --- Fungsi Pembantu ---
const formatDateTime = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  const time = date.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayMonth = date.toLocaleDateString('ms-MY', { day: '2-digit', month: '2-digit' });
  return `${dayMonth} | ${time}`;
};

const getUnitColor = (unitName) => {
  const colors = ['text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-pink-600', 'text-orange-600', 'text-cyan-600', 'text-indigo-600', 'text-rose-600'];
  let hash = 0;
  for (let i = 0; i < unitName.length; i++) hash = unitName.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

// --- Integrasi API Gemini ---
const callGemini = async (prompt) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const fetchWithRetry = async (retries = 5, delay = 1000) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "Anda adalah pembantu pintar Farmasi Hospital. Berikan respon dalam Bahasa Melayu yang profesional, ringkas, dan tepat." }] }
        })
      });
      if (!response.ok) throw new Error("API Error");
      return await response.json();
    } catch (error) {
      if (retries > 0) {
        await new Promise(res => setTimeout(res, delay));
        return fetchWithRetry(retries - 1, delay * 2);
      }
      throw error;
    }
  };

  const result = await fetchWithRetry();
  return result.candidates?.[0]?.content?.parts?.[0]?.text;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [indents, setIndents] = useState([]);
  const [unitSettings, setUnitSettings] = useState(INITIAL_UNITS);
  const [appName, setAppName] = useState(DEFAULT_APP_NAME);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState('tracker');
  const [currentUnitFilter, setCurrentUnitFilter] = useState('SEMUA UNIT');
  const [entryUnit, setEntryUnit] = useState("");
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showUnitSelector, setShowUnitSelector] = useState(false);
  const [showCollectorModal, setShowCollectorModal] = useState(null);
  const [collectorName, setCollectorName] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(null);
  const [tempNote, setTempNote] = useState('');
  const [confirmDialog, setConfirmDialog] = useState({ show: false, title: '', message: '', action: null });
  
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState(null);
  const [showAiModal, setShowAiModal] = useState(false);
  
  const [tempAppName, setTempAppName] = useState(appName);

  // Auth Lifecycle
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth failed", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!user) return;

    const indentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'indents');
    const unsubscribeIndents = onSnapshot(indentsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setIndents(data);
      setLoading(false);
    }, (err) => {
      console.error("Indents sync error:", err);
      setLoading(false);
    });

    const settingsDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'units');
    const unsubscribeSettings = onSnapshot(settingsDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUnitSettings(data);
        if (!entryUnit) setEntryUnit(Object.keys(data)[0]);
      } else {
        setDoc(settingsDocRef, INITIAL_UNITS);
        setUnitSettings(INITIAL_UNITS);
        setEntryUnit(Object.keys(INITIAL_UNITS)[0]);
      }
    });

    const appInfoRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'appInfo');
    const unsubscribeAppInfo = onSnapshot(appInfoRef, (docSnap) => {
      if (docSnap.exists()) {
        const name = docSnap.data().name || DEFAULT_APP_NAME;
        setAppName(name);
        setTempAppName(name);
      } else {
        setDoc(appInfoRef, { name: DEFAULT_APP_NAME });
        setAppName(DEFAULT_APP_NAME);
        setTempAppName(DEFAULT_APP_NAME);
      }
    });

    return () => {
      unsubscribeIndents();
      unsubscribeSettings();
      unsubscribeAppInfo();
    };
  }, [user, entryUnit]);

  const handleGenerateAiMessage = async (item) => {
    setAiLoading(true);
    setAiResponse(null);
    setShowAiModal(true);
    const prompt = `Jana satu draf mesej WhatsApp pendek untuk memberitahu staf wad ubat sudah siap. 
    Detail: Wad ${item.ward}, Jenis: ${item.type}, Unit: ${item.unit}. Sila pastikan mesej berbunyi profesional.`;
    
    try {
      const response = await callGemini(prompt);
      setAiResponse(response);
    } catch (err) {
      setAiResponse("Gagal menjana mesej.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiAnalysis = async () => {
    setAiLoading(true);
    setAiResponse(null);
    setShowAiModal(true);
    const stats = indents.reduce((acc, curr) => {
      acc[curr.unit] = (acc[curr.unit] || 0) + 1;
      return acc;
    }, {});
    
    const prompt = `Analisis data beban kerja farmasi ini: ${JSON.stringify(stats)}. Berikan ringkasan unit mana paling sibuk dan cadangan aliran kerja harian.`;

    try {
      const response = await callGemini(prompt);
      setAiResponse(response);
    } catch (err) {
      setAiResponse("Gagal membuat analisis.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddIndent = async (e) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const now = new Date().toISOString();
    const newEntry = {
      unit: entryUnit,
      ward: formData.get('ward').toUpperCase(),
      staff: formData.get('staff').toUpperCase() || "TIADA NAMA",
      type: formData.get('type'),
      status: 'PENDING',
      created_at: now,
      done_at: null,
      collected_at: null,
      collected_by: null,
      note: ""
    };
    try {
      const indentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'indents');
      await addDoc(indentsRef, newEntry);
      setActiveTab('tracker');
      e.target.reset();
    } catch (err) { console.error(err); }
  };

  const updateStatus = async (item, newStatus, collector = null, note = null) => {
    if (!user) return;
    const now = new Date().toISOString();
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'indents', item.id);
    const updates = { status: newStatus };
    if (newStatus === 'DONE') updates.done_at = now;
    if (newStatus === 'COLLECTED') {
      updates.collected_at = now;
      if (collector) updates.collected_by = collector;
    }
    if (note !== null) updates.note = note;
    try { await updateDoc(docRef, updates); } catch (err) { console.error(err); }
  };

  const clearCollectedOnly = async () => {
    const batchPromises = indents.filter(i => i.status === 'COLLECTED')
      .map(i => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'indents', i.id)));
    await Promise.all(batchPromises);
    setConfirmDialog({ show: false });
  };

  const clearAllIndents = async () => {
    const batchPromises = indents.map(i => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'indents', i.id)));
    await Promise.all(batchPromises);
    setConfirmDialog({ show: false });
  };

  const saveUnitSettings = async (newSettings) => {
    const settingsDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'units');
    await setDoc(settingsDocRef, newSettings);
  };

  const saveAppName = async () => {
    if (!tempAppName.trim()) return;
    const appInfoRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'appInfo');
    await setDoc(appInfoRef, { name: tempAppName.trim() });
  };

  const filteredIndents = useMemo(() => {
    return indents
      .filter(i => {
        const matchesUnit = currentUnitFilter === 'SEMUA UNIT' || i.unit === currentUnitFilter;
        const matchesSearch = i.ward?.includes(searchQuery.toUpperCase()) || i.staff?.includes(searchQuery.toUpperCase());
        return matchesUnit && matchesSearch;
      })
      .sort((a, b) => {
        if (a.status === 'COLLECTED' && b.status !== 'COLLECTED') return 1;
        if (a.status !== 'COLLECTED' && b.status === 'COLLECTED') return -1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }, [indents, currentUnitFilter, searchQuery]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
        <p className="font-black text-slate-400 uppercase tracking-widest text-xs">Menyambung ke Awan...</p>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-slate-100 font-sans text-slate-800">
      <div className="w-full max-w-md h-[100dvh] bg-white shadow-2xl flex flex-col relative overflow-hidden md:h-[850px] md:rounded-[3rem] md:border-[8px] md:border-slate-800">
        
        <div className="absolute top-1 right-8 z-50">
          <div className="flex items-center gap-1 bg-white/80 backdrop-blur px-2 py-0.5 rounded-full border border-slate-100 shadow-sm">
            <div className={`w-1.5 h-1.5 rounded-full ${user ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[8px] font-black uppercase text-slate-400">Live Cloud</span>
          </div>
        </div>

        <div className="p-4 border-b flex justify-between items-center bg-white sticky top-0 z-10 shadow-sm">
          <div onClick={() => setShowUnitSelector(true)} className="flex items-center gap-3 cursor-pointer group">
            <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-lg group-active:scale-90 transition-transform">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black text-blue-600 uppercase tracking-tighter leading-none mb-1 truncate max-w-[150px]">{appName}</p>
              <h1 className="text-sm font-black uppercase italic text-slate-800 flex items-center gap-1">
                {currentUnitFilter} <ChevronDown className="w-4 h-4 text-slate-400" />
              </h1>
            </div>
          </div>
          {activeTab === 'tracker' && (
             <button 
               onClick={handleAiAnalysis}
               className="bg-gradient-to-tr from-purple-600 to-blue-500 p-2.5 rounded-xl text-white shadow-md active:scale-95 transition-all"
               title="Analisis Beban Kerja AI"
             >
               <BarChart3 className="w-5 h-5" />
             </button>
          )}
        </div>

        {activeTab === 'tracker' && (
          <div className="px-4 py-3 bg-slate-50 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input 
                className="w-full bg-white border border-slate-200 pl-10 pr-4 py-2.5 rounded-xl text-xs font-bold outline-none uppercase shadow-sm focus:border-blue-500 transition-all" 
                placeholder="Cari Wad atau Nama Staf..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50 scroll-smooth no-scrollbar">
          {activeTab === 'tracker' && (
            filteredIndents.length > 0 ? filteredIndents.map(item => (
              <div 
                key={item.id} 
                className={`bg-white p-4 rounded-2xl shadow-sm border-l-4 transition-all duration-300 transform
                  ${item.status === 'DONE' ? 'border-l-green-500 bg-green-50/30' : 
                    item.status === 'COLLECTED' ? 'border-l-slate-300 opacity-60 grayscale' : 'border-l-amber-500'}
                `}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex flex-col gap-0.5">
                    <span className={`text-[8px] font-black uppercase tracking-tight ${getUnitColor(item.unit)}`}>{item.unit}</span>
                    <span className="text-[9px] font-black bg-blue-100 text-blue-600 px-2 py-0.5 rounded uppercase w-fit">{item.type}</span>
                  </div>
                  <div className="flex gap-2">
                    {item.status === 'DONE' && (
                      <button 
                        onClick={() => handleGenerateAiMessage(item)} 
                        className="p-1 text-purple-600 bg-purple-50 rounded-lg border border-purple-100 active:scale-90 transition-transform"
                        title="Jana Mesej WhatsApp"
                      >
                        <Sparkles className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { setTempNote(item.note || ''); setShowNoteModal(item); }} className={`p-1 ${item.note ? 'text-red-500 animate-bounce' : 'text-slate-200'}`}>
                      <StickyNote className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => { 
                        if(item.status === 'PENDING') updateStatus(item, 'DONE'); 
                        else if(item.status === 'DONE') setShowCollectorModal(item); 
                      }} 
                      className={`text-[10px] font-black px-3 py-1 rounded-lg border uppercase italic transition-all active:scale-95 
                        ${item.status === 'DONE' ? 'bg-green-100 text-green-700 border-green-200 shadow-green-100' : 
                          item.status === 'COLLECTED' ? 'bg-slate-100 text-slate-500 border-slate-200' : 
                          'bg-amber-100 text-amber-700 border-amber-200 shadow-amber-100'}
                      `}
                    >
                      {item.status}
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <h3 className={`text-xl font-black uppercase italic tracking-tighter leading-none ${getUnitColor(item.unit)}`}>{item.ward}</h3>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Staf: {item.staff}</p>
                  </div>
                  <div className="text-right flex flex-col gap-1">
                    <div className="flex items-center gap-1 justify-end text-slate-400 text-[9px] font-black uppercase tracking-tighter">
                      <Clock className="w-3 h-3" /> In: {formatDateTime(item.created_at)}
                    </div>
                    {item.done_at && (
                      <div className="flex items-center gap-1 justify-end text-green-600 text-[9px] font-black uppercase tracking-tighter">
                        <CheckCircle2 className="w-3 h-3" /> Ready: {formatDateTime(item.done_at)}
                      </div>
                    )}
                    {item.collected_at && (
                      <div className="flex items-center gap-1 justify-end text-slate-500 text-[9px] font-black uppercase tracking-tighter">
                        <User className="w-3 h-3" /> Out: {formatDateTime(item.collected_at)}
                      </div>
                    )}
                  </div>
                </div>
                {item.collected_by && (
                  <div className="mt-2 py-1 px-3 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 uppercase italic">
                    Diambil oleh: {item.collected_by}
                  </div>
                )}
                {item.note && (
                  <div className="mt-2 p-2 bg-red-100 rounded-xl border border-red-200 text-[10px] font-black text-red-700 uppercase italic leading-tight">
                    Nota: {item.note}
                  </div>
                )}
              </div>
            )) : (
              <div className="text-center py-20 opacity-20 flex flex-col items-center">
                <LayoutGrid className="w-16 h-16 mb-2" />
                <p className="font-black uppercase text-xs">Tiada Indent</p>
              </div>
            )
          )}

          {activeTab === 'entry' && (
            <div className="p-4 space-y-6">
              <h2 className="text-2xl font-black uppercase italic text-slate-800 tracking-tighter">Daftar Indent</h2>
              <form onSubmit={handleAddIndent} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Unit Pembekal</label>
                  <select value={entryUnit} onChange={(e) => setEntryUnit(e.target.value)} className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black uppercase outline-none shadow-sm focus:ring-2 ring-blue-500/20">
                    {Object.keys(unitSettings).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Wad / Unit Pemohon</label>
                   <input name="ward" required className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black uppercase text-lg outline-none focus:border-blue-600 shadow-sm" placeholder="4A / ICUB" />
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Kategori Ubat</label>
                   <select name="type" className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-black uppercase outline-none shadow-sm">
                     {(unitSettings[entryUnit] || []).map(c => <option key={c} value={c}>{c}</option>)}
                   </select>
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nama Staf Wad</label>
                   <input name="staff" className="w-full bg-white border border-slate-200 p-4 rounded-2xl font-bold uppercase outline-none focus:border-blue-600 shadow-sm" placeholder="NAMA STAF" />
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl active:scale-95 transition-all mt-4 hover:bg-blue-700">
                  Hantar Indent
                </button>
              </form>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="p-4 space-y-6 pb-10">
              <h2 className="text-2xl font-black uppercase italic text-slate-800 tracking-tighter">Tetapan Aplikasi</h2>
              
              <div className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm space-y-3">
                 <div className="flex items-center gap-2 mb-1">
                    <Edit3 className="w-4 h-4 text-blue-600" />
                    <h3 className="text-[10px] font-black uppercase text-blue-600 tracking-widest">Nama Aplikasi</h3>
                 </div>
                 <div className="flex gap-2">
                    <input 
                      className="flex-1 bg-slate-50 border-none p-4 rounded-2xl font-bold uppercase text-xs outline-none focus:ring-2 ring-blue-500/20" 
                      value={tempAppName} 
                      onChange={(e) => setTempAppName(e.target.value)}
                      placeholder="NAMA APLIKASI"
                    />
                    <button 
                      onClick={saveAppName}
                      className="bg-blue-600 text-white px-5 rounded-2xl font-black uppercase text-[10px] shadow-lg active:scale-95 transition-all"
                    >
                      Simpan
                    </button>
                 </div>
                 <p className="text-[8px] text-slate-400 font-bold uppercase italic">* Nama ini akan muncul di header peranti semua staf.</p>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-black uppercase text-slate-400 ml-4 tracking-widest">Senarai Unit</h3>
                {Object.keys(unitSettings).map(name => (
                  <div key={name} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                    <div>
                      <p className={`text-sm font-black uppercase italic ${getUnitColor(name)}`}>{name}</p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase">{unitSettings[name].join(', ')}</p>
                    </div>
                    <button 
                      onClick={() => {
                        if(Object.keys(unitSettings).length > 1) {
                          setConfirmDialog({
                            show: true,
                            title: 'PADAM UNIT?',
                            message: `Adakah anda pasti mahu memadam unit ${name}?`,
                            action: () => {
                              const n = {...unitSettings}; 
                              delete n[name]; 
                              saveUnitSettings(n);
                              setConfirmDialog({ show: false });
                            }
                          });
                        }
                      }} 
                      className="p-2 text-slate-200 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              
              <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100 space-y-3">
                <p className="text-[10px] font-black uppercase text-blue-600 text-center tracking-widest">Tambah Unit Baru</p>
                <input id="newU" className="w-full p-3 rounded-xl border-none font-bold uppercase text-xs shadow-sm outline-none" placeholder="NAMA UNIT" />
                <textarea id="newC" className="w-full p-3 rounded-xl border-none font-bold uppercase text-[10px] shadow-sm outline-none" placeholder="KATEGORI (ASINGKAN DENGAN KOMA)" rows="2" />
                <button 
                  onClick={() => {
                    const u = document.getElementById('newU').value;
                    const c = document.getElementById('newC').value;
                    if(u && c) {
                      saveUnitSettings({...unitSettings, [u]: c.split(',').map(x => x.trim())});
                      document.getElementById('newU').value = '';
                      document.getElementById('newC').value = '';
                    }
                  }} 
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-black uppercase text-[10px] shadow-lg active:scale-95 transition-transform"
                >
                  Tambah Unit
                </button>
              </div>
              
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <h3 className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Pengurusan Rekod Cloud</h3>
                <button 
                  onClick={() => setConfirmDialog({
                    show: true,
                    title: 'PADAM REKOD SELESAI?',
                    message: 'Semua rekod berstatus "COLLECTED" akan dipadam selamanya dari database cloud.',
                    action: clearCollectedOnly
                  })}
                  className="w-full bg-white text-amber-600 p-4 rounded-2xl font-black uppercase text-[10px] border border-amber-100 shadow-sm flex items-center justify-center gap-2 active:scale-95"
                >
                  <Trash2 className="w-3 h-3" /> Padam Rekod Selesai (Collected)
                </button>
                <button 
                  onClick={() => setConfirmDialog({
                    show: true,
                    title: 'KOSONGKAN SEMUA?',
                    message: 'AWAS: Ini akan memadam SEMUA rekod di server cloud!',
                    action: clearAllIndents
                  })}
                  className="w-full bg-red-50 text-red-600 p-4 rounded-2xl font-black uppercase text-[10px] border border-red-100 flex items-center justify-center gap-2 active:scale-95"
                >
                  <Eraser className="w-3 h-3" /> Bersihkan Semua Rekod Indent
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="h-20 bg-white border-t flex justify-around items-center px-6 pb-6 sticky bottom-0 z-10">
          <button onClick={() => setActiveTab('tracker')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'tracker' ? 'text-blue-600 scale-110 font-black' : 'text-slate-300'}`}>
            <LayoutGrid className="w-6 h-6" /><span className="text-[9px] font-black uppercase">STATUS</span>
          </button>
          <button onClick={() => setActiveTab('entry')} className="bg-blue-600 text-white p-4 rounded-2xl shadow-xl -mt-10 active:scale-90 border-4 border-white">
            <Plus className="w-6 h-6" />
          </button>
          <button onClick={() => setActiveTab('settings')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'settings' ? 'text-blue-600 scale-110 font-black' : 'text-slate-300'}`}>
            <Settings className="w-6 h-6" /><span className="text-[9px] font-black uppercase">SETTING</span>
          </button>
        </div>

        {showAiModal && (
          <div className="absolute inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-6 shadow-2xl relative overflow-hidden border-t-8 border-purple-600">
              <button onClick={() => setShowAiModal(false)} className="absolute top-4 right-4 text-slate-300 hover:text-slate-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h3 className="font-black uppercase text-[13px] text-slate-800 tracking-wider">Pembantu AI Farmasi</h3>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 min-h-[100px] max-h-[400px] overflow-y-auto no-scrollbar border border-slate-100 mb-6 text-xs font-bold text-slate-700 leading-relaxed uppercase italic">
                {aiLoading ? "Sedang Berfikir..." : (aiResponse || "Tiada respon.")}
              </div>
              {!aiLoading && aiResponse && (
                <button onClick={() => { navigator.clipboard.writeText(aiResponse); }} className="w-full bg-purple-600 text-white py-3 rounded-xl font-black uppercase text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <MessageSquare className="w-3 h-3" /> Salin Respon
                </button>
              )}
            </div>
          </div>
        )}

        {showUnitSelector && (
          <div className="absolute inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-6 backdrop-blur-sm animate-in zoom-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-6 shadow-2xl">
              <h3 className="font-black uppercase text-[11px] text-slate-400 mb-6 px-2 text-center tracking-widest italic">Pilih Paparan Unit</h3>
              <div className="grid grid-cols-2 gap-3 overflow-y-auto no-scrollbar max-h-[60vh] p-1">
                <button onClick={() => { setCurrentUnitFilter('SEMUA UNIT'); setShowUnitSelector(false); }} className={`col-span-2 p-4 rounded-2xl font-black uppercase text-[10px] shadow-sm transition-all active:scale-95 ${currentUnitFilter === 'SEMUA UNIT' ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-slate-50 text-slate-500'}`}>Tunjukkan Semua Unit</button>
                {Object.keys(unitSettings).map(u => (
                  <button key={u} onClick={() => { setCurrentUnitFilter(u); setShowUnitSelector(false); }} className={`p-4 rounded-2xl font-black uppercase text-[10px] leading-tight shadow-sm transition-all active:scale-95 flex flex-col items-center justify-center text-center ${currentUnitFilter === u ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white border border-slate-100 text-slate-600'}`}>{u}</button>
                ))}
              </div>
              <div className="mt-6 flex justify-center"><button onClick={() => setShowUnitSelector(false)} className="text-slate-300 font-bold uppercase text-[10px]">Tutup</button></div>
            </div>
          </div>
        )}

        {showCollectorModal && (
          <div className="absolute inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in zoom-in duration-200">
            <div className="bg-white w-full rounded-3xl p-6 shadow-2xl">
              <h3 className="font-black uppercase text-purple-600 mb-4 flex items-center gap-2 italic"><User className="w-5 h-5" /> Pengambil</h3>
              <input autoFocus className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl font-black uppercase mb-4 outline-none" placeholder="NAMA STAF PENGAMBIL" value={collectorName} onChange={(e) => setCollectorName(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => setShowCollectorModal(null)} className="flex-1 font-black text-slate-300 uppercase text-[10px]">Batal</button>
                <button onClick={() => { if(!collectorName) return; updateStatus(showCollectorModal, 'COLLECTED', collectorName.toUpperCase()); setShowCollectorModal(null); setCollectorName(''); }} className="flex-[2] bg-purple-600 text-white py-3 rounded-xl font-black uppercase text-[10px] shadow-lg active:scale-95">Sahkan</button>
              </div>
            </div>
          </div>
        )}

        {showNoteModal && (
          <div className="absolute inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in zoom-in duration-200">
            <div className="bg-white w-full rounded-3xl p-6 shadow-2xl">
              <h3 className="font-black uppercase text-red-600 mb-4 flex items-center gap-2 italic"><StickyNote className="w-5 h-5" /> Nota</h3>
              <textarea rows="3" autoFocus className="w-full p-4 bg-red-50 border border-red-100 rounded-xl font-bold uppercase mb-4 outline-none text-sm" value={tempNote} onChange={(e) => setTempNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => setShowNoteModal(null)} className="flex-1 font-black text-slate-300 uppercase text-[10px]">Batal</button>
                <button onClick={() => { updateStatus(showNoteModal, showNoteModal.status, null, tempNote.toUpperCase()); setShowNoteModal(null); }} className="flex-[2] bg-red-600 text-white py-3 rounded-xl font-black uppercase text-[10px] shadow-lg">Simpan</button>
              </div>
            </div>
          </div>
        )}

        {confirmDialog.show && (
          <div className="absolute inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full rounded-3xl p-6 shadow-2xl border-t-8 border-amber-500">
              <div className="flex justify-center mb-4 text-amber-500"><AlertCircle className="w-12 h-12" /></div>
              <h3 className="font-black uppercase text-slate-800 text-center text-lg mb-2 italic tracking-tight">{confirmDialog.title}</h3>
              <p className="text-[11px] font-bold text-slate-400 text-center uppercase leading-tight mb-6">{confirmDialog.message}</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDialog({ show: false })} className="flex-1 font-black text-slate-300 uppercase text-[10px] py-3">Batal</button>
                <button onClick={confirmDialog.action} className="flex-[2] bg-slate-800 text-white py-3 rounded-xl font-black uppercase text-[10px] shadow-lg transition-colors active:bg-amber-600">Sahkan</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
