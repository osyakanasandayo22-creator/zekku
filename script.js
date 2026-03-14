import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { STROKE_COUNT } from "./stroke-data.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ===== Firebase 設定 =====
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

// ===== DOM 取得 =====
const battleButton = document.getElementById("battle-button");
const modeSelectTrigger = document.getElementById("mode-select-trigger");
const modeSelectMenu = document.getElementById("mode-select-menu");
const modeSelectedLabel = document.getElementById("mode-selected-label");

const homeView = document.getElementById("home-view");
const readyView = document.getElementById("ready-view");
const battleView = document.getElementById("battle-view");
const resultView = document.getElementById("result-view");

const readyStatusText = document.getElementById("ready-status-text");
const readyMyName = document.getElementById("ready-my-name");
const readyMyStatus = document.getElementById("ready-my-status");
const readyMyStatusArea = document.getElementById("ready-my-status-area");
const readyOpponentName = document.getElementById("ready-opponent-name");
const readyOpponentStatus = document.getElementById("ready-opponent-status");
const timerDisplay = document.getElementById("timer-display");
const versusDisplay = document.getElementById("versus-display");

const poemInput = document.getElementById("poem-input");
const poemSendButton = document.getElementById("poem-send-button");
const battleHelperText = document.getElementById("battle-helper-text");
const readyButton = document.getElementById("ready-button");
const readyCancelButton = document.getElementById("ready-cancel-button");

const myPoemDisplay = document.getElementById("my-poem-display");
const opponentPoemDisplay = document.getElementById("opponent-poem-display");
const backToHomeButton = document.getElementById("back-to-home-button");
const strokeGrid = document.getElementById("stroke-grid");
const loginButton = document.getElementById("login-button");
const profileButton = document.getElementById("profile-button");
const profileButtonName = document.getElementById("profile-button-name");
const profileMenu = document.getElementById("profile-menu");
const profileMenuName = document.getElementById("profile-menu-name");
const logoutMenuButton = document.getElementById("logout-menu-button");

// ===== 状態 =====
let currentUserName = "";
let currentUser = null;
let currentMatchId = null;
let currentIsPlayer1 = null;
let matchUnsubscribe = null;
let timerIntervalId = null;
let currentMode = "gogon-zekku";
let battleReady = false;
let currentMyReady = false; // 最新の自分の「準備OK」状態
let isComposingPoem = false;

// ===== ユーザー名の保存／読み込み =====
function loadUserName() {
  const saved = localStorage.getItem("battleUserName") || "";
  currentUserName = saved;
}

function saveUserName(name) {
  localStorage.setItem("battleUserName", name);
}

loadUserName();

// ===== ログイン状態の監視（Firebase Authentication） =====
const provider = new GoogleAuthProvider();

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;

  if (!loginButton || !profileButton || !profileButtonName || !profileMenu || !profileMenuName) {
    return;
  }

  if (user) {
    const displayName = user.displayName || user.email || "ゲスト";
    profileButtonName.textContent = displayName;
    profileMenuName.textContent = displayName;

    profileButton.hidden = false;
    loginButton.style.display = "none";

    // ハンドルネーム未設定なら、Firebase の表示名をデフォルトとして使う
    if (!currentUserName) {
      currentUserName = displayName;
      saveUserName(displayName);
    }
  } else {
    profileButton.hidden = true;
    profileMenu.hidden = true;
    loginButton.style.display = "";
  }
});

// ===== 部屋の「自分」識別用（自部屋に参加しないため） =====
const CLIENT_ID_KEY = "battleClientId";

function getOrCreateClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// ===== 入力中の自動整形（漢字のみ・4行×各5字に揃える） =====
function formatPoemInput() {
  if (!poemInput) return;
  // 漢字以外を削除し、最大20文字（4行×5字）までに制限
  const raw = poemInput.value;
  const kanjiOnly = raw.replace(/[^\u4E00-\u9FFF]/g, "");
  const maxChars = 20;
  const limited = kanjiOnly.slice(0, maxChars);

  let formatted = "";
  for (let i = 0; i < limited.length; i += 1) {
    formatted += limited[i];
    // 5文字ごとに改行を挿入（ただし末尾には不要）
    if ((i + 1) % 5 === 0 && i !== limited.length - 1) {
      formatted += "\n";
    }
  }

  if (poemInput.value !== formatted) {
    poemInput.value = formatted;
    poemInput.selectionStart = poemInput.selectionEnd = formatted.length;
  }
}

// ===== 画数グリッド更新（入力フォームの1〜20字目に対応・縦5×横4） =====
function getPoemCharsInOrder() {
  if (!poemInput) return [];
  const raw = poemInput.value.replace(/[^\u4E00-\u9FFF]/g, "");
  return raw.split("").slice(0, 20);
}

function updateStrokeGrid() {
  if (!strokeGrid) return;
  const cells = strokeGrid.querySelectorAll(".stroke-grid-cell");
  const chars = getPoemCharsInOrder();
    // 右上から縦に並べ、行が変わったら左の列の一番上から。右列=0〜4, その左=5〜9, その左=10〜14, 左列=15〜19。
    // グリッドは5行×4列で列0が左・列3が右。セルは行優先なので (row,col) = row*4+col。
    // 文字 i → 列 3-floor(i/5), 行 i%5 → cellIndex = (i%5)*4 + (3 - floor(i/5))
  for (let i = 0; i < 20; i += 1) {
    const cellIndex = (i % 5) * 4 + (3 - Math.floor(i / 5));
    const cell = cells[cellIndex];
    if (!cell) continue;
    const char = chars[i];
    if (!char) {
      cell.textContent = "";
      cell.classList.remove("filled");
      continue;
    }
    const count = STROKE_COUNT[char];
    if (count !== undefined) {
      cell.textContent = count;
      cell.classList.add("filled");
      cell.title = `${char}：${count}画`;
    } else {
      cell.textContent = "?";
      cell.classList.add("filled", "unknown");
      cell.title = `${char}：画数未登録`;
    }
  }
}

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

// ===== 画面切り替えヘルパー =====
function showHome() {
  homeView.style.display = "block";
  readyView.style.display = "none";
  battleView.style.display = "none";
  resultView.style.display = "none";

  readyView.classList.remove("active");
  battleView.classList.remove("active");
  resultView.classList.remove("active");

  stopTimer();
  cleanupMatchListener();
  currentMatchId = null;
  currentIsPlayer1 = null;
  battleReady = false;
  if (readyButton) {
    readyButton.disabled = true;
    readyButton.textContent = "準備OK";
  }
  poemInput.value = "";
  poemInput.disabled = false;
  poemSendButton.disabled = false;
  battleHelperText.textContent =
    "5分以内に送信してください。送信後は内容を編集できません。";
}

function showReadyView() {
  homeView.style.display = "none";
  readyView.style.display = "block";
  battleView.style.display = "none";
  resultView.style.display = "none";

  readyView.classList.add("active");
  battleView.classList.remove("active");
  resultView.classList.remove("active");
}

function showBattle() {
  homeView.style.display = "none";
  readyView.style.display = "none";
  battleView.style.display = "block";
  resultView.style.display = "none";

  readyView.classList.remove("active");
  battleView.classList.add("active");
  resultView.classList.remove("active");
  updateStrokeGrid();
}

function showResult() {
  homeView.style.display = "none";
  battleView.style.display = "none";
  resultView.style.display = "block";

  battleView.classList.remove("active");
  resultView.classList.add("active");
}

// 初期はホームを表示
showHome();

// ===== モード選択 UI =====
function closeModeMenu() {
  if (!modeSelectTrigger || !modeSelectMenu) return;
  modeSelectTrigger.classList.remove("open");
  modeSelectTrigger.setAttribute("aria-expanded", "false");
  modeSelectMenu.classList.remove("open");
}

