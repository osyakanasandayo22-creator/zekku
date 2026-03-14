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
const readyVersusDisplay = document.getElementById("ready-versus-display");
const myReadyState = document.getElementById("my-ready-state");
const opponentReadyState = document.getElementById("opponent-ready-state");
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

// ===== 状態 =====
let currentUserName = "";
let currentMatchId = null;
let currentIsPlayer1 = null;
let matchUnsubscribe = null;
let timerIntervalId = null;
let currentMode = "gogon-zekku";
let battleReady = false;
let hasSentReady = false;
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
  hasSentReady = false;
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

// ===== Firestore: マッチング処理 =====
async function findOrCreateMatch(userName) {
  const matchesRef = collection(db, "matches");

  // 1. 「今」待機している相手を探す（古い待機は無視して新規バトル扱い）
  const waitingQuery = query(matchesRef, where("status", "==", "waiting"));
  const waitingSnap = await getDocs(waitingQuery);

  if (!waitingSnap.empty) {
    const nowMs = Date.now();
    const MAX_WAIT_MS = 60 * 1000; // 60秒より古い待機は無効とみなす

    for (const d of waitingSnap.docs) {
      const data = d.data();
      const createdAt = data.createdAt;

      // createdAt が無い／変な場合はスキップ
      if (!createdAt || typeof createdAt.toMillis !== "function") {
        continue;
      }

      const createdMs = createdAt.toMillis();
      if (nowMs - createdMs > MAX_WAIT_MS) {
        // 古い待機は finished にしてスキップ（ゴースト対戦の原因になるため）
        const staleRef = doc(db, "matches", d.id);
        updateDoc(staleRef, { status: "finished", finishedAt: serverTimestamp() }).catch(
          () => {}
        );
        continue;
      }

      // 有効な待機相手が見つかった → そのバトルに参加
      const matchRef = doc(db, "matches", d.id);
      await updateDoc(matchRef, {
        status: "ongoing",
        player2Name: userName,
        matchedAt: serverTimestamp()
      });

      return { matchId: d.id, isPlayer1: false };
    }
  }

  // 2. 誰もいない → 自分が先に待つ
  const newMatch = await addDoc(matchesRef, {
    status: "waiting",
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
    if (readyVersusDisplay) readyVersusDisplay.textContent = vsText;

    // 準備状態
    const p1Ready = !!data.player1Ready;
    const p2Ready = !!data.player2Ready;
    const bothReady = p1Ready && p2Ready;
    const alreadyStarted = !!data.battleStarted;

    // 準備画面用：自分・相手の準備状態表示
    if (myReadyState) {
      myReadyState.textContent = isPlayer1
        ? `あなた: ${p1Ready ? "準備OK済み" : "準備中"}`
        : `あなた: ${p2Ready ? "準備OK済み" : "準備中"}`;
    }
    if (opponentReadyState) {
      opponentReadyState.textContent = isPlayer1
        ? `相手: ${p2Ready ? "準備OK済み" : "準備中"}`
        : `相手: ${p1Ready ? "準備OK済み" : "準備中"}`;
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
          readyButton.disabled = hasSentReady;
          readyButton.textContent = hasSentReady ? "準備OK済み" : "準備OK";
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

    // 両方の作品が揃ったら鑑賞画面へ
    if (myPoem && opponentPoem && data.status !== "finished") {
      showResult();
      // ついでにステータスを finished にしておく
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
  let name = (currentUserName || "").trim();
  if (!name) {
    const input = prompt("ハンドルネームを入力してください（例：李白、芭蕉 など）", "");
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
  hasSentReady = false;
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

// 準備画面で「マッチングをやめる」
if (readyCancelButton) {
  readyCancelButton.addEventListener("click", async () => {
    if (currentMatchId) {
      try {
        const matchRef = doc(db, "matches", currentMatchId);
        await updateDoc(matchRef, { status: "finished", finishedAt: serverTimestamp() });
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
    if (!currentMatchId || currentIsPlayer1 === null || hasSentReady) return;
    hasSentReady = true;
    readyButton.disabled = true;
    readyButton.textContent = "準備OK済み";

    try {
      const matchRef = doc(db, "matches", currentMatchId);
      const field = currentIsPlayer1 ? "player1Ready" : "player2Ready";
      await updateDoc(matchRef, { [field]: true });
    } catch (e) {
      console.error(e);
      alert("準備OKの送信に失敗しました。もう一度お試しください。");
      hasSentReady = false;
      readyButton.disabled = false;
      readyButton.textContent = "準備OK";
    }
  });
}
