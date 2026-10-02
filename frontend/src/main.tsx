import React from "react";
import ReactDOM from "react-dom/client";
import { Session } from "./session";
import "./index.css";
import "./motion.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Session />
  </React.StrictMode>,
);