if (modeSelectTrigger && modeSelectMenu) {
  modeSelectTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = modeSelectMenu.classList.contains("open");
    if (isOpen) {
      closeModeMenu();
    } else {
      modeSelectTrigger.classList.add("open");
      modeSelectTrigger.setAttribute("aria-expanded", "true");
      modeSelectMenu.classList.add("open");
    }
  });

  modeSelectMenu.addEventListener("click", (e) => {
    const option = e.target.closest(".mode-option");
    if (!option || option.classList.contains("disabled")) return;

    const label = option.getAttribute("data-label") || "";
    const mode = option.getAttribute("data-mode") || "gogon-zekku";

    currentMode = mode;
    if (modeSelectedLabel) modeSelectedLabel.textContent = label;

    closeModeMenu();
  });

  window.addEventListener("click", (e) => {
    if (!modeSelectMenu.classList.contains("open")) return;
    const inside =
      e.target === modeSelectTrigger ||
      modeSelectTrigger.contains(e.target) ||
      modeSelectMenu.contains(e.target);
    if (!inside) {
      closeModeMenu();
    }
  });
}

// ===== タイマー =====
function startTimer(minutes = 5) {
  stopTimer();
  let remaining = minutes * 60;

  const update = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    timerDisplay.textContent = `${m}:${s}`;

    if (remaining <= 0) {
      stopTimer();
      poemInput.disabled = true;
      poemSendButton.disabled = true;
      battleHelperText.textContent = "時間切れです。送信できません。";
      return;
    }
    remaining -= 1;
  };

  update();
  timerIntervalId = setInterval(update, 1000);
}

function stopTimer() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

// ===== 五言絶句バリデーション（漢字のみ・4行×各5字） =====
function normalizePoemText(raw) {
  // 送信時にだけ、漢字と改行以外を取り除く（半角/全角空白や句読点など）
  return raw.replace(/[^\u4E00-\u9FFF\n]/g, "");
}

function validateGogonZekku(poem) {
  const lines = poem
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length !== 4) {
    return { ok: false, message: "五言絶句は「4行」で構成してください。（現在 " + lines.length + " 行）" };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 1行あたりの文字数チェック（全て漢字のみになっている前提）
    if (line.length !== 5) {
      return {
        ok: false,
        message: `第 ${i + 1} 行は漢字5字にしてください。（現在 ${line.length} 字）`
      };
    }
    // 念のため、1文字ずつ漢字かどうかも検証
    if (!/^[\u4E00-\u9FFF]+$/.test(line)) {
      return {
        ok: false,
        message: `第 ${i + 1} 行に漢字以外の文字が含まれています。`
      };
    }
  }

  return { ok: true, message: "" };
}

