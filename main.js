// -----------------
// Config
// -----------------
const GOOGLE_CLIENT_ID = "398242159089-quklvo42q31ts435ejhlbtdhbpp0g1c1.apps.googleusercontent.com";
const PACKS = {
  prismatic: { name: "Prismatic Evolutions", image: "prismatic_evolutions_art.png", pool: "cards.json", background: "prismatic_bg.png" },
  twilight:  { name: "Twilight Masquerade", image: "twilight_masquerade_art.png", pool: "twilightcards.json", background: "yellow.png" },
  sv151:     { name: "Scarlet & Violet 151", image: "pokemon_151_art.png", pool: "151cards.json", background: "blue.png" }
};
// math removed
const QUIZ_CATEGORIES = ['biology','chemistry','physics','accounting','econs'];

// -----------------
// Local storage keys & leaderboard
// -----------------
const LS_PROFILE = "pk_profile_v1";
const LS_LEADERBOARD = "pk_leaderboard_v1";
const LS_MARKET = "pk_market_v1";

let leaderboard = []; // will hold { name, uniqueCards, uid? }

// -----------------
// Player Profile / Market
// -----------------
let playerProfile = {
  uid: null,
  name: "Player",
  coins: 500,
  packsOpened: 0,
  quizScore: 0,
  collection: { prismatic: new Set(), twilight: new Set(), sv151: new Set() },
  inventoryCounts: { prismatic: {}, twilight: {}, sv151: {} },
  totalCards: 0,
  avatar: null
};

// Firestore/auth refs (attached if firebase present)
let firestore = null;
let firebaseAuth = null;

// -----------------
// Utility helpers
// -----------------
function dbg(...args){ console.log("[app]",...args); }

function safeParsePossiblyHtmlWrappedJson(text) {
  try { return JSON.parse(text); } catch {
    const firstArr = text.indexOf("[");
    const lastArr = text.lastIndexOf("]");
    const firstObj = text.indexOf("{");
    const lastObj = text.lastIndexOf("}");
    if (firstArr !== -1 && lastArr > firstArr) return JSON.parse(text.slice(firstArr, lastArr+1));
    if (firstObj !== -1 && lastObj > firstObj) return JSON.parse(text.slice(firstObj, lastObj+1));
    throw new Error("Invalid JSON response");
  }
}

async function fetchTextWithEncodingFallback(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buffer = await r.arrayBuffer();
  let utf = new TextDecoder("utf-8").decode(buffer);
  try { safeParsePossiblyHtmlWrappedJson(utf); return utf; } catch {
    try { let win = new TextDecoder("windows-1252").decode(buffer); safeParsePossiblyHtmlWrappedJson(win); return win; } catch { return utf; }
  }
}

// -----------------
// Firebase init
// -----------------
function initFirebase() {
  if (!window.firebase) {
    dbg("Firebase not available");
    return;
  }
  try {
    if (firebase.apps && firebase.apps.length) {
      firestore = firebase.firestore();
      firebaseAuth = firebase.auth();
      dbg("Firebase detected, firestore/auth attached");
    } else {
      dbg("No firebase app found (index.html should initialize it)");
    }
  } catch (e) {
    console.error("initFirebase error", e);
  }
}

// -----------------
// Local storage load/save
// -----------------
function loadLocalState() {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.collection = parsed.collection || {};
      parsed.inventoryCounts = parsed.inventoryCounts || { prismatic: {}, twilight: {}, sv151: {} };
      ["prismatic","twilight","sv151"].forEach(k => {
        const arr = parsed.collection[k] || [];
        parsed.collection[k] = new Set(Array.isArray(arr) ? arr : []);
      });
      parsed.inventoryCounts = parsed.inventoryCounts || { prismatic: {}, twilight: {}, sv151: {} };
      playerProfile = Object.assign({}, playerProfile, parsed);
    }
  } catch (e) { console.warn("loadLocalState failed", e); }

  try {
    const lb = localStorage.getItem(LS_LEADERBOARD);
    if (lb) {
      leaderboard = JSON.parse(lb);
      if (!Array.isArray(leaderboard)) leaderboard = [];
    }
  } catch (e) { console.warn("load leaderboard failed", e); }
}

function saveLocalState() {
  try {
    const copy = {
      ...playerProfile,
      collection: {
        prismatic: Array.from(playerProfile.collection.prismatic || []),
        twilight: Array.from(playerProfile.collection.twilight || []),
        sv151: Array.from(playerProfile.collection.sv151 || [])
      },
      inventoryCounts: playerProfile.inventoryCounts || { prismatic: {}, twilight: {}, sv151: {} }
    };
    localStorage.setItem(LS_PROFILE, JSON.stringify(copy));
    localStorage.setItem(LS_LEADERBOARD, JSON.stringify(leaderboard));
  } catch (e) { console.warn("saveLocalState error", e); }
}

