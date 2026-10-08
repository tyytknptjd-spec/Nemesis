---
name: Nemesis AI connection
description: Product constraint for adding an AI provider to Nemesis.
---

Nemesis uses the user's selected Google Gemini Developer API directly through `generateContent` with the Gemini 3.8 Flash model. Keep `GEMINI_API_KEY` in Replit Secrets and server-side only. The user selected Google's free tier; do not silently move the app to paid usage.

**Why:** The user switched Nemesis from OpenAI to Google Gemini and selected the free tier after reviewing Google's pricing and data-use terms.

**How to apply:** Keep Gemini calls on the API server, never expose the key in browser code or logs, and keep local chat history and interface behavior intact. Free-tier conversation data may be used by Google to improve products.