// ===== Firestore: 部屋ベースのマッチング =====
// 部屋は最大2人。作成者を clientId で識別し、自分が作った部屋には参加しない。
async function findOrCreateMatch(userName) {
  const matchesRef = collection(db, "matches");
  const myClientId = getOrCreateClientId();

  // 1. 待機中の「他者の部屋」を探す（自分の部屋は除外・2人目として参加）
  const waitingQuery = query(matchesRef, where("status", "==", "waiting"));
  const waitingSnap = await getDocs(waitingQuery);

  const nowMs = Date.now();
  const MAX_WAIT_MS = 60 * 1000; // 60秒より古い待機部屋はキャンセル扱い

  if (!waitingSnap.empty) {
    for (const d of waitingSnap.docs) {
      const data = d.data();

      // 自分が作った部屋には絶対に入らない（戻って再マッチで自対戦を防ぐ）
      if (data.ownerClientId === myClientId) {
        continue;
      }

      const createdAt = data.createdAt;
      if (!createdAt || typeof createdAt.toMillis !== "function") {
        continue;
      }

      const createdMs = createdAt.toMillis();
      if (nowMs - createdMs > MAX_WAIT_MS) {
        // 古い待機部屋はキャンセルにして、次の部屋を探す
        const staleRef = doc(db, "matches", d.id);
        updateDoc(staleRef, { status: "cancelled", cancelledAt: serverTimestamp() }).catch(
          () => {}
        );
        continue;
      }

      // 有効な他者の部屋に2人目として参加（1部屋に2人まで）
      const matchRef = doc(db, "matches", d.id);
      await updateDoc(matchRef, {
        status: "ongoing",
        player2Name: userName,
        player2ClientId: myClientId,
        matchedAt: serverTimestamp()
      });

      return { matchId: d.id, isPlayer1: false };
    }
  }

  // 2. 入れる部屋がなければ自分が部屋を作る（1人目）
  const newMatch = await addDoc(matchesRef, {
    status: "waiting",
    ownerClientId: myClientId,
    player1Name: userName,
    player2Name: null,
    player1Poem: null,
    player2Poem: null,
    player1Ready: false,
    player2Ready: false,
    battleStarted: false,
    createdAt: serverTimestamp()
  });

  return { matchId: newMatch.id, isPlayer1: true };
}

// バトルのFirestore監視
function listenMatch(matchId, isPlayer1) {
  const matchRef = doc(db, "matches", matchId);

  if (matchUnsubscribe) {
    matchUnsubscribe();
  }

  matchUnsubscribe = onSnapshot(matchRef, (snap) => {
    if (!snap.exists()) return;

    const data = snap.data();

    // VS 表示（準備画面・対戦画面の両方で使う）
    const meName = isPlayer1 ? data.player1Name : data.player2Name;
    const otherName = isPlayer1 ? data.player2Name : data.player1Name;
    const opponentLabel = otherName || "？？？";
    const vsText = `${meName || "あなた"} vs ${opponentLabel}`;
    if (versusDisplay) versusDisplay.textContent = vsText;

    // 準備状態
    const p1Ready = !!data.player1Ready;
    const p2Ready = !!data.player2Ready;
    const bothReady = p1Ready && p2Ready;
    const alreadyStarted = !!data.battleStarted;

    // 準備画面用：自分・相手のカード（名前と準備OK状態）
    const myReady = isPlayer1 ? p1Ready : p2Ready;
    const opponentReady = isPlayer1 ? p2Ready : p1Ready;
    currentMyReady = myReady;
    if (readyMyName) readyMyName.textContent = meName || "あなた";
    if (readyMyStatus) {
      readyMyStatus.textContent = myReady ? "準備OK" : "準備中";
      readyMyStatus.setAttribute("data-ready", myReady ? "true" : "false");
    }
    if (readyMyStatusArea) {
      readyMyStatusArea.classList.toggle("my-ready", myReady);
      // waiting 中は「待っています」表示、ongoing になったらボタン／状態表示に切り替え
      readyMyStatusArea.classList.toggle("slot-waiting", data.status === "waiting");
    }
    if (readyOpponentName) readyOpponentName.textContent = opponentLabel;
    if (readyOpponentStatus) {
      readyOpponentStatus.textContent = opponentReady ? "準備OK" : "準備中";
      readyOpponentStatus.setAttribute("data-ready", opponentReady ? "true" : "false");
    }

    // ステータス文とUI制御（準備画面で表示）
    if (data.status === "waiting") {
      if (readyStatusText) readyStatusText.textContent = "対戦相手を探しています…";
      battleReady = false;
      stopTimer();
      timerDisplay.textContent = "05:00";
      poemInput.disabled = true;
      poemSendButton.disabled = true;
      battleHelperText.textContent = "対戦相手を探しています…";
      if (readyButton) {
        readyButton.disabled = true;
        readyButton.textContent = "準備OK";
      }
    } else if (data.status === "ongoing") {
      if (!bothReady) {
        if (readyStatusText) readyStatusText.textContent = "相手が揃いました。準備OKを押してください。";
        battleReady = false;
        stopTimer();
        timerDisplay.textContent = "05:00";
        poemInput.disabled = true;
        poemSendButton.disabled = true;
        battleHelperText.textContent = "両者が準備OKを押すとバトル開始します。";
        if (readyButton) {
          readyButton.disabled = false;
          readyButton.textContent = myReady ? "準備解除" : "準備OK";
        }
      } else {
        // 両者が準備完了 → 対戦画面へ遷移
        if (readyStatusText) readyStatusText.textContent = "準備完了！";
        if (!alreadyStarted) {
          updateDoc(matchRef, { battleStarted: true, startedAt: serverTimestamp() }).catch(
            () => {}
          );
        }
        if (!battleReady) {
          battleReady = true;
          showBattle();
          poemInput.disabled = false;
          poemSendButton.disabled = false;
          battleHelperText.textContent =
            "5分以内に送信してください。送信後は内容を編集できません。";
          startTimer(5);
          if (readyButton) {
            readyButton.disabled = true;
            readyButton.textContent = "準備OK";
          }
        }
      }
    } else if (data.status === "cancelled") {
      if (readyStatusText) readyStatusText.textContent = "相手が退出しました。ホームに戻ってください。";
      battleReady = false;
      stopTimer();
      poemInput.disabled = true;
      poemSendButton.disabled = true;
      if (readyButton) {
        readyButton.disabled = true;
        readyButton.textContent = "準備OK";
      }
    } else if (data.status === "finished") {
      if (readyStatusText) readyStatusText.textContent = "バトル終了";
    }

    // 自分と相手の作品を反映
    const myPoem = isPlayer1 ? data.player1Poem : data.player2Poem;
    const opponentPoem = isPlayer1 ? data.player2Poem : data.player1Poem;

    if (myPoem) {
      myPoemDisplay.textContent = myPoem;
    }
    if (opponentPoem) {
      opponentPoemDisplay.textContent = opponentPoem;
    }

    // 両方の作品が揃ったら鑑賞画面へ（試合終了時のみ finished）
    if (myPoem && opponentPoem && data.status === "ongoing") {
      showResult();
      updateDoc(matchRef, { status: "finished", finishedAt: serverTimestamp() }).catch(
        () => {}
      );
    }
  });
}

