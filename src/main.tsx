import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { LoginScreen } from "./components/LoginScreen";
import { isAuthenticated, login, takeTokenFromUrl } from "./lib/auth";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

async function startApp() {
  try {
    const res = await fetch('/api/session');
    const { sessionId } = await res.json();
    if (localStorage.getItem('session_id') !== sessionId) {
      localStorage.clear();
      localStorage.setItem('session_id', sessionId);
    }
  } catch {}

  root.render(<App />);
}

// ONESTAGE_AUTH=token のときは、ログインしてから画面を表示する（ログインが無効なら、そのまま表示される）
async function init() {
  const urlToken = takeTokenFromUrl();
  if (urlToken && (await login(urlToken)).ok) return startApp();
  if (await isAuthenticated()) return startApp();
  root.render(<LoginScreen onSuccess={startApp} />);
}

init();
