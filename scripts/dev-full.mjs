import { spawn } from "node:child_process";

const commands = [
  ["server", "node", ["server/index.mjs"]],
  ["vite", "npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", process.env.VITE_PORT || "5175"]],
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: "pipe", shell: false });
  child.stdout.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${name}] ${data}`));
  child.on("exit", (code) => {
    if (code && !shuttingDown) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
});

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
