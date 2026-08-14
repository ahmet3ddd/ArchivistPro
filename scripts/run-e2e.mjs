import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 5173;
const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);

// Playwright'in Windows webServer teardown'u `taskkill /T` ile bazi ortamlarda
// asilabiliyor. Vite'i API ile sahiplenmek sunucuyu test sonunda deterministik kapatir.
const server = await preview({
  preview: { host, port, strictPort: true },
});

const runner = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

const exitCode = await new Promise((resolve, reject) => {
  runner.once("error", reject);
  runner.once("exit", (code, signal) => {
    resolve(code ?? (signal ? 1 : 0));
  });
});

await server.close();
process.exitCode = exitCode;
