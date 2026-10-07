---
name: Nemesis AI connection
description: Product constraint for adding an AI provider to Nemesis.
---

Nemesis must remain usable offline until the user explicitly chooses an AI provider. Do not add provider credentials, API keys, or paid AI calls before that choice.

**Why:** The user asked to prepare Nemesis for an AI backend while keeping it offline and avoiding API keys or costs until the connection is chosen.

**How to apply:** Keep the default transport offline and local-only. After the user chooses a provider and authorizes its setup, connect it through workspace secrets or an approved integration; never put credentials in browser code.