// -----------------
// Card pool helpers
// -----------------
function buildCardPool(dataObj) {
  const pool = [];
  for (const arr of Object.values(dataObj)) {
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const w = Number(c.dropRate);
      if (!isNaN(w) && w > 0) pool.push({ ...c, dropRate: w });
    }
  }
  const total = pool.reduce((s, c) => s + c.dropRate, 0);
  return { pool, total };
}
function pickWeighted(pool, total) {
  let r = Math.random() * total;
  for (const c of pool) {
    r -= c.dropRate;
    if (r <= 0) return c;
  }
  return pool[pool.length-1]||null;
}

// -----------------
// UI functions
// -----------------
function updateProfile() {
  const el = id => document.getElementById(id);
  const nameDisplay = el("playerNameDisplay");
  if (nameDisplay) nameDisplay.textContent = playerProfile.name || "Player";
  const input = el("playerNameInput");
  if (input) input.value = playerProfile.name || "";

  if (el("playerCoins")) el("playerCoins").textContent = Number(playerProfile.coins || 0);
  if (el("packsOpened")) el("packsOpened").textContent = Number(playerProfile.packsOpened || 0);
  if (el("totalCards")) el("totalCards").textContent = Number(playerProfile.totalCards || 0);

  const coll = playerProfile.collection || { prismatic: new Set(), twilight: new Set(), sv151: new Set() };
  const up = coll.prismatic.size ?? 0;
  const ut = coll.twilight.size ?? 0;
  const us = coll.sv151.size ?? 0;

  if (el("uniquePrismatic")) el("uniquePrismatic").textContent = up;
  if (el("uniqueTwilight")) el("uniqueTwilight").textContent = ut;
  if (el("uniqueSV151")) el("uniqueSV151").textContent = us;
  if (el("uniqueCards")) el("uniqueCards").textContent = up + ut + us;

  if (el("playerID")) el("playerID").textContent = playerProfile.id || "000001";
  if (el("quizScore")) el("quizScore").textContent = playerProfile.quizScore || 0;

  const avatarEl = document.getElementById("avatarImg");
  if (avatarEl) {
    const url = playerProfile.avatar || "default_avatar.png";
    avatarEl.style.backgroundImage = `url('${url}')`;
  }

  saveLocalState();

  // best-effort push current player's profile to firestore players collection
  saveProfileToFirestore().catch(()=>{});
}

// -----------------
// Leaderboard functions (local + firestore)
// -----------------
function getTotalUniqueCards(profile) {
  const coll = profile && profile.collection ? profile.collection : {};
  const up = (coll.prismatic && coll.prismatic.size) ? coll.prismatic.size :
             (Array.isArray(coll.prismatic) ? coll.prismatic.length : 0);
  const ut = (coll.twilight && coll.twilight.size) ? coll.twilight.size :
             (Array.isArray(coll.twilight) ? coll.twilight.length : 0);
  const us = (coll.sv151 && coll.sv151.size) ? coll.sv151.size :
             (Array.isArray(coll.sv151) ? coll.sv151.length : 0);
  return up + ut + us;
}

