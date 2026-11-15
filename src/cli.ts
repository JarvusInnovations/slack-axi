import { AxiError, exitCodeForError, runAxiCli } from "axi-sdk-js";
import { audienceCommand, AUDIENCE_HELP } from "./commands/audience.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { cacheCommand, CACHE_HELP } from "./commands/cache.js";
import {
  channelsCommand,
  CHANNELS_HELP,
  dmsCommand,
  DMS_HELP,
  membersCommand,
  MEMBERS_HELP,
} from "./commands/channels.js";
import { catchupCommand, CATCHUP_HELP } from "./commands/catchup.js";
import { citeCommand, CITE_HELP } from "./commands/cite.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { downloadCommand, DOWNLOAD_HELP } from "./commands/download.js";
import { fileCommand, FILE_HELP } from "./commands/file.js";
import { homeCommand } from "./commands/home.js";
import { readCommand, READ_HELP, threadCommand, THREAD_HELP } from "./commands/read.js";
import { reactionsCommand, REACTIONS_HELP } from "./commands/reactions.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { userCommand, USER_HELP } from "./commands/user.js";
import {
  deleteCommand,
  DELETE_HELP,
  draftCommand,
  DRAFT_HELP,
  editCommand,
  EDIT_HELP,
  reactCommand,
  REACT_HELP,
} from "./commands/write.js";
import { DESCRIPTION, readVersion } from "./meta.js";
import { renderError } from "./output.js";

export const TOP_HELP = `usage: slack-axi [command] [args] [flags]
commands[21]:
  (none)=home, auth, doctor, channels, dms, members, audience, user, read, thread, cite, search, catchup, react, reactions, download, file, draft, edit, delete, setup
flags[2]:
  --team <id> (per-command), --help, -v/--version
examples:
  slack-axi channels --match proj
  slack-axi read #general --since 7d
  slack-axi audience C0123ABCD          (sharing flags + guests/external members)
  slack-axi search "token refresh" --in #eng --after 2026-05-01
  slack-axi search "contract" --files --from alice
  slack-axi catchup --from 2026-05-01 --to 2026-06-07 --every 1w --match proj
  slack-axi react #eng <ts> :eyes:
  slack-axi reactions #eng <ts>
  slack-axi download F0B8Q0DCAA3 --out ./shots
  slack-axi file F0B8Q0DCAA3       (read a snippet/text file inline)
  slack-axi draft #eng "message"   (then: slack-axi draft send <id>)
  slack-axi draft #eng "the query:" --snippet ./q.sql --file ./shot.png
  slack-axi edit #eng <ts> "corrected text"   (own message; then: slack-axi draft send <id>)
  slack-axi delete #eng <ts>                  (own message; then: slack-axi draft send <id>)`;

export const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  doctor: DOCTOR_HELP,
  channels: CHANNELS_HELP,
  dms: DMS_HELP,
  members: MEMBERS_HELP,
  audience: AUDIENCE_HELP,
  user: USER_HELP,
  cache: CACHE_HELP,
  read: READ_HELP,
  thread: THREAD_HELP,
  cite: CITE_HELP,
  search: SEARCH_HELP,
  catchup: CATCHUP_HELP,
  react: REACT_HELP,
  reactions: REACTIONS_HELP,
  download: DOWNLOAD_HELP,
  file: FILE_HELP,
  draft: DRAFT_HELP,
  edit: EDIT_HELP,
  delete: DELETE_HELP,
  setup: SETUP_HELP,
};

/**
 * Error codes that mean the invocation was wrong, not that the operation failed. These exit 2; the SDK
 * maps only its own `VALIDATION_ERROR` that way. See specs/behaviors/errors.md → Exit codes.
 */
const USAGE_CODES = new Set(["USAGE", "UNKNOWN_FLAG", "VALIDATION_ERROR"]);

/**
 * Exported (not inlined into the `runAxiCli` call) so the exit-code mapping and the INTERNAL_ERROR
 * wrap can be unit-tested. Ported from nexudus-axi `src/cli.ts`.
 */
export function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    return {
      // Written verbatim by the SDK, so the trailing newline is ours.
      output: `${renderError(error.message, error.code, error.suggestions)}\n`,
      exitCode: USAGE_CODES.has(error.code) ? 2 : exitCodeForError(error),
    };
  }

  // Never let a raw dependency error or stack trace reach stdout: an agent would read it as data.
  const message = error instanceof Error ? error.message : String(error);
  return {
    output: `${renderError(`unexpected failure: ${message}`, "INTERNAL_ERROR", [
      "Run `slack-axi doctor` to check the token, scopes and connectivity",
    ])}\n`,
    exitCode: 1,
  };
}

export async function main(
  argv: string[] = process.argv.slice(2),
  stdout?: { write: (chunk: string) => unknown },
): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: readVersion(),
    argv,
    ...(stdout ? { stdout } : {}),
    topLevelHelp: TOP_HELP,
    home: () => homeCommand(),
    commands: {
      auth: (args) => authCommand(args),
      doctor: (args) => doctorCommand(args),
      channels: (args) => channelsCommand(args),
      dms: (args) => dmsCommand(args),
      members: (args) => membersCommand(args),
      audience: (args) => audienceCommand(args),
      user: (args) => userCommand(args),
      cache: (args) => cacheCommand(args),
      read: (args) => readCommand(args),
      thread: (args) => threadCommand(args),
      cite: (args) => citeCommand(args),
      search: (args) => searchCommand(args),
      catchup: (args) => catchupCommand(args),
      react: (args) => reactCommand(args),
      reactions: (args) => reactionsCommand(args),
      download: (args) => downloadCommand(args),
      file: (args) => fileCommand(args),
      draft: (args) => draftCommand(args),
      edit: (args) => editCommand(args),
      delete: (args) => deleteCommand(args),
      setup: (args) => setupCommand(args),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    formatError,
  });
}
