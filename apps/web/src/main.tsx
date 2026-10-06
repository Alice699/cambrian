import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThruProvider } from "@thru/wallet/react";
import { createWalletConfig } from "@cambrian/wallet-core";
import App from "./App";
import { appConfig } from "./config";
import "./styles.css";
import "./wallet.css";
import "./feedback.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThruProvider config={createWalletConfig(appConfig)} theme="light" developerMode>
      <App />
    </ThruProvider>
  </StrictMode>,
);