async function saveProfileToFirestore() {
  if (!firestore || !playerProfile.uid) return;
  try {
    const uniqueCards = getTotalUniqueCards(playerProfile);
    await firestore.collection("players").doc(playerProfile.uid).set({
      name: playerProfile.name,
      uniqueCards,
      coins: playerProfile.coins,
      packsOpened: playerProfile.packsOpened,
      totalCards: playerProfile.totalCards,
      avatar: playerProfile.avatar || null,
      updated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    dbg("Saved profile to Firestore");
  } catch(e) { console.warn("saveProfileToFirestore failed", e); }
}

async function loadLeaderboardFromFirebase(limit=20) {
  if (!firestore) return;
  try {
    const snapshot = await firestore.collection("players").orderBy("uniqueCards","desc").limit(limit).get();
    const arr = [];
    let rank = 1;
    const box = document.getElementById("leaderboardBox2");
    if (!box) return;
    let html = "<h3>Top Trainers</h3>";
    snapshot.forEach(doc => {
      const d = doc.data();
      html += `<p>${rank}. ${d.name || 'Unknown'} — ${d.uniqueCards || 0} unique cards</p>`;
      rank++;
    });
    box.innerHTML = html;
  } catch (e) { console.warn("loadLeaderboardFromFirebase", e); }
}

function updateLeaderboard() {
  // prefer Firestore view if available & connected
  if (firestore) {
    loadLeaderboardFromFirebase().catch(()=>{});
    return;
  }

  // local fallback: read saved leaderboard array, ensure current player is included and sorted
  try {
    const local = Array.isArray(leaderboard) ? leaderboard.slice() : [];
    // ensure current player exists in array (match by uid or name)
    const unique = getTotalUniqueCards(playerProfile);
    const ident = playerProfile.uid || playerProfile.name || "local-player";
    let found = false;
    for (let i=0;i<local.length;i++){
      if ((local[i].uid && playerProfile.uid && local[i].uid === playerProfile.uid) || local[i].name === playerProfile.name) {
        local[i].uniqueCards = unique;
        found = true;
        break;
      }
    }
    if (!found) local.push({ uid: playerProfile.uid || null, name: playerProfile.name || "Player", uniqueCards: unique });

    // sort descending
    local.sort((a,b) => (b.uniqueCards || 0) - (a.uniqueCards || 0));
    // keep top 20
    const shown = local.slice(0,20);
    // render
    document.querySelectorAll("#leaderboardBox, #leaderboardBox2, .leaderboard-box").forEach(box => {
      let html = "<h3>Leaderboard</h3>";
      shown.forEach((e, idx) => {
        html += `<p>${idx+1}. ${e.name}: ${e.uniqueCards || 0}</p>`;
      });
      box.innerHTML = html;
    });
    // persist
    leaderboard = local;
    localStorage.setItem(LS_LEADERBOARD, JSON.stringify(leaderboard));
  } catch (e) {
    console.warn("updateLeaderboard error", e);
  }
}

// -----------------
// Pack opening
// -----------------
async function loadPack(keyOrFile) {
  let key = keyOrFile;
  if (!PACKS[key]) {
    if (typeof keyOrFile === "string" && keyOrFile.includes("twilight")) key = "twilight";
    else if (typeof keyOrFile === "string" && keyOrFile.includes("151")) key = "sv151";
    else key = "prismatic";
  }
  const cfg = PACKS[key];
  if (!cfg) return alert("Bad pack");

  if (playerProfile.coins < 150) { alert("Not enough coins!"); return; }
  playerProfile.coins -= 150;
  playerProfile.packsOpened++;
  updateProfile();

  let parsed;
  try {
    const txt = await fetchTextWithEncodingFallback(cfg.pool);
    parsed = safeParsePossiblyHtmlWrappedJson(txt.trim().replace(/^\uFEFF/, ""));
  } catch (err) {
    console.error("failed to fetch pool", err);
    return alert("Failed to load pack file.");
  }

  let cardsArray = Array.isArray(parsed) ? parsed : [];
  if (!Array.isArray(parsed)) {
    for (const k in parsed) if (Array.isArray(parsed[k])) cardsArray = cardsArray.concat(parsed[k]);
  }
  if (!cardsArray.length) return alert("Pack pool empty");

  const { pool, total } = buildCardPool({ tmp: cardsArray });
  if (!pool.length || total <= 0) return alert("Pack pool invalid (no dropRates)");

  const pack = Array.from({ length: 10 }, () => pickWeighted(pool, total));

  const overlay = document.getElementById("packOverlay");
  if (!overlay) { alert("Pack UI not found in page"); return; }

  let stackEl = document.getElementById("overlayStack");
  if (!stackEl) {
    stackEl = document.createElement("div");
    stackEl.id = "overlayStack";
    stackEl.className = "overlay-stack";
    overlay.appendChild(stackEl);
  }
  let remainingEl = document.getElementById("overlayRemaining");
  if (!remainingEl) {
    remainingEl = document.createElement("div");
    remainingEl.id = "overlayRemaining";
    remainingEl.style.color = "white";
    overlay.appendChild(remainingEl);
  }

  overlay.classList.remove("prismatic","twilight","sv151");
  overlay.classList.add("show", key);
  stackEl.innerHTML = "";

  pack.forEach((card,i) => {
    const div = document.createElement("div");
    div.className = "overlay-card";
    div.style.zIndex = 100 + i;
    const imgSrc = card && card.img ? card.img : (cfg.image || "");
    const alt = (card && (card.name || card.id)) ? (card.name || card.id) : "card";
    div.innerHTML = `<img src="${imgSrc}" alt="${alt}" />`;
    stackEl.appendChild(div);
  });

  let topIdx = pack.length - 1;
  remainingEl.textContent = `${topIdx + 1} cards left`;

  stackEl.onclick = () => {
    if (topIdx < 0) return;
    const topEl = stackEl.lastElementChild;
    if (!topEl) return;
    const data = pack[topIdx];
    topIdx--;

    topEl.classList.add("slide-up");
    topEl.addEventListener("transitionend", () => {
      try { topEl.remove(); } catch(e){}
      const cardId = (data && (data.name || data.id)) ? (data.name || data.id) : JSON.stringify(data);

      playerProfile.inventoryCounts = playerProfile.inventoryCounts || { prismatic:{}, twilight:{}, sv151:{} };
      playerProfile.inventoryCounts[key][cardId] = (playerProfile.inventoryCounts[key][cardId] || 0) + 1;

      if (!playerProfile.collection[key]) playerProfile.collection[key] = new Set();
      playerProfile.collection[key].add(cardId);

      playerProfile.totalCards = Number(playerProfile.totalCards || 0) + 1;
      updateProfile();

      if (remainingEl) remainingEl.textContent = topIdx >= 0 ? `${topIdx + 1} cards left` : "All cards revealed!";
      if (topIdx < 0) { setTimeout(() => { document.getElementById("packOverlayClose")?.click(); }, 900); }
    }, { once: true });
  };
}

function openPack(file) { return loadPack(file); }

// -----------------
// Quiz (spammable, points from JSON, images, typing answers, wrong -> 3s X overlay)
// -----------------
let currentQuiz = {
  fullQuestions: [],   // all loaded questions for the category
  pool: [],            // remaining questions to ask (popped)
  scoreThisSession: 0, // optional local counter (playerProfile.quizScore is global/cumulative)
  category: null
};

// utility to create a fullscreen X overlay for wrong answers (re-used)
function showWrongOverlay(durationMs = 3000) {
  // if overlay already exists, don't duplicate
  let o = document.getElementById("wrongOverlay");
  if (!o) {
    o = document.createElement("div");
    o.id = "wrongOverlay";
    // inline styles so no HTML/CSS edits required
    Object.assign(o.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: "3200",
      background: "rgba(255,0,0,0.12)",
      backdropFilter: "blur(2px)",
      transition: "opacity 200ms ease",
      opacity: "0"
    });
    const cross = document.createElement("div");
    cross.innerHTML = "✕";
    Object.assign(cross.style, {
      fontSize: "120px",
      color: "rgba(255,0,0,0.92)",
      textShadow: "0 6px 18px rgba(0,0,0,0.25)",
      transform: "scale(0.9)",
      transition: "transform 180ms ease"
    });
    o.appendChild(cross);
    document.body.appendChild(o);
    // force reflow to animate
    requestAnimationFrame(()=> { o.style.opacity = "1"; cross.style.transform = "scale(1)"; });
  } else {
    // ensure visible
    o.style.opacity = "1";
    if (o.firstChild) o.firstChild.style.transform = "scale(1)";
  }

  // hide after duration
  return new Promise(resolve => {
    setTimeout(()=> {
      if (!o) return resolve();
      o.style.opacity = "0";
      if (o.firstChild) o.firstChild.style.transform = "scale(0.9)";
      // remove after animation
      setTimeout(()=> { try { o.remove(); } catch(e){}; resolve(); }, 220);
    }, durationMs);
  });
}

// shuffle in-place
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// load the category JSON and prepare an infinite-ish pool
async function loadQuizCategory(cat) {
  const container = document.getElementById("quizContainer");
  container.innerHTML = "<p>Loading questions...</p>";
  try {
    const txt = await fetchTextWithEncodingFallback(`${cat}.json`);
    const parsed = safeParsePossiblyHtmlWrappedJson(txt.trim().replace(/^\uFEFF/, ""));
    let qarr = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed)) {
      for (const k in parsed) if (Array.isArray(parsed[k])) qarr = qarr.concat(parsed[k]);
    }
    if (!qarr.length) { container.innerHTML = "<p>No questions found for this category.</p>"; return; }

    // Normalize: ensure 'answer' maybe array, ensure points numeric, optional image
    qarr = qarr.map(q => {
      const copy = Object.assign({}, q);
      // unify answer to either array or string as given (we accept either)
      if (Array.isArray(copy.answer)) {
        copy._answers = copy.answer.map(a => String(a).toLowerCase().trim());
      } else {
        copy._answers = [String(copy.answer || "").toLowerCase().trim()];
      }
      copy.points = Number(copy.points || 1);
      return copy;
    });

    // store fullQuestions (clone & shuffle)
    currentQuiz.fullQuestions = shuffleArray(qarr.slice());
    // pool starts as a copy; we'll pop from it, and when empty refill with shuffle of fullQuestions
    currentQuiz.pool = currentQuiz.fullQuestions.slice();
    currentQuiz.category = cat;
    currentQuiz.scoreThisSession = 0;

    // render immediately the first question and then continue infinitely
    renderQuizQuestion();
  } catch (e) {
    console.error("loadQuizCategory", e);
    container.innerHTML = "<p>Failed to load questions.</p>";
  }
}

