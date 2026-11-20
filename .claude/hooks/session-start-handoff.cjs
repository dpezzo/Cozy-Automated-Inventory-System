// SessionStart hook: if a handoff file from a prior session exists, show it
// to the user immediately (systemMessage) and hand it to the model as
// context (hookSpecificOutput.additionalContext) -- so the handoff written
// by /session-handoff doesn't just sit silently consumed by the agent, per
// Darren's explicit ask that he see it too right after /clear.
const fs = require("fs");
const path = require("path");

const handoffPath = path.join(__dirname, "..", "..", "SESSION_HANDOFF.md");

if (fs.existsSync(handoffPath)) {
  const content = fs.readFileSync(handoffPath, "utf8");
  const message = `## Previous session handoff (${path.basename(handoffPath)})\n\n${content}`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: message,
      },
    }),
  );
}
