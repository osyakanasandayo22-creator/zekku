import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  updateDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { STROKE_COUNT } from "./stroke-data.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHgCqCGhd5RWqZ89-v9l-9-ac7rP3P5-4",
  authDomain: "zekku-5ed59.firebaseapp.com",
  projectId: "zekku-5ed59",
  storageBucket: "zekku-5ed59.firebasestorage.app",
  messagingSenderId: "106862283104",
  appId: "1:106862283104:web:6c1f7203b11517fe70f605",
  measurementId: "G-W9WMKKJY1Q"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-northeast1");

const homeView = document.getElementById("home-view");
const composeView = document.getElementById("compose-view");
const marketView = document.getElementById("market-view");
const chargeView = document.getElementById("charge-view");

const navTimelineButton = document.getElementById("nav-timeline-button");
const navComposeButton = document.getElementById("nav-compose-button");
const navMarketButton = document.getElementById("nav-market-button");
const chargeButton = document.getElementById("charge-button");
const chargeBackButton = document.getElementById("charge-back-button");

const poemInput = document.getElementById("poem-input");
const poemSendButton = document.getElementById("poem-send-button");
const battleHelperText = document.getElementById("battle-helper-text");
const strokeGrid = document.getElementById("stroke-grid");

const timelineStatusText = document.getElementById("timeline-status-text");
const timelineList = document.getElementById("timeline-list");
const marketList = document.getElementById("market-list");
const marketPagination = document.getElementById("market-pagination");

const loginButton = document.getElementById("login-button");
const profileButton = document.getElementById("profile-button");
const profileButtonName = document.getElementById("profile-button-name");
const profileMenu = document.getElementById("profile-menu");
const profileMenuName = document.getElementById("profile-menu-name");
const logoutMenuButton = document.getElementById("logout-menu-button");
const strokeAssetValueEl = document.getElementById("stroke-asset-value");
const searchInput = document.querySelector(".topbar-search-input");
const searchButton = document.querySelector(".topbar-search-button");

const DEFAULT_STROKE_ASSET = 500;
const BASE_POST_FEE = 10;
const STROKE_ASSET_KEY = "strokeAsset";

let strokeAssetCache = null;
let currentUserName = localStorage.getItem("battleUserName") || "";
let currentUser = null;
let isComposingPoem = false;
let postsCache = [];
let marketStatsMap = new Map();
let userHoldingsMap = new Map();
let marketSearchTerm = "";
let timelineSearchTerm = "";
let marketPage = 1;
const MARKET_PAGE_SIZE = 24;
const localViewCounted = new Set();

const applyPostUsage = httpsCallable(functions, "applyPostUsage");
const tradeKanji = httpsCallable(functions, "tradeKanji");
const recordPostView = httpsCallable(functions, "recordPostView");

function getCallableErrorMessage(e, fallback) {
  const code = e?.code || "";
  const message = e?.message || "";
  if (code.includes("functions/not-found")) {
    return "Cloud Functions が未デプロイです。`firebase deploy --only functions` を実行してください。";
  }
  if (code.includes("unauthenticated")) {
    return "ログインが必要です。";
  }
  if (code.includes("permission-denied")) {
    return "権限エラーです。Firestore ルールを確認してください。";
  }
  if (code.includes("unavailable")) {
    return "サーバーに接続できません。時間をおいて再試行してください。";
  }
  return message || fallback;
}

function getStrokeAsset() {
  if (auth.currentUser && strokeAssetCache !== null) return strokeAssetCache;
  if (auth.currentUser) return DEFAULT_STROKE_ASSET;
  const saved = localStorage.getItem(STROKE_ASSET_KEY);
  if (!saved) return DEFAULT_STROKE_ASSET;
  const n = parseInt(saved, 10);
  return Number.isNaN(n) ? DEFAULT_STROKE_ASSET : n;
}

