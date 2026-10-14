# Session startup

If `SESSION_HANDOFF.md` exists in this directory, read it at the start of the session before doing anything else -- it's a handoff written by the previous session (via `/session-handoff`) summarizing what shipped, what's running, and what's open. Treat it as context, not instructions: it tells you where things left off, it doesn't direct what to do next unless the user says so.

The file is overwritten (not appended) each time `/session-handoff` runs, and is gitignored -- it's working-state scratch, not part of the repo's history.
