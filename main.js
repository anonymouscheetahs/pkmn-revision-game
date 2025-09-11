// -----------------
// Config
// -----------------
const GOOGLE_CLIENT_ID = "398242159089-quklvo42q31ts435ejhlbtdhbpp0g1c1.apps.googleusercontent.com";
const PACKS = {
  prismatic: { name: "Prismatic Evolutions", image: "prismatic_evolutions_art.png", pool: "cards.json", background: "prismatic_bg.png" },
  twilight:  { name: "Twilight Masquerade", image: "twilight_masquerade_art.png", pool: "twilightcards.json", background: "yellow.png" },
  sv151:     { name: "Scarlet & Violet 151", image: "pokemon_151_art.png", pool: "151cards.json", background: "blue.png" }
};
const QUIZ_CATEGORIES = ['biology','chemistry','physics','math','accounting','econs'];

// -----------------
// Player Profile / Leaderboard / Market
// -----------------
let playerProfile = {
  name: "Player",
  coins: 500,
  packsOpened: 0,
  quizScore: 0,
  collection: { prismatic: new Set(), twilight: new Set(), sv151: new Set() }, // unique ids
  inventoryCounts: { prismatic: {}, twilight: {}, sv151: {} }, // counts per card id/name
  totalCards: 0,
  avatar: null
};

let leaderboard = [
  { name: "Ash", score: 80 },
  { name: "Misty", score: 70 },
  { name: "Brock", score: 60 },
  { name: playerProfile.name, score: playerProfile.quizScore }
];

const LS_PROFILE = "pk_profile_v1";
const LS_LEADERBOARD = "pk_leaderboard_v1";
const LS_MARKET = "pk_market_v1";

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
// Firebase init (detect if already initialized in index.html)
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
    if (lb) leaderboard = JSON.parse(lb);
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

  // avatar
  const avatarEl = document.getElementById("avatarImg");
  if (avatarEl) {
    const url = playerProfile.avatar || "default_avatar.png";
    avatarEl.style.backgroundImage = `url('${url}')`;
  }

  saveLocalState();

  // push to firestore leaderboard (best-effort)
  saveLeaderboardToFirebase(playerProfile).catch(()=>{});
}

function updateLeaderboard() {
  document.querySelectorAll("#leaderboardBox, #leaderboardBox2, .leaderboard-box").forEach(box => {
    box.innerHTML = "<h3>Leaderboard</h3>";
    leaderboard
      .sort((a,b)=>( (b.uniqueCards ?? b.score ?? 0) - (a.uniqueCards ?? a.score ?? 0) ))
      .slice(0,10)
      .forEach(e => {
        const val = e.uniqueCards ?? e.score ?? 0;
        box.innerHTML += `<p>${e.name}: ${val}</p>`;
      });
  });
}

// -----------------
// Firestore leaderboard helpers
// -----------------
async function saveLeaderboardToFirebase(profile) {
  if (!firestore || !firebaseAuth) return;
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    const uid = user.uid;
    const name = profile.name || user.displayName || "anonymous";
    const unique = getTotalUniqueCards(profile);
    await firestore.collection("leaderboard").doc(uid).set({
      uid,
      name,
      uniqueCards: unique,
      coins: Number(profile.coins || 0),
      packsOpened: Number(profile.packsOpened || 0),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    dbg("Saved leaderboard to firestore");
  } catch (e) { console.warn("saveLeaderboardToFirebase", e); }
}

async function loadLeaderboardFromFirebase(limit=50) {
  if (!firestore) return;
  try {
    const q = firestore.collection("leaderboard").orderBy("uniqueCards","desc").limit(limit);
    const snap = await q.get();
    const arr = [];
    snap.forEach(doc => arr.push(doc.data()));
    leaderboard = arr;
    updateLeaderboard();
  } catch (e) { console.warn("loadLeaderboardFromFirebase", e); }
}

// -----------------
// Helpers
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

// -----------------
// Pack opening (inventory counts tracked & saved)
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

  if (playerProfile.coins < 150) {
    alert("Not enough coins!");
    return;
  }
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
    div.style.setProperty("--t", `${i*2}px`);
    div.style.setProperty("--l", `${i*2}px`);
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

      // increment counts
      playerProfile.inventoryCounts = playerProfile.inventoryCounts || { prismatic:{}, twilight:{}, sv151:{} };
      playerProfile.inventoryCounts[key][cardId] = (playerProfile.inventoryCounts[key][cardId] || 0) + 1;

      // also add to unique set
      if (!playerProfile.collection[key]) playerProfile.collection[key] = new Set();
      playerProfile.collection[key].add(cardId);

      playerProfile.totalCards = Number(playerProfile.totalCards || 0) + 1;
      updateProfile();

      if (remainingEl) remainingEl.textContent = topIdx >= 0 ? `${topIdx + 1} cards left` : "All cards revealed!";
      if (topIdx < 0) {
        setTimeout(() => { document.getElementById("packOverlayClose")?.click(); }, 900);
      }
    }, { once: true });
  };
}