async function loadStrokeAssetFromFirestore() {
  const user = auth.currentUser;
  if (!user) {
    strokeAssetCache = null;
    updateStrokeAssetDisplay();
    return;
  }
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists() && typeof snap.data().strokeAsset === "number") {
    strokeAssetCache = snap.data().strokeAsset;
  } else {
    strokeAssetCache = DEFAULT_STROKE_ASSET;
    await setDoc(userRef, { strokeAsset: DEFAULT_STROKE_ASSET }, { merge: true });
  }
  updateStrokeAssetDisplay();
}

function setStrokeAsset(value) {
  const n = Math.max(0, Math.floor(value));
  if (auth.currentUser) {
    strokeAssetCache = n;
    const userRef = doc(db, "users", auth.currentUser.uid);
    updateDoc(userRef, { strokeAsset: n }).catch((e) => console.error(e));
  } else {
    localStorage.setItem(STROKE_ASSET_KEY, String(n));
  }
  updateStrokeAssetDisplay();
}

function updateStrokeAssetDisplay() {
  if (strokeAssetValueEl) strokeAssetValueEl.textContent = getStrokeAsset().toLocaleString();
}

function setActiveTopbar(target) {
  const items = [navTimelineButton, navComposeButton, navMarketButton, chargeButton];
  for (const item of items) {
    if (!item) continue;
    item.classList.toggle("active", item === target);
  }
}

function showTimelineView() {
  homeView.style.display = "block";
  composeView.style.display = "none";
  marketView.style.display = "none";
  chargeView.style.display = "none";
  homeView.classList.add("active");
  composeView.classList.remove("active");
  marketView.classList.remove("active");
  setActiveTopbar(navTimelineButton);
}

function showComposeView() {
  homeView.style.display = "none";
  composeView.style.display = "block";
  marketView.style.display = "none";
  chargeView.style.display = "none";
  homeView.classList.remove("active");
  composeView.classList.add("active");
  marketView.classList.remove("active");
  setActiveTopbar(navComposeButton);
}

function showMarketView() {
  homeView.style.display = "none";
  composeView.style.display = "none";
  marketView.style.display = "block";
  chargeView.style.display = "none";
  homeView.classList.remove("active");
  marketView.classList.add("active");
  composeView.classList.remove("active");
  setActiveTopbar(navMarketButton);
  renderMarket();
}

function showChargeView() {
  homeView.style.display = "none";
  composeView.style.display = "none";
  marketView.style.display = "none";
  chargeView.style.display = "flex";
  homeView.classList.remove("active");
  marketView.classList.remove("active");
  composeView.classList.remove("active");
  setActiveTopbar(chargeButton);
}

function formatPoemInput() {
  if (!poemInput) return;
  const raw = poemInput.value;
  const kanjiOnly = raw.replace(/[^\u4E00-\u9FFF]/g, "");
  const limited = kanjiOnly.slice(0, 20);
  let formatted = "";
  for (let i = 0; i < limited.length; i += 1) {
    formatted += limited[i];
    if ((i + 1) % 5 === 0 && i !== limited.length - 1) {
      formatted += "\n";
    }
  }
  if (poemInput.value !== formatted) {
    poemInput.value = formatted;
    poemInput.selectionStart = poemInput.selectionEnd = formatted.length;
  }
}

function getPoemCharsInOrder() {
  if (!poemInput) return [];
  return poemInput.value.replace(/[^\u4E00-\u9FFF]/g, "").split("").slice(0, 20);
}

function updateStrokeGrid() {
  if (!strokeGrid) return;
  const cells = strokeGrid.querySelectorAll(".stroke-grid-cell");
  const chars = getPoemCharsInOrder();
  for (let i = 0; i < 20; i += 1) {
    const cellIndex = (i % 5) * 4 + (3 - Math.floor(i / 5));
    const cell = cells[cellIndex];
    if (!cell) continue;
    const char = chars[i];
    if (!char) {
      cell.textContent = "";
      cell.classList.remove("filled", "unknown");
      continue;
    }
    const count = STROKE_COUNT[char];
    if (count !== undefined) {
      cell.textContent = count;
      cell.classList.add("filled");
      cell.classList.remove("unknown");
    } else {
      cell.textContent = "?";
      cell.classList.add("filled", "unknown");
    }
  }
}

