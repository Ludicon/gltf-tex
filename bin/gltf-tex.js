#!/usr/bin/env node
import { fileURLToPath, } from "node:url";
import { dirname, } from "node:path";

const __filename = fileURLToPath(import.meta.url,);
const __dirname = dirname(__filename,);

// Import commands
import { helpCommand, } from "../src/commands/help.js";
import { avifCommand, } from "../src/commands/avif.js";
import { blazeCommand, } from "../src/commands/blaze.js";
import { webpCommand, } from "../src/commands/webp.js";
import { sizeCommand, } from "../src/commands/size.js";
import { dedupCommand, } from "../src/commands/dedup.js";
import process from "node:process";

const commands = {
  help: helpCommand,
  avif: avifCommand,
  blaze: blazeCommand,
  webp: webpCommand,
  size: sizeCommand,
  dedup: dedupCommand,
};

async function main() {
  const args = process.argv.slice(2,);
  const commandName = args[0];

  // If no command or help command, show help
  if (!commandName || commandName === "help") {
    helpCommand(args.slice(1,),);
    return;
  }

  // Get the command
  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`,);
    console.error('Run "gltf-tex help" for usage information.',);
    process.exit(1,);
  }

  // Execute the command
  try {
    await command(args.slice(1,),);
  } catch (error) {
    console.error(`Error: ${error.message}`,);
    if (process.env.DEBUG) {
      console.error(error.stack,);
    }
    process.exit(1,);
  }
}

main().catch((error,) => {
  console.error(`Fatal error: ${error.message}`,);
  if (process.env.DEBUG) {
    console.error(error.stack,);
  }
  process.exit(1,);
},);
