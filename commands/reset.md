---
description: Clear a leftover deepseek-coder run marker so the planner can edit files again
---

From the project root:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-marker.js" status` and show the user what it prints.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-marker.js" stop`.
3. Tell the user the marker is cleared and that any unfinished run's spec files are still in `.deepseek-coder/plans/`.