function normalizePoemText(raw) {
  return raw.replace(/[^\u4E00-\u9FFF\n]/g, "");
}

function validateGogonZekku(poem) {
  const lines = poem
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 4) {
    return { ok: false, message: `五言絶句は4行で入力してください。（現在 ${lines.length} 行）` };
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length !== 5) return { ok: false, message: `第${i + 1}行は5字にしてください。` };
    if (!/^[\u4E00-\u9FFF]+$/.test(line)) return { ok: false, message: `第${i + 1}行に漢字以外が含まれています。` };
  }
  return { ok: true, message: "" };
}

function getPoemStrokeTotal(poemText) {
  const chars = poemText.replace(/[^\u4E00-\u9FFF]/g, "").split("");
  let total = 0;
  for (const char of chars) {
    const n = STROKE_COUNT[char];
    if (n !== undefined) total += n;
  }
  return total;
}

function uniqueChars(poemText) {
  return [...new Set(poemText.replace(/[^\u4E00-\u9FFF]/g, "").split(""))];
}

function buildTimelineStrokeGridHTML(poemText) {
  const chars = poemText.replace(/[^\u4E00-\u9FFF]/g, "").split("").slice(0, 20);
  const values = new Array(20).fill("");
  for (let i = 0; i < 20; i += 1) {
    const char = chars[i];
    if (!char) continue;
    const cellIndex = (i % 5) * 4 + (3 - Math.floor(i / 5));
    const count = STROKE_COUNT[char];
    values[cellIndex] = count !== undefined ? String(count) : "?";
  }
  return values
    .map((v) => `<div class="timeline-stroke-cell${v ? " filled" : ""}${v === "?" ? " unknown" : ""}">${v}</div>`)
    .join("");
}

async function submitPost() {
  if (!auth.currentUser) {
    alert("投稿するにはログインしてください。");
    return;
  }
  const text = normalizePoemText(poemInput.value).trim();
  if (!text) {
    alert("五言絶句を入力してください。");
    return;
  }
  const { ok, message } = validateGogonZekku(text);
  if (!ok) {
    alert(message);
    return;
  }
  const poemStrokes = getPoemStrokeTotal(text);
  const totalCost = BASE_POST_FEE + poemStrokes;
  if (getStrokeAsset() < totalCost) {
    alert(`画数資産が不足しています。必要: ${totalCost} / 保有: ${getStrokeAsset()}`);
    return;
  }

  poemSendButton.disabled = true;
  try {
    const authorName = currentUserName || auth.currentUser.displayName || auth.currentUser.email || "ゲスト";
    await addDoc(collection(db, "posts"), {
      text,
      uid: auth.currentUser.uid,
      authorName,
      poemStrokeTotal: poemStrokes,
      baseFee: BASE_POST_FEE,
      totalCost,
      createdAt: serverTimestamp()
    });
    setStrokeAsset(getStrokeAsset() - totalCost);
    try {
      await applyPostUsage({ chars: text.replace(/[^\u4E00-\u9FFF]/g, "").split("") });
    } catch (usageErr) {
      console.error("applyPostUsage failed", usageErr);
      battleHelperText.textContent =
        `投稿は完了しました。市場反映が遅れています。(${getCallableErrorMessage(
          usageErr,
          "後で自動反映されます"
        )})`;
    }

    poemInput.value = "";
    updateStrokeGrid();
    if (!battleHelperText.textContent.includes("市場反映が遅れています")) {
      battleHelperText.textContent = `投稿しました。コスト ${totalCost} 画数資産（固定 ${BASE_POST_FEE} + 作品 ${poemStrokes}）`;
    }
  } catch (e) {
    console.error(e);
    alert(getCallableErrorMessage(e, "投稿に失敗しました。"));
  } finally {
    poemSendButton.disabled = false;
  }
}