function openPack(file) { return loadPack(file); }

// -----------------
// Quiz (per-category JSON) - unchanged from earlier implementation
// -----------------
let currentQuiz = { questions: [], idx: 0, score: 0, category: null };

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
    const shuffled = qarr.slice().sort(()=>Math.random()-0.5);
    currentQuiz.questions = shuffled.slice(0, 10);
    currentQuiz.idx = 0;
    currentQuiz.score = 0;
    currentQuiz.category = cat;
    renderQuizQuestion();
  } catch (e) {
    console.error("loadQuizCategory", e);
    container.innerHTML = "<p>Failed to load questions.</p>";
  }
}

function renderQuizQuestion() {
  const container = document.getElementById("quizContainer");
  const controls = document.getElementById("quizControls");
  container.innerHTML = "";
  controls.innerHTML = "";

  const q = currentQuiz.questions[currentQuiz.idx];
  if (!q) {
    container.innerHTML = `<p>Quiz finished. Score: ${currentQuiz.score}/${currentQuiz.questions.length}</p>`;
    playerProfile.quizScore = currentQuiz.score;
    updateProfile();
    return;
  }

  const qBox = document.createElement("div");
  qBox.innerHTML = `<h3>Q${currentQuiz.idx+1}. ${q.question || "(no question text)"}</h3>`;
  const options = q.options && Array.isArray(q.options) ? q.options.slice() : [];

  if (!options.length && typeof q.answer !== "undefined") options.push(q.answer);

  for (let i = options.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  const list = document.createElement("div");
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      Array.from(list.querySelectorAll("button")).forEach(b => b.disabled = true);
      const correct = String(opt).trim() === String(q.answer).trim();
      if (correct) {
        btn.classList.add("correct");
        currentQuiz.score++;
      } else {
        btn.classList.add("wrong");
        Array.from(list.querySelectorAll("button")).forEach(b => {
          if (b.textContent.trim() === String(q.answer).trim()) b.classList.add("correct");
        });
      }
      const next = document.createElement("button");
      next.className = "primary";
      next.textContent = (currentQuiz.idx + 1 < currentQuiz.questions.length) ? "Next" : "Finish";
      next.addEventListener("click", () => {
        currentQuiz.idx++;
        renderQuizQuestion();
      });
      controls.innerHTML = `<div>Score: ${currentQuiz.score}/${currentQuiz.questions.length}</div>`;
      controls.appendChild(next);
    });
    list.appendChild(btn);
  });

  qBox.appendChild(list);
  container.appendChild(qBox);
  controls.innerHTML = `<div>Category: ${currentQuiz.category} — Question ${currentQuiz.idx+1}/${currentQuiz.questions.length}</div>`;
}

function startQuiz(category) {
  if (!category) {
    const container = document.getElementById("quizContainer");
    container.innerHTML = "<p>Select a category above to start the quiz.</p>";
    return;
  }
  loadQuizCategory(category);
}

