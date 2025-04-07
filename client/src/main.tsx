// Main entry point for the application

// Import Buffer first - this must be the first import in the app
import './buffer';

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Verify Buffer is available in global scope
console.log('Buffer is available:', typeof (window as any).Buffer !== 'undefined');

// Render the app when DOM is ready
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
