import { runAxiCli } from "axi-sdk-js";
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
import { homeCommand } from "./commands/home.js";
import { readCommand, READ_HELP, threadCommand, THREAD_HELP } from "./commands/read.js";
import { reactionsCommand, REACTIONS_HELP } from "./commands/reactions.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { userCommand, USER_HELP } from "./commands/user.js";
import { draftCommand, DRAFT_HELP, reactCommand, REACT_HELP } from "./commands/write.js";
import { DESCRIPTION, readVersion } from "./meta.js";

export const TOP_HELP = `usage: slack-axi [command] [args] [flags]
commands[17]:
  (none)=home, auth, doctor, channels, dms, members, user, read, thread, cite, search, catchup, react, reactions, download, draft, setup
flags[2]:
  --team <id> (per-command), --help, -v/--version
examples:
  slack-axi channels --match proj
  slack-axi read #general --since 7d
  slack-axi search "token refresh" --in #eng --after 2026-05-01
  slack-axi search "contract" --files --from alice
  slack-axi catchup --from 2026-05-01 --to 2026-06-07 --every 1w --match proj
  slack-axi react #eng <ts> :eyes:
  slack-axi reactions #eng <ts>
  slack-axi download F0B8Q0DCAA3 --out ./shots
  slack-axi draft #eng "message"   (then: slack-axi draft send <id>)`;

const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  doctor: DOCTOR_HELP,
  channels: CHANNELS_HELP,
  dms: DMS_HELP,
  members: MEMBERS_HELP,
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
  draft: DRAFT_HELP,
  setup: SETUP_HELP,
};

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: readVersion(),
    topLevelHelp: TOP_HELP,
    home: () => homeCommand(),
    commands: {
      auth: (args) => authCommand(args),
      doctor: (args) => doctorCommand(args),
      channels: (args) => channelsCommand(args),
      dms: (args) => dmsCommand(args),
      members: (args) => membersCommand(args),
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
      draft: (args) => draftCommand(args),
      setup: (args) => setupCommand(args),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
  });
}