function cleanupMatchListener() {
  if (matchUnsubscribe) {
    matchUnsubscribe();
    matchUnsubscribe = null;
  }
}

// ===== イベント =====
battleButton.addEventListener("click", async () => {
  // ログイン必須
  if (!auth.currentUser) {
    alert("バトルを開始するには、右上の「ログイン」ボタンからログインしてください。");
    return;
  }

  let name = (currentUserName || "").trim();
  if (!name) {
    // Firebase の表示名／メールアドレスをデフォルトとして使う
    const user = auth.currentUser;
    const fallbackName = (user && (user.displayName || user.email)) || "";
    const input = prompt(
      "対戦で使うハンドルネームを入力してください（例：李白、芭蕉 など）",
      fallbackName
    );
    if (!input) {
      alert("ハンドルネームが必要です。");
      return;
    }
    name = input.trim();
    if (!name) {
      alert("ハンドルネームが必要です。");
      return;
    }
  }

  currentUserName = name;
  saveUserName(name);

  battleButton.disabled = true;
  battleButton.textContent = "マッチング中…";

  // 相手が見つかるまでは対戦を開始しない（入力・タイマーは停止したまま）
  poemInput.value = "";
  poemInput.disabled = true;
  poemSendButton.disabled = true;
  battleHelperText.textContent = "対戦相手を探しています…";
  stopTimer();
  timerDisplay.textContent = "05:00";
  if (readyButton) {
    readyButton.disabled = true;
    readyButton.textContent = "準備OK";
  }

  try {
    showReadyView();
    if (readyStatusText) readyStatusText.textContent = "対戦相手を探しています…";

    const { matchId, isPlayer1 } = await findOrCreateMatch(currentUserName);
    currentMatchId = matchId;
    currentIsPlayer1 = isPlayer1;

    listenMatch(matchId, isPlayer1);
  } catch (e) {
    console.error(e);
    alert("マッチングに失敗しました。時間をおいて再度お試しください。");
    showHome();
  } finally {
    battleButton.disabled = false;
    battleButton.textContent = "バトる";
  }
});