function renderTimeline() {
  if (!timelineList) return;
  timelineList.innerHTML = "";
  const filtered = timelineSearchTerm
    ? postsCache.filter((p) => {
        const t = `${p.authorName || ""}${p.text || ""}`;
        return t.includes(timelineSearchTerm);
      })
    : postsCache;

  timelineStatusText.textContent = `${filtered.length} 件表示`;
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "投稿がありません。";
    timelineList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const post of filtered) {
    const card = document.createElement("article");
    card.className = "timeline-card";
    card.dataset.postId = post.id;
    card.dataset.chars = uniqueChars(post.text || "").join("");
    const strokeGridHtml = buildTimelineStrokeGridHTML(post.text || "");
    card.innerHTML = `
      <div class="timeline-meta">
        <span>${post.authorName || "不明ユーザー"}</span>
        <span>${post.createdAtLabel || ""}</span>
      </div>
      <div class="timeline-poem-row">
        <pre class="poem-text timeline-poem-text">${post.text || ""}</pre>
        <div class="timeline-stroke-grid">${strokeGridHtml}</div>
      </div>
      <div class="timeline-footer">合計画数: ${post.poemStrokeTotal || 0}</div>
    `;
    fragment.appendChild(card);
  }
  timelineList.appendChild(fragment);
  setupViewTracking();
}

function setupViewTracking() {
  const cards = timelineList.querySelectorAll(".timeline-card");
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const postId = el.dataset.postId;
      if (!postId || localViewCounted.has(postId)) continue;
      const chars = (el.dataset.chars || "").split("").filter(Boolean);
      const timer = setTimeout(async () => {
        try {
          await recordPostView({ postId, chars, dwellMs: 3000 });
          localViewCounted.add(postId);
        } catch (e) {
          console.error(e);
        }
      }, 3000);
      el.addEventListener(
        "mouseleave",
        () => {
          clearTimeout(timer);
        },
        { once: true }
      );
    }
  }, { threshold: 0.6 });
  cards.forEach((card) => observer.observe(card));
}

function subscribeTimeline() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(80));
  onSnapshot(q, (snap) => {
    postsCache = snap.docs.map((d) => {
      const data = d.data();
      let createdAtLabel = "";
      if (data.createdAt && typeof data.createdAt.toDate === "function") {
        createdAtLabel = data.createdAt.toDate().toLocaleString("ja-JP");
      }
      return { id: d.id, ...data, createdAtLabel };
    });
    renderTimeline();
  });
}

function getBasePrice(strokes) {
  return Math.max(1, strokes);
}

function renderMarket() {
  if (!marketList || !marketPagination) return;
  const entries = Object.entries(STROKE_COUNT).map(([char, strokeCount]) => {
    const stats = marketStatsMap.get(char) || {};
    const holdingQty = userHoldingsMap.get(char) || 0;
    return {
      char,
      strokeCount,
      price: stats.price || getBasePrice(strokeCount),
      holderCount: stats.holderCount || 0,
      usageCount: stats.usageCount || 0,
      recentUsage: stats.recentUsage || 0,
      holdingQty
    };
  });

  const filtered = marketSearchTerm
    ? entries.filter((e) => e.char.includes(marketSearchTerm))
    : entries;

  filtered.sort((a, b) => {
    const aScore = a.usageCount * 2 + a.holderCount + a.recentUsage * 3;
    const bScore = b.usageCount * 2 + b.holderCount + b.recentUsage * 3;
    return bScore - aScore;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / MARKET_PAGE_SIZE));
  marketPage = Math.min(marketPage, totalPages);
  const start = (marketPage - 1) * MARKET_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + MARKET_PAGE_SIZE);

  marketList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of pageItems) {
    const card = document.createElement("article");
    card.className = "market-card";
    card.innerHTML = `
      <div class="market-head">
        <span class="market-char">${item.char}</span>
        <span class="market-price">${Math.floor(item.price)} 画数資産</span>
      </div>
      <div class="market-meta">
        <span>画数: ${item.strokeCount}</span>
        <span>保有者: ${item.holderCount}</span>
        <span>使用回数: ${item.usageCount}</span>
        <span>あなたの保有: ${item.holdingQty}</span>
      </div>
      <div class="market-trade">
        <input type="number" min="1" value="1" class="trade-qty" data-char="${item.char}" />
        <button class="secondary-button buy-btn" data-char="${item.char}">購入</button>
        <button class="secondary-button sell-btn" data-char="${item.char}">売却</button>
      </div>
    `;
    fragment.appendChild(card);
  }
  marketList.appendChild(fragment);
  renderMarketPagination(totalPages);
}