// pick next question from pool, refill if empty
function getNextQuestion() {
  if (!currentQuiz.pool || !currentQuiz.pool.length) {
    // refill a shuffled copy of fullQuestions
    currentQuiz.pool = shuffleArray(currentQuiz.fullQuestions.slice());
  }
  return currentQuiz.pool.pop();
}

// render a single question (no Next button) — after answering we immediately show another
function renderQuizQuestion() {
  const container = document.getElementById("quizContainer");
  const controls = document.getElementById("quizControls");
  container.innerHTML = "";
  controls.innerHTML = "";

  // choose question
  const q = getNextQuestion();
  if (!q) {
    container.innerHTML = "<p>No questions available.</p>";
    return;
  }

  // show question
  const qBox = document.createElement("div");
  qBox.innerHTML = `<h3 style="margin:0 0 8px"> ${q.question || "(no question text)"} </h3>`;

  // optional image
  if (q.image) {
    const img = document.createElement("img");
    img.src = q.image;
    img.alt = "question image";
    img.style.maxWidth = "360px";
    img.style.display = "block";
    img.style.margin = "10px 0";
    qBox.appendChild(img);
  }

  // show controls (score display)
  controls.innerHTML = `<div>Score: ${playerProfile.quizScore || 0}</div>`;

  // if options exist, render buttons; otherwise typing box
  const options = (q.options && Array.isArray(q.options) && q.options.length) ? q.options.slice() : null;

  // helper to continue to next question
  const continueToNext = (delayMs = 400) => {
    setTimeout(()=> {
      // immediately render next question
      renderQuizQuestion();
    }, delayMs);
  };

  if (options) {
    // shuffle options
    shuffleArray(options);
    const list = document.createElement("div");
    list.style.marginTop = "8px";
    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.textContent = opt;
      btn.style.cursor = "pointer";
      btn.style.marginBottom = "8px";
      btn.addEventListener("click", async () => {
        // disable all options
        Array.from(list.querySelectorAll("button")).forEach(b => b.disabled = true);
        const guess = String(opt).trim().toLowerCase();
        const isCorrect = q._answers.some(a => a === guess);
        if (isCorrect) {
          // award points
          playerProfile.quizScore = Number(playerProfile.quizScore || 0) + Number(q.points || 1);
          currentQuiz.scoreThisSession += Number(q.points || 1);
          // visual feedback
          btn.classList.add("correct");
          updateProfile();
          // continue quickly
          continueToNext(450);
        } else {
          btn.classList.add("wrong");
          // highlight the correct option if present
          Array.from(list.querySelectorAll("button")).forEach(b => {
            if (String(b.textContent).trim().toLowerCase() === q._answers[0]) b.classList.add("correct");
            b.disabled = true;
          });
          // show big overlay X for 3s then continue (no points)
          await showWrongOverlay(3000);
          continueToNext(120);
        }
      });
      list.appendChild(btn);
    });
    qBox.appendChild(list);
  } else {
    // typing input mode
    const row = document.createElement("div");
    row.style.marginTop = "10px";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type your answer...";
    input.style.padding = "8px";
    input.style.width = "65%";
    input.style.borderRadius = "8px";
    const submit = document.createElement("button");
    submit.className = "primary";
    submit.textContent = "Submit";
    submit.style.marginLeft = "8px";

    let locked = false;
    const doSubmit = async () => {
      if (locked) return;
      locked = true;
      input.disabled = true;
      submit.disabled = true;
      const user = String(input.value || "").trim().toLowerCase();
      // correct if user's answer contains any acceptable answer OR matches exactly any answer
      let isCorrect = q._answers.some(a => {
        if (!a) return false;
        return user.includes(a) || a.includes(user) || user === a;
      });

      if (isCorrect) {
        playerProfile.quizScore = Number(playerProfile.quizScore || 0) + Number(q.points || 1);
        currentQuiz.scoreThisSession += Number(q.points || 1);
        updateProfile();
        // quick success flash
        input.style.border = "2px solid green";
        continueToNext(500);
      } else {
        input.style.border = "2px solid red";
        await showWrongOverlay(3000);
        continueToNext(120);
      }
    };

    submit.addEventListener("click", doSubmit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSubmit(); });
    row.appendChild(input);
    row.appendChild(submit);
    qBox.appendChild(row);
  }

  container.appendChild(qBox);
  // show small meta about points
  const pts = document.createElement("div");
  pts.style.fontSize = "13px";
  pts.style.color = "#444";
  pts.style.marginTop = "8px";
  pts.textContent = `Points for this question: ${q.points || 1}`;
  container.appendChild(pts);
}

