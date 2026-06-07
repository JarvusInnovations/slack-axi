import { runAxiCli } from "axi-sdk-js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { doctorCommand, DOCTOR_HELP } from "./commands/doctor.js";
import { homeCommand } from "./commands/home.js";
import { DESCRIPTION, readVersion } from "./meta.js";

export const TOP_HELP = `usage: slack-axi [command] [args] [flags]
commands[3]:
  (none)=home, auth, doctor
flags[2]:
  --team <id> (per-command), --help, -v/--version
examples:
  slack-axi
  slack-axi auth setup
  slack-axi auth login --token xoxp-...
  slack-axi doctor`;

const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  doctor: DOCTOR_HELP,
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
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
  });
}
