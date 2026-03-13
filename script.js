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
const battleView = document.getElementById("battle-view");
const resultView = document.getElementById("result-view");

const battleStatusText = document.querySelector(".battle-status-text");
const timerDisplay = document.getElementById("timer-display");
const versusDisplay = document.getElementById("versus-display");

const poemInput = document.getElementById("poem-input");
const poemSendButton = document.getElementById("poem-send-button");
const battleHelperText = document.getElementById("battle-helper-text");

const myPoemDisplay = document.getElementById("my-poem-display");
const opponentPoemDisplay = document.getElementById("opponent-poem-display");
const backToHomeButton = document.getElementById("back-to-home-button");

// ===== 状態 =====
let currentUserName = "";
let currentMatchId = null;
let currentIsPlayer1 = null;
let matchUnsubscribe = null;
let timerIntervalId = null;
let currentMode = "gogon-zekku";

// ===== ユーザー名の保存／読み込み =====
function loadUserName() {
  const saved = localStorage.getItem("battleUserName") || "";
  currentUserName = saved;
}

function saveUserName(name) {
  localStorage.setItem("battleUserName", name);
}

loadUserName();

// ===== 画面切り替えヘルパー =====
function showHome() {
  homeView.style.display = "block";
  battleView.style.display = "none";
  resultView.style.display = "none";

  battleView.classList.remove("active");
  resultView.classList.remove("active");

  stopTimer();
  cleanupMatchListener();
  currentMatchId = null;
  currentIsPlayer1 = null;
  poemInput.value = "";
  poemInput.disabled = false;
  poemSendButton.disabled = false;
  battleHelperText.textContent =
    "5分以内に送信してください。送信後は内容を編集できません。";
}

function showBattle() {
  homeView.style.display = "none";
  battleView.style.display = "block";
  resultView.style.display = "none";

  battleView.classList.add("active");
  resultView.classList.remove("active");
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
  // 入力中も使えるように、改行と漢字以外を取り除く（半角/全角空白や句読点など）
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

// 入力中は漢字と改行以外を自動で除去
poemInput.addEventListener("input", () => {
  const caret = poemInput.selectionStart;
  const normalized = normalizePoemText(poemInput.value);
  if (normalized !== poemInput.value) {
    poemInput.value = normalized;
    // ざっくり元の位置付近に戻す
    poemInput.selectionStart = poemInput.selectionEnd = Math.max(0, caret - 1);
  }
});

// ===== Firestore: マッチング処理 =====
async function findOrCreateMatch(userName) {
  const matchesRef = collection(db, "matches");

  // 1. 待機中の相手を探す
  const waitingQuery = query(matchesRef, where("status", "==", "waiting"));
  const waitingSnap = await getDocs(waitingQuery);

  if (!waitingSnap.empty) {
    // 既に待っている人がいる → そのバトルに参加
    const matchDoc = waitingSnap.docs[0];
    const matchRef = doc(db, "matches", matchDoc.id);

    await updateDoc(matchRef, {
      status: "ongoing",
      player2Name: userName,
      matchedAt: serverTimestamp()
    });

    return { matchId: matchDoc.id, isPlayer1: false };
  }

  // 2. 誰もいない → 自分が先に待つ
  const newMatch = await addDoc(matchesRef, {
    status: "waiting",
    player1Name: userName,
    player2Name: null,
    player1Poem: null,
    player2Poem: null,
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

    // VS 表示
    const meName = isPlayer1 ? data.player1Name : data.player2Name;
    const otherName = isPlayer1 ? data.player2Name : data.player1Name;
    const opponentLabel = otherName || "？？？";
    versusDisplay.textContent = `${meName || "あなた"} vs ${opponentLabel}`;

    // ステータス文
    if (data.status === "waiting") {
      battleStatusText.textContent = "対戦相手を探しています…";
    } else if (data.status === "ongoing") {
      battleStatusText.textContent = "対戦相手が見つかりました。五言絶句を詠みましょう。";
    } else if (data.status === "finished") {
      battleStatusText.textContent = "バトル終了";
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

  try {
    showBattle();
    battleStatusText.textContent = "対戦相手を探しています…";
    timerDisplay.textContent = "05:00";

    const { matchId, isPlayer1 } = await findOrCreateMatch(currentUserName);
    currentMatchId = matchId;
    currentIsPlayer1 = isPlayer1;

    listenMatch(matchId, isPlayer1);
    startTimer(5);
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