poemSendButton.addEventListener("click", async () => {
  if (!currentMatchId || currentIsPlayer1 === null) return;

  const text = normalizePoemText(poemInput.value).trim();
  if (!text) {
    alert("五言絶句を入力してください");
    return;
  }

  const { ok, message } = validateGogonZekku(text);
  if (!ok) {
    alert(message);
    return;
  }

  poemSendButton.disabled = true;
  poemInput.disabled = true;
  battleHelperText.textContent = "あなたの作品を送信しました。相手の作品を待っています…";

  try {
    const matchRef = doc(db, "matches", currentMatchId);
    const field = currentIsPlayer1 ? "player1Poem" : "player2Poem";

    await updateDoc(matchRef, {
      [field]: text
    });

    myPoemDisplay.textContent = text;
  } catch (e) {
    console.error(e);
    alert("送信に失敗しました。もう一度お試しください。");
    poemSendButton.disabled = false;
    poemInput.disabled = false;
    battleHelperText.textContent =
      "5分以内に送信してください。送信後は内容を編集できません。";
  }
});

backToHomeButton.addEventListener("click", () => {
  showHome();
});

// 準備画面で「マッチングをやめる」（部屋から退出・状態は cancelled で保存）
if (readyCancelButton) {
  readyCancelButton.addEventListener("click", async () => {
    if (currentMatchId) {
      try {
        const matchRef = doc(db, "matches", currentMatchId);
        await updateDoc(matchRef, { status: "cancelled", cancelledAt: serverTimestamp() });
      } catch (e) {
        console.error(e);
      }
    }
    cleanupMatchListener();
    currentMatchId = null;
    currentIsPlayer1 = null;
    showHome();
    battleButton.disabled = false;
    battleButton.textContent = "バトる";
  });
}

// 準備OKボタン
if (readyButton) {
  readyButton.addEventListener("click", async () => {
    if (!currentMatchId || currentIsPlayer1 === null) return;

    // 相手待ち（waiting）の間はボタンは動かさない想定だが、念のためガードしておく
    if (readyStatusText && readyStatusText.textContent.includes("探しています")) {
      return;
    }

    readyButton.disabled = true;

    try {
      const matchRef = doc(db, "matches", currentMatchId);
      const field = currentIsPlayer1 ? "player1Ready" : "player2Ready";

      // トグル動作：未準備なら true、準備済みなら false に戻す
      const next = !currentMyReady;
      await updateDoc(matchRef, { [field]: next });
    } catch (e) {
      console.error(e);
      alert("準備OKの送信に失敗しました。もう一度お試しください。");
    } finally {
      // 実際の状態・表示は onSnapshot 側で更新される
      readyButton.disabled = false;
    }
  });
}

// ログインボタン
if (loginButton) {
  loginButton.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      alert("ログインに失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// プロフィールメニュー開閉
if (profileButton && profileMenu) {
  profileButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = profileMenu.hidden;
    profileMenu.hidden = !isHidden;
  });

  window.addEventListener("click", () => {
    if (!profileMenu.hidden) {
      profileMenu.hidden = true;
    }
  });
}

// プロフィールメニュー内のログアウト
if (logoutMenuButton) {
  logoutMenuButton.addEventListener("click", async () => {
    try {
      await signOut(auth);
      if (profileMenu) profileMenu.hidden = true;
    } catch (e) {
      console.error(e);
      alert("ログアウトに失敗しました。");
    }
  });
}