// start quiz: load category JSON if not loaded already and begin
function startQuiz(category) {
  if (!category) {
    const container = document.getElementById("quizContainer");
    container.innerHTML = "<p>Select a category above to start the quiz.</p>";
    return;
  }
  // if loaded and different category, reload
  if (currentQuiz.category && currentQuiz.category !== category) {
    currentQuiz.fullQuestions = [];
    currentQuiz.pool = [];
  }
  if (!currentQuiz.fullQuestions.length || currentQuiz.category !== category) {
    loadQuizCategory(category);
  } else {
    // already loaded: just render next question
    renderQuizQuestion();
  }
}
// -----------------
// Card Dex (unchanged)
// -----------------
async function loadPackJson(poolFile) {
  try {
    const txt = await fetchTextWithEncodingFallback(poolFile);
    const parsed = safeParsePossiblyHtmlWrappedJson(txt.trim().replace(/^\uFEFF/, ""));
    if (Array.isArray(parsed)) return parsed;
    const arr = [];
    for (const k in parsed) if (Array.isArray(parsed[k])) arr.push(...parsed[k]);
    return arr;
  } catch (e) {
    console.warn("loadPackJson failed", poolFile, e);
    return [];
  }
}

async function renderCardDex() {
  const container = document.getElementById("cardDexResults");
  container.innerHTML = "<p>Loading card dex...</p>";
  const packs = [
    { key: "prismatic", file: PACKS.prismatic.pool, title: PACKS.prismatic.name },
    { key: "twilight", file: PACKS.twilight.pool, title: PACKS.twilight.name },
    { key: "sv151", file: PACKS.sv151.pool, title: PACKS.sv151.name }
  ];

  const searchInput = document.getElementById("cardDexSearch");
  const onlyOwned = document.getElementById("cardDexOnlyOwned");
  const searchText = (searchInput && searchInput.value) ? searchInput.value.trim().toLowerCase() : "";
  const ownedOnly = (onlyOwned && onlyOwned.checked);

  container.innerHTML = "";
  for (const p of packs) {
    const items = await loadPackJson(p.file);
    if (!items.length) continue;
    const section = document.createElement("div");
    section.innerHTML = `<h3>${p.title}</h3>`;
    const grid = document.createElement("div");
    grid.className = "card-grid";

    items.forEach(card => {
      const id = card.name || card.id || JSON.stringify(card);
      const count = (playerProfile.inventoryCounts && playerProfile.inventoryCounts[p.key] && playerProfile.inventoryCounts[p.key][id]) ? playerProfile.inventoryCounts[p.key][id] : 0;
      if (searchText && !(String(id).toLowerCase().includes(searchText))) return;
      if (ownedOnly && count <= 0) return;

      const tile = document.createElement("div");
      tile.className = "card-tile";
      tile.innerHTML = `<div style="font-weight:700;text-transform:capitalize">${card.name || "(unknown)"}</div>
                        <div style="margin:8px 0"><img src="${card.img || 'default_avatar.png'}" alt="${card.name || ''}" /></div>
                        <div>Owned: <strong>${count}</strong></div>`;
      grid.appendChild(tile);
    });

    section.appendChild(grid);
    container.appendChild(section);
  }
}