// -----------------
// Card Dex: load pack JSON and show counts + filtering
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
      // filter logic
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
// Marketplace: local storage + Firestore sync (list from inventory enforced)
// -----------------
function loadMarketLocal() {
  try {
    const raw = localStorage.getItem(LS_MARKET);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveMarketLocal(listings) {
  localStorage.setItem(LS_MARKET, JSON.stringify(listings));
}

async function createMarketListing(packKey, cardName, price, fromInventory=false) {
  if (!cardName || !price) return alert("Card name and price required.");
  // If listing from inventory: require ownership
  if (fromInventory) {
    const count = (playerProfile.inventoryCounts && playerProfile.inventoryCounts[packKey] && playerProfile.inventoryCounts[packKey][cardName]) ? playerProfile.inventoryCounts[packKey][cardName] : 0;
    if (count <= 0) return alert("You don't own any copy of that card to list.");
    // decrement immediately (reserve)
    playerProfile.inventoryCounts[packKey][cardName] = count - 1;
    // if count becomes zero, keep the key with 0
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
    reserved: !!fromInventory // mark reserved so we can restore if cancelled
  };

  // store locally
  const local = loadMarketLocal();
  local.push(listing);
  saveMarketLocal(local);

  // push to firestore if available
  if (firestore) {
    try {
      await firestore.collection("marketplace").doc(listing.id).set(listing);
    } catch (e) { console.warn("Failed to save listing to firestore", e); }
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
  // find listing (local or firestore)
  let listing = null;
  // check local first
  let local = loadMarketLocal();
  const li = local.find(l => l.id === listingId);
  if (li) listing = li;
  // delete in firestore if present
  if (firestore) {
    try {
      await firestore.collection("marketplace").doc(listingId).delete();
    } catch (e) { /* ignore if not found */ }
  }
  // always remove from local store too
  local = local.filter(l => l.id !== listingId);
  saveMarketLocal(local);

  // if this listing reserved a seller card and this client is the seller, restore inventory
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
    // seller trying to buy their own listing -> treat as cancel
    return cancelListing(listingId);
  }
  if (playerProfile.coins < ls.price) return alert("Not enough coins.");
  // transfer coin from buyer
  playerProfile.coins -= ls.price;
  // buyer receives the card (1 copy)
  playerProfile.inventoryCounts = playerProfile.inventoryCounts || { prismatic:{}, twilight:{}, sv151:{} };
  playerProfile.inventoryCounts[ls.pack][ls.cardName] = (playerProfile.inventoryCounts[ls.pack][ls.cardName] || 0) + 1;
  playerProfile.totalCards = Number(playerProfile.totalCards || 0) + 1;

  // remove listing from stores
  if (firestore) {
    try {
      await firestore.collection("marketplace").doc(listingId).delete();
    } catch (e) { console.warn("Failed to delete listing from firestore", e); }
  } else {
    const local = loadMarketLocal().filter(l => l.id !== listingId);
    saveMarketLocal(local);
  }

  // Optionally credit seller — for now we do **not** automatically credit seller's local coins unless you want that behaviour.
  // (If you want seller credited, we can implement a Firestore update to their profile doc when seller exists.)

  updateProfile();
  renderMarketListings();
  alert("Purchase successful!");
}

async function renderMarketListings() {
  const container = document.getElementById("marketListings");
  container.innerHTML = "<p>Loading market...</p>";
  const listings = await fetchMarketListings();
  container.innerHTML = "";
  if (!listings.length) {
    container.innerHTML = "<p>No listings currently.</p>"; return;
  }
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
    meta.innerHTML = `<div style="font-weight:700">${l.cardName}</div>
                      <div style="font-size:13px;color:#666">${l.sellerName} • ${l.pack} ${l.reserved ? '• (from inventory)' : ''}</div>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const price = document.createElement("div");
    price.style.fontWeight = "700";
    price.textContent = `${l.price} coins`;
    const buyBtn = document.createElement("button");
    buyBtn.className = "primary";

    // decide whether currently signed in user is the seller
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
// Wire up UI controls: quiz categories, profile save, carddex filter, bazaar form
// -----------------
function wireUI() {
  // quiz category buttons
  document.querySelectorAll(".quiz-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat;
      startQuiz(cat);
    });
  });

  // menu buttons
  document.querySelectorAll('#sidebar button[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      showSection(btn.dataset.section);
      if (btn.dataset.section === "carddex") renderCardDex();
      if (btn.dataset.section === "bazaar") renderMarketListings();
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
        // if firebase auth present, update profile there too
        if (window.firebase && firebase.auth && firebase.auth().currentUser) {
          try {
            firebase.auth().currentUser.updateProfile({ displayName: v }).catch(()=>{});
          } catch(e){/* ignore */ }
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
// show section helper
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
  if (firestore && firebase.auth) {
    firebaseAuth = firebase.auth();
    firebaseAuth.onAuthStateChanged(u => {
      if (u) {
        dbg("User signed in:", u.uid);
        // optionally auto-load leaderboard
        loadLeaderboardFromFirebase().catch(()=>{});
      }
    });
  }
  renderPackLauncher();
  updateProfile();
  updateLeaderboard();
  showSection("home");
  wireUI();

  // show placeholder for quiz
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
    } else {
      dbg("Google Identity SDK not loaded (yet)");
    }
  } catch (e) { console.warn("Google init error", e); }

  document.getElementById("googleLogoutBtn")?.addEventListener("click", handleGoogleLogout);
  document.getElementById("menu-btn")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("active");
    document.getElementById("overlay")?.classList.toggle("active");
  });
  document.getElementById("overlay")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.remove("active");
    document.getElementById("overlay")?.classList.remove("active");
  });
});

// -----------------
// Google sign-in handlers (update: prompt for display name & save)
// -----------------
let prevManualName = null;

function handleGoogleLogin(response) {
  try {
    if (!response || !response.credential) {
      console.warn("handleGoogleLogin: no credential present", response);
      return;
    }
    const data = jwt_decode(response.credential);
    dbg("Google user:", data);

    prevManualName = playerProfile.name || "Player";

    // default name from Google
    const googleName = data.name || prevManualName || "Player";

    // ask user to confirm/choose display name
    const chosen = window.prompt("Choose your display name (this will be saved):", googleName);
    const finalName = (chosen && chosen.trim()) ? chosen.trim() : googleName;

    playerProfile.name = finalName;
    if (data.picture) playerProfile.avatar = data.picture;

    // hide manual name input & save button (we'll still allow editing via profile page if desired)
    const ni = document.getElementById("playerNameInput");
    const sb = document.getElementById("saveNameBtn");
    if (ni) ni.style.display = "none";
    if (sb) sb.style.display = "none";

    // hide google button and show logout
    const gbtn = document.getElementById("gsiButton");
    if (gbtn) gbtn.style.display = "none";
    const logoutBtn = document.getElementById("googleLogoutBtn");
    if (logoutBtn) logoutBtn.style.display = "inline-block";

    // sign into firebase if compat auth exists (this lets Firestore actions be tied to user)
    if (window.firebase && firebase.auth) {
      const cred = firebase.auth.GoogleAuthProvider.credential(response.credential);
      firebase.auth().signInWithCredential(cred)
        .then(userCred => {
          dbg("Signed into Firebase as:", userCred.user.uid);
          // update firebase user displayName if different
          try {
            if (firebase.auth().currentUser && firebase.auth().currentUser.updateProfile) {
              firebase.auth().currentUser.updateProfile({ displayName: finalName }).catch(()=>{});
            }
          } catch(e){}
          // attach firestore/auth instances now that we're signed in
          initFirebase();
          updateProfile();
        })
        .catch(err => {
          console.warn("Firebase sign-in failed", err);
          updateProfile();
        });
    } else {
      updateProfile();
    }

    saveLocalState();
    alert(`Welcome, ${playerProfile.name}!`);
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
