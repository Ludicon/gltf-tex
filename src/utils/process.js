import { spawn, } from "node:child_process";

/**
 * Run a command and return the output
 * @param {string} cmd - Command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Options for spawn
 * @returns {Promise<{out: string, err: string}>}
 */
export function run(cmd, args, { cwd, } = {},) {
  return new Promise((resolve, reject,) => {
    const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe",], },);
    let out = "";
    let err = "";
    p.stdout.on("data", (d,) => (out += d.toString()),);
    p.stderr.on("data", (d,) => (err += d.toString()),);
    p.on("error", reject,);
    p.on("close", (code,) => {
      if (code === 0) {
        resolve({ out, err, },);
      } else {
        reject(new Error(`${cmd} ${args.join(" ",)} failed (code ${code})\n${err || out}`,),);
      }
    },);
  },);
}
