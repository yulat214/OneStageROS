import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

async function init() {
  try {
    const res = await fetch(`http://${window.location.hostname}:8000/api/session`);
    const { sessionId } = await res.json();
    if (localStorage.getItem('session_id') !== sessionId) {
      localStorage.clear();
      localStorage.setItem('session_id', sessionId);
    }
  } catch {}

  createRoot(document.getElementById("root")!).render(<App />);
}

init();