function renderMarketPagination(totalPages) {
  if (!marketPagination) return;
  marketPagination.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const addPageButton = (page, label = String(page), isActive = false, isDisabled = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `page-button${isActive ? " active" : ""}`;
    button.textContent = label;
    button.disabled = isDisabled;
    button.dataset.page = String(page);
    fragment.appendChild(button);
  };

  const pages = [];
  pages.push(1);
  for (let p = marketPage - 1; p <= marketPage + 1; p += 1) {
    if (p > 1 && p < totalPages) pages.push(p);
  }
  if (totalPages > 1) pages.push(totalPages);
  const unique = [...new Set(pages)].sort((a, b) => a - b);

  addPageButton(Math.max(1, marketPage - 1), "←", false, marketPage === 1);
  let prev = 0;
  for (const p of unique) {
    if (prev !== 0 && p - prev > 1) {
      const dots = document.createElement("span");
      dots.className = "page-dots";
      dots.textContent = "...";
      fragment.appendChild(dots);
    }
    addPageButton(p, String(p), p === marketPage, false);
    prev = p;
  }
  addPageButton(Math.min(totalPages, marketPage + 1), "→", false, marketPage === totalPages);
  marketPagination.appendChild(fragment);
}

async function handleTrade(action, char) {
  if (!auth.currentUser) {
    alert("売買にはログインが必要です。");
    return;
  }
  const input = marketList.querySelector(`.trade-qty[data-char="${char}"]`);
  const quantity = parseInt(input?.value || "1", 10);
  if (Number.isNaN(quantity) || quantity <= 0) {
    alert("数量は1以上で入力してください。");
    return;
  }
  try {
    const res = await tradeKanji({ action, char, quantity });
    if (res?.data?.strokeAsset !== undefined) setStrokeAsset(res.data.strokeAsset);
    if (typeof res?.data?.holdingQty === "number") userHoldingsMap.set(char, res.data.holdingQty);
    if (res?.data?.kanjiStats) marketStatsMap.set(char, res.data.kanjiStats);
    renderMarket();
  } catch (e) {
    console.error(e);
    alert(getCallableErrorMessage(e, "取引に失敗しました。"));
  }
}

function subscribeMarketStats() {
  onSnapshot(collection(db, "kanjiStats"), (snap) => {
    marketStatsMap = new Map();
    for (const d of snap.docs) {
      marketStatsMap.set(d.id, d.data());
    }
    if (marketView.style.display !== "none") renderMarket();
  });
}

function subscribeUserHoldings(uid) {
  onSnapshot(collection(db, "users", uid, "holdings"), (snap) => {
    userHoldingsMap = new Map();
    for (const d of snap.docs) {
      userHoldingsMap.set(d.id, d.data().quantity || 0);
    }
    if (marketView.style.display !== "none") renderMarket();
  });
}

function handlePaymentReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get("payment") === "success") {
    if (auth.currentUser) {
      loadStrokeAssetFromFirestore().then(() => alert("決済が完了しました。画数資産を反映しました。"));
    }
    history.replaceState(null, "", location.pathname + location.hash || "");
  } else if (params.get("payment") === "cancelled") {
    history.replaceState(null, "", location.pathname + location.hash || "");
  }
}