// -----------------
// Marketplace (unchanged except keys)
// -----------------
function loadMarketLocal() {
  try {
    const raw = localStorage.getItem(LS_MARKET);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveMarketLocal(listings) { localStorage.setItem(LS_MARKET, JSON.stringify(listings)); }

async function createMarketListing(packKey, cardName, price, fromInventory=false) {
  if (!cardName || !price) return alert("Card name and price required.");
  if (fromInventory) {
    const count = (playerProfile.inventoryCounts && playerProfile.inventoryCounts[packKey] && playerProfile.inventoryCounts[packKey][cardName]) ? playerProfile.inventoryCounts[packKey][cardName] : 0;
    if (count <= 0) return alert("You don't own any copy of that card to list.");
    playerProfile.inventoryCounts[packKey][cardName] = count - 1;
    updateProfile();
    saveLocalState();
  }

  const id = `${Date.now()}-${Math.floor(Math.random()*100000)}`;
  const listing = {
    id,
    pack: packKey,
    cardName,
    price: Number(price),
    sellerName: playerProfile.name || "anonymous",
    sellerId: (window.firebase && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : `local-${id}`,
    createdAt: Date.now(),
    reserved: !!fromInventory
  };

  const local = loadMarketLocal();
  local.push(listing);
  saveMarketLocal(local);

  if (firestore) {
    try { await firestore.collection("marketplace").doc(listing.id).set(listing); } catch (e) { console.warn("Failed to save listing to firestore", e); }
  }

  renderMarketListings();
  alert("Listing created.");
}

async function fetchMarketListings() {
  if (firestore) {
    try {
      const snap = await firestore.collection("marketplace").orderBy("createdAt","desc").get();
      const arr = [];
      snap.forEach(d => arr.push(d.data()));
      return arr;
    } catch (e) { console.warn("fetchMarketListings firestore failed", e); }
  }
  return loadMarketLocal();
}

async function cancelListing(listingId) {
  let listing = null;
  let local = loadMarketLocal();
  const li = local.find(l => l.id === listingId);
  if (li) listing = li;
  if (firestore) {
    try { await firestore.collection("marketplace").doc(listingId).delete(); } catch (e) {}
  }
  local = local.filter(l => l.id !== listingId);
  saveMarketLocal(local);

  if (listing && listing.reserved) {
    const sellerMatches = listing.sellerId && ((window.firebase && firebase.auth && firebase.auth().currentUser && listing.sellerId === firebase.auth().currentUser.uid) || listing.sellerId.startsWith("local-"));
    if (sellerMatches) {
      playerProfile.inventoryCounts = playerProfile.inventoryCounts || { prismatic:{}, twilight:{}, sv151:{} };
      playerProfile.inventoryCounts[listing.pack][listing.cardName] = (playerProfile.inventoryCounts[listing.pack][listing.cardName] || 0) + 1;
      updateProfile();
      saveLocalState();
    }
  }
  renderMarketListings();
}

async function buyListing(listingId) {
  const listings = await fetchMarketListings();
  const ls = listings.find(l => l.id === listingId);
  if (!ls) return alert("Listing not found.");
  if (ls.sellerId === ((window.firebase && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : `local-${listingId}`) ) {
    return cancelListing(listingId);
  }
  if (playerProfile.coins < ls.price) return alert("Not enough coins.");
  playerProfile.coins -= ls.price;
  playerProfile.inventoryCounts = playerProfile.inventoryCounts || { prismatic:{}, twilight:{}, sv151:{} };
  playerProfile.inventoryCounts[ls.pack][ls.cardName] = (playerProfile.inventoryCounts[ls.pack][ls.cardName] || 0) + 1;
  playerProfile.totalCards = Number(playerProfile.totalCards || 0) + 1;

  if (firestore) {
    try { await firestore.collection("marketplace").doc(listingId).delete(); } catch (e) { console.warn("Failed to delete listing from firestore", e); }
  } else {
    const local = loadMarketLocal().filter(l => l.id !== listingId);
    saveMarketLocal(local);
  }

  updateProfile();
  renderMarketListings();
  alert("Purchase successful!");
}

async function renderMarketListings() {
  const container = document.getElementById("marketListings");
  container.innerHTML = "<p>Loading market...</p>";
  const listings = await fetchMarketListings();
  container.innerHTML = "";
  if (!listings.length) { container.innerHTML = "<p>No listings currently.</p>"; return; }
  listings.forEach(l => {
    const el = document.createElement("div");
    el.className = "listing";
    const img = document.createElement("img");
    img.src = "default_avatar.png";
    loadPackJson(PACKS[l.pack].pool).then(cards => {
      const match = cards.find(c => (c.name || "").toLowerCase() === (l.cardName || "").toLowerCase());
      if (match && match.img) img.src = match.img;
    }).catch(()=>{});
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<div style="font-weight:700">${l.cardName}</div><div style="font-size:13px;color:#666">${l.sellerName} • ${l.pack} ${l.reserved ? '• (from inventory)' : ''}</div>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const price = document.createElement("div");
    price.style.fontWeight = "700"; price.textContent = `${l.price} coins`;
    const buyBtn = document.createElement("button");
    buyBtn.className = "primary";

    const isSeller = (window.firebase && firebase.auth && firebase.auth().currentUser && l.sellerId === firebase.auth().currentUser.uid) || (l.sellerId && l.sellerId.startsWith("local-") && l.sellerId.endsWith(l.id));
    buyBtn.textContent = isSeller ? "Cancel" : "Buy";
    buyBtn.addEventListener("click", () => {
      if (buyBtn.textContent === "Cancel") cancelListing(l.id);
      else buyListing(l.id);
    });
    actions.appendChild(price);
    actions.appendChild(buyBtn);
    el.appendChild(img);
    el.appendChild(meta);
    el.appendChild(actions);
    container.appendChild(el);
  });
}

// -----------------
// Small helper: pack launcher to avoid earlier error
// -----------------
function renderPackLauncher() {
  const launcher = document.getElementById("packLauncher");
  if (!launcher) return;
  launcher.innerHTML = "";
  Object.entries(PACKS).forEach(([key,cfg]) => {
    const card = document.createElement("div");
    card.className = "pack-option";
    card.innerHTML = `<img src="${cfg.image}" alt="${cfg.name}" style="width:160px;border-radius:10px"><div style="font-weight:700;margin-top:6px;color:#0b2545">${cfg.name}</div>`;
    card.addEventListener("click", () => loadPack(key));
    launcher.appendChild(card);
  });
}

// -----------------
// Menu helpers (mobile friendly)
// -----------------
function openMenu() {
  document.getElementById("sidebar")?.classList.add("active");
  document.getElementById("overlay")?.classList.add("active");
  document.body.classList.add("menu-open");
}
function closeMenu() {
  document.getElementById("sidebar")?.classList.remove("active");
  document.getElementById("overlay")?.classList.remove("active");
  document.body.classList.remove("menu-open");
}
function toggleMenu() {
  const isActive = document.getElementById("sidebar")?.classList.contains("active");
  if (isActive) closeMenu(); else openMenu();
}

// -----------------
// Wire up UI controls
// -----------------
function wireUI() {
  // quiz category buttons
  document.querySelectorAll(".quiz-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      startQuiz(cat);
      closeMenu();
    });
  });

  // menu buttons (also close menu when selecting)
  document.querySelectorAll('#sidebar button[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      showSection(btn.dataset.section);
      if (btn.dataset.section === "carddex") renderCardDex();
      if (btn.dataset.section === "bazaar") renderMarketListings();
      closeMenu();
    });
  });

  // pack close
  document.getElementById("packOverlayClose")?.addEventListener("click", () => {
    document.getElementById("packOverlay")?.classList.remove("show");
  });

  // name save (manual)
  const nameInput = document.getElementById("playerNameInput");
  const saveBtn = document.getElementById("saveNameBtn");
  const nameDisplay = document.getElementById("playerNameDisplay");
  if (saveBtn && nameInput) {
    saveBtn.addEventListener("click", () => {
      const v = nameInput.value && nameInput.value.trim();
      if (v) {
        playerProfile.name = v;
        if (nameDisplay) nameDisplay.textContent = v;
        if (window.firebase && firebase.auth && firebase.auth().currentUser) {
          try { firebase.auth().currentUser.updateProfile({ displayName: v }).catch(()=>{}); } catch(e){}
        }
        updateProfile();
      } else {
        nameInput.value = playerProfile.name || "Player";
      }
    });
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
  }

  // card dex filters
  document.getElementById("cardDexSearch")?.addEventListener("input", () => renderCardDex());
  document.getElementById("cardDexOnlyOwned")?.addEventListener("change", () => renderCardDex());
  document.getElementById("cardDexRefresh")?.addEventListener("click", () => renderCardDex());

  // bazaar form
  document.getElementById("listCardBtn")?.addEventListener("click", () => {
    const pack = document.getElementById("bazaarPackSelect").value;
    const cardName = document.getElementById("bazaarCardName").value.trim();
    const price = Number(document.getElementById("bazaarPrice").value);
    const fromInv = !!document.getElementById("bazaarFromInventory").checked;
    createMarketListing(pack, cardName, price, fromInv);
  });
}

