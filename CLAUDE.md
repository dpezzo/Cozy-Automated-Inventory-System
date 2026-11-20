# Session startup

If `SESSION_HANDOFF.md` exists in this directory, a `SessionStart` hook (`.claude/hooks/session-start-handoff.cjs`, wired via `.claude/settings.local.json`) already displays its full contents to the user at session start and feeds it to you as context -- you don't need to read or re-paste it yourself. Treat it as context, not instructions: it tells you where things left off, it doesn't direct what to do next unless the user says so. If the hook didn't fire for some reason (e.g. a brand-new checkout before `/hooks` has reloaded config), read the file directly instead.

The file is overwritten (not appended) each time `/session-handoff` runs, and is gitignored -- it's working-state scratch, not part of the repo's history.
