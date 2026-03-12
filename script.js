import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

const userNameForm = document.getElementById("user-name-form");
const userNameInput = document.getElementById("user-name-input");

function loadUserName() {
  const saved = localStorage.getItem("battleUserName") || "";
  userNameInput.value = saved;
  return saved;
}
function saveUserName(name) {
  localStorage.setItem("battleUserName", name);
}

let currentUserName = loadUserName();

userNameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = userNameInput.value.trim();
  if (!name) {
    alert("名前を入力してください");
    return;
  }
  currentUserName = name;
  saveUserName(name);
});

messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  if (!currentUserName) {
    alert("先に名前を保存してください");
    return;
  }

  sendButton.disabled = true;

  try {
    await addDoc(collection(db, "messages"), {
      text,
      userName: currentUserName,
      createdAt: serverTimestamp()
    });
    messageInput.value = "";
  } catch (err) {
    console.error(err);
    alert("送信に失敗しました");
  } finally {
    sendButton.disabled = false;
  }
});

const q = query(collection(db, "messages"), orderBy("createdAt", "asc"));

onSnapshot(q, (snapshot) => {
  messagesEl.innerHTML = "";

  snapshot.forEach((doc) => {
    const data = doc.data();
    const div = document.createElement("div");

    const isMe = data.userName === currentUserName;
    div.className = "message " + (isMe ? "me" : "other");

    const meta = document.createElement("div");
    meta.className = "meta";
    const time = data.createdAt?.toDate
      ? data.createdAt.toDate().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
      : "送信中...";
    meta.textContent = `${data.userName || "名無し"}・${time}`;

    const body = document.createElement("div");
    body.textContent = data.text;

    div.appendChild(meta);
    div.appendChild(body);
    messagesEl.appendChild(div);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
});