// -----------------
// Sections
// -----------------
function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(s => s.style.display = "none");
  const el = document.getElementById(sectionId);
  if (el) el.style.display = "block";
  if (sectionId === "home") { updateProfile(); updateLeaderboard(); }
  if (sectionId === "quiz") startQuiz();
}

// -----------------
// DOM Ready
// -----------------
window.addEventListener("DOMContentLoaded", () => {
  dbg("app init");
  loadLocalState();
  initFirebase();

  if (window.firebase && firebase.auth) {
    firebaseAuth = firebase.auth();
    firebaseAuth.onAuthStateChanged(u => {
      if (u) {
        dbg("User signed in:", u.uid);
        playerProfile.uid = u.uid;
        // sync name/avatar if firebase knows it
        playerProfile.name = playerProfile.name || u.displayName || playerProfile.name;
        playerProfile.avatar = playerProfile.avatar || u.photoURL || playerProfile.avatar;
        initFirebase();
        loadLeaderboardFromFirebase().catch(()=>{});
      }
    });
  }

  renderPackLauncher();
  updateProfile();
  updateLeaderboard();
  showSection("home");
  wireUI();

  // placeholder for quiz
  startQuiz();

  // init Google Identity btn if present
  try {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
        auto_select: false
      });
      const gsiButtonContainer = document.getElementById("gsiButton");
      if (gsiButtonContainer) {
        google.accounts.id.renderButton(gsiButtonContainer, { theme: "outline", size: "large" });
      }
    } else dbg("Google Identity SDK not loaded (yet)");
  } catch (e) { console.warn("Google init error", e); }

  document.getElementById("googleLogoutBtn")?.addEventListener("click", handleGoogleLogout);

  // menu toggle
  document.getElementById("menu-btn")?.addEventListener("click", () => toggleMenu());
  document.getElementById("overlay")?.addEventListener("click", () => closeMenu());
  // close on Esc
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
});

