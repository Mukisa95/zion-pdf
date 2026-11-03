import "./pdfjs-global";
import { createRoot } from "react-dom/client";
import App from "./Workspace";
import "./styles.css";
import "./reading-tools.css";

if (window.zionpdfDesktop) document.documentElement.classList.add("desktop", `platform-${window.zionpdfDesktop.platform}`);

// No StrictMode: the pdf.js viewer binds imperatively to its container once.
createRoot(document.getElementById("root")!).render(<App />);
