import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFiles } from "../lib/site-files.mjs";

const serverScript = await readFile(new URL("./xserver-release.sh", import.meta.url), "utf8");

export function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed`)));
  });
}

export async function transfer(action, release, env = process.env, execute = run) {
  if (env.COMFYLABO_DEPLOY_ENABLED !== "true") throw new Error("Xserverへの反映は無効です。接続先確認と事前承認後に有効化してください。");
  const { XSERVER_HOST: host, XSERVER_USER: user, XSERVER_RELEASE_ROOT: root } = env;
  if (!/^[a-zA-Z0-9.-]+$/.test(host || "") || !/^[a-zA-Z0-9_-]+$/.test(user || "") ||
      !/^\/home\/[a-zA-Z0-9_-]+\/comfylabo-next$/.test(root || "")) {
    throw new Error("Xserverの接続先と専用保存先を確認してください。");
  }
  if (!["deploy", "rollback"].includes(action)) throw new Error("Unknown action");
  const port = env.XSERVER_PORT || "10022";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid SSH port");
  const destination = `${user}@${host}`;
  const ssh = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
  if (env.XSERVER_SSH_KEY_PATH) {
    const key = env.XSERVER_SSH_KEY_PATH;
    if (!path.isAbsolute(key) || !(await stat(key)).isFile()) throw new Error("SSH秘密鍵ファイルの絶対パスを確認してください。");
    ssh.push("-i", key, "-o", "IdentitiesOnly=yes");
  }
  if (env.XSERVER_KNOWN_HOSTS_PATH) {
    const hosts = env.XSERVER_KNOWN_HOSTS_PATH;
    if (!path.isAbsolute(hosts) || !(await stat(hosts)).isFile()) throw new Error("ホスト鍵ファイルの絶対パスを確認してください。");
    ssh.push("-o", `UserKnownHostsFile=${hosts}`, "-o", "UpdateHostKeys=no");
  }
  const remote = (mode, version = "") => execute("ssh", [...ssh, "-p", port, destination, `sh -s -- '${root}' '${mode}' '${version}'`], serverScript);
  if (action === "rollback") return remote("rollback");
  const version = path.basename(release || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(version) || version === "..") throw new Error("Invalid release path");
  // ローカルでも全ファイルを照合し、失敗したら接続しない。
  const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
  const files = publicFiles(manifest);
  let sums = "";
  for (const file of files) {
    const content = await readFile(path.join(release, file));
    const hash = createHash("sha256").update(content).digest("hex");
    if (!content.length || hash !== manifest.files?.[file]) throw new Error("成果物の内容が生成時と一致しません。");
    sums += `${hash}  ${file}\n`;
  }
  if (await readFile(path.join(release, "SHA256SUMS"), "utf8") !== sums) throw new Error("照合情報が不正です。");
  await remote("prepare", version);
  await execute("scp", [...ssh, "-P", port, ...[...files, "SHA256SUMS"].map(file => path.resolve(release, file)), `${destination}:${root}/releases/${version}/`]);
  await remote("activate", version);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [action, release] = process.argv.slice(2);
  transfer(action, release).catch(() => {
    console.error("Xserver操作が完了しませんでした。有効化設定・接続・成果物を確認してください。通信切断時は結果を確認してから再操作してください。");
    process.exitCode = 1;
  });
}