// -----------------
// Google sign-in handlers
// -----------------
let prevManualName = null;

function handleGoogleLogin(response) {
  try {
    if (!response || !response.credential) { console.warn("handleGoogleLogin: no credential present", response); return; }
    const data = jwt_decode(response.credential);
    dbg("Google user:", data);

    prevManualName = playerProfile.name || "Player";
    const googleName = data.name || prevManualName || "Player";
    const chosen = window.prompt("Choose your display name (this will be saved):", googleName);
    const finalName = (chosen && chosen.trim()) ? chosen.trim() : googleName;

    playerProfile.name = finalName;
    if (data.picture) playerProfile.avatar = data.picture;

    const ni = document.getElementById("playerNameInput");
    const sb = document.getElementById("saveNameBtn");
    if (ni) ni.style.display = "none";
    if (sb) sb.style.display = "none";

    const gbtn = document.getElementById("gsiButton");
    if (gbtn) gbtn.style.display = "none";
    const logoutBtn = document.getElementById("googleLogoutBtn");
    if (logoutBtn) logoutBtn.style.display = "inline-block";

    if (window.firebase && firebase.auth) {
      const cred = firebase.auth.GoogleAuthProvider.credential(response.credential);
      firebase.auth().signInWithCredential(cred)
        .then(userCred => {
          dbg("Signed into Firebase as:", userCred.user.uid);
          playerProfile.uid = userCred.user.uid;
          try {
            if (firebase.auth().currentUser && firebase.auth().currentUser.updateProfile) {
              firebase.auth().currentUser.updateProfile({ displayName: finalName }).catch(()=>{});
            }
          } catch(e){}
          initFirebase();
          updateProfile();
        })
        .catch(err => { console.warn("Firebase sign-in failed", err); updateProfile(); });
    } else updateProfile();

    saveLocalState();
    alert(`Welcome, ${playerProfile.name}!`);
    closeMenu();
  } catch (e) {
    console.error("Google login failed", e);
  }
}

function handleGoogleLogout() {
  if (window.google && google.accounts && google.accounts.id && google.accounts.id.disableAutoSelect) {
    try { google.accounts.id.disableAutoSelect(); } catch(e) {}
  }

  const ni = document.getElementById("playerNameInput");
  const sb = document.getElementById("saveNameBtn");
  const gbtn = document.getElementById("gsiButton");
  const logoutBtn = document.getElementById("googleLogoutBtn");

  if (ni) ni.style.display = "inline-block";
  if (sb) sb.style.display = "inline-block";
  if (gbtn) gbtn.style.display = "inline-block";
  if (logoutBtn) logoutBtn.style.display = "none";

  playerProfile.name = prevManualName || "Player";
  playerProfile.avatar = playerProfile.avatar && playerProfile.avatar.startsWith("http") ? playerProfile.avatar : null;
  updateProfile();
  saveLocalState();

  if (window.firebase && firebase.auth) {
    firebase.auth().signOut().catch(e => console.warn("firebase signOut failed", e));
  }
}
