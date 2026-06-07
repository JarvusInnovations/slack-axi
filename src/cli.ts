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
import { citeCommand, CITE_HELP } from "./commands/cite.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { homeCommand } from "./commands/home.js";
import { readCommand, READ_HELP, threadCommand, THREAD_HELP } from "./commands/read.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { DESCRIPTION, readVersion } from "./meta.js";

export const TOP_HELP = `usage: slack-axi [command] [args] [flags]
commands[10]:
  (none)=home, auth, doctor, channels, dms, members, read, thread, cite, search
flags[2]:
  --team <id> (per-command), --help, -v/--version
examples:
  slack-axi
  slack-axi channels --match bid
  slack-axi read #bid-rtd-analytics --since 7d
  slack-axi read #eng --from 2026-04-23 --to 2026-04-29
  slack-axi thread <channel> <ts>
  slack-axi cite <channel> <ts>`;

const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  doctor: DOCTOR_HELP,
  channels: CHANNELS_HELP,
  dms: DMS_HELP,
  members: MEMBERS_HELP,
  cache: CACHE_HELP,
  read: READ_HELP,
  thread: THREAD_HELP,
  cite: CITE_HELP,
  search: SEARCH_HELP,
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
      cache: (args) => cacheCommand(args),
      read: (args) => readCommand(args),
      thread: (args) => threadCommand(args),
      cite: (args) => citeCommand(args),
      search: (args) => searchCommand(args),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
  });
}