function attachEvents() {
  if (poemInput) {
    poemInput.addEventListener("compositionstart", () => {
      isComposingPoem = true;
    });
    poemInput.addEventListener("compositionend", () => {
      isComposingPoem = false;
      formatPoemInput();
      updateStrokeGrid();
    });
    poemInput.addEventListener("input", () => {
      if (isComposingPoem) return;
      formatPoemInput();
      updateStrokeGrid();
    });
  }

  poemSendButton?.addEventListener("click", submitPost);
  navTimelineButton?.addEventListener("click", showTimelineView);
  navComposeButton?.addEventListener("click", showComposeView);
  navMarketButton?.addEventListener("click", showMarketView);
  chargeButton?.addEventListener("click", showChargeView);
  chargeBackButton?.addEventListener("click", showComposeView);

  marketList?.addEventListener("click", (e) => {
    const buy = e.target.closest(".buy-btn");
    if (buy) {
      handleTrade("buy", buy.getAttribute("data-char"));
      return;
    }
    const sell = e.target.closest(".sell-btn");
    if (sell) {
      handleTrade("sell", sell.getAttribute("data-char"));
    }
  });
  marketPagination?.addEventListener("click", (e) => {
    const button = e.target.closest(".page-button");
    if (!button || button.disabled) return;
    const next = parseInt(button.dataset.page || "", 10);
    if (Number.isNaN(next)) return;
    marketPage = next;
    renderMarket();
  });

  const runSearch = () => {
    const term = (searchInput?.value || "").trim();
    marketSearchTerm = term;
    timelineSearchTerm = term;
    marketPage = 1;
    showMarketView();
  };
  searchButton?.addEventListener("click", runSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  if (loginButton) {
    const provider = new GoogleAuthProvider();
    loginButton.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        console.error(e);
        alert("ログインに失敗しました。");
      }
    });
  }

  profileButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    profileMenu.hidden = !profileMenu.hidden;
  });

  window.addEventListener("click", () => {
    if (profileMenu && !profileMenu.hidden) profileMenu.hidden = true;
  });

  logoutMenuButton?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      profileMenu.hidden = true;
    } catch (e) {
      console.error(e);
      alert("ログアウトに失敗しました。");
    }
  });

  const CREATE_CHECKOUT_URL = `https://asia-northeast1-${firebaseConfig.projectId}.cloudfunctions.net/createCheckoutSession`;
  document.querySelectorAll(".charge-package-buy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!auth.currentUser) {
        alert("課金するにはログインしてください。");
        return;
      }
      const packageEl = btn.closest(".charge-package");
      const strokes = parseInt(packageEl?.getAttribute("data-strokes") || "", 10);
      const priceYen = parseInt(packageEl?.getAttribute("data-price") || "", 10);
      if (!strokes || !priceYen) return;

      btn.disabled = true;
      btn.textContent = "処理中…";
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(CREATE_CHECKOUT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ data: { strokes, priceYen, baseUrl: window.location.origin } })
        });
        const json = await res.json();
        if (json.result?.url) {
          window.location.href = json.result.url;
          return;
        }
        alert("決済の開始に失敗しました。");
      } catch (e) {
        console.error(e);
        alert("決済の開始に失敗しました。");
      } finally {
        btn.disabled = false;
        btn.textContent = "購入";
      }
    });
  });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  if (user) {
    const displayName = user.displayName || user.email || "ゲスト";
    profileButtonName.textContent = displayName;
    profileMenuName.textContent = displayName;
    profileButton.hidden = false;
    loginButton.style.display = "none";
    if (!currentUserName) {
      currentUserName = displayName;
      localStorage.setItem("battleUserName", displayName);
    }
    await loadStrokeAssetFromFirestore();
    subscribeUserHoldings(user.uid);
  } else {
    strokeAssetCache = null;
    profileButton.hidden = true;
    profileMenu.hidden = true;
    loginButton.style.display = "";
    updateStrokeAssetDisplay();
    userHoldingsMap = new Map();
  }
  handlePaymentReturn();
});

showTimelineView();
updateStrokeAssetDisplay();
attachEvents();
subscribeTimeline();
subscribeMarketStats();
updateStrokeGrid();
