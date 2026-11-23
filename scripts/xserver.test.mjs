import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPostRelease } from "./mvp-export.mjs";
import { run, transfer } from "./xserver.mjs";

const script = fileURLToPath(new URL("./xserver-release.sh", import.meta.url));
const post = { _id: "local-test", _rev: "1", slug: "test", title: "確認記事", body: "本文です。" };

test("ローカルの隔離ディレクトリで、検証後の切り替え・失敗時の維持・前の版への復旧を確認", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-switch-"));
  const root = path.join(directory, "comfylabo-next");
  const command = (action, version) => run("sh", [script, root, action, version]);
  try {
    const first = await buildPostRelease(post, { releaseDirectory: path.join(directory, "builds") });
    await command("prepare", "v1");
    await cp(first, path.join(root, "releases/v1"), { recursive: true });
    await command("activate", "v1");
    const original = await readFile(path.join(root, "current/index.html"), "utf8");
    const second = await buildPostRelease({ ...post, _rev: "2", body: "更新した本文です。" }, { releaseDirectory: path.join(directory, "builds") });
    await command("prepare", "v2");
    await cp(second, path.join(root, "releases/v2"), { recursive: true });
    await command("activate", "v2");
    assert.equal(await readlink(path.join(root, "previous")), "releases/v1");
    assert.ok((await readFile(path.join(root, "current/index.html"), "utf8")).includes("更新した本文"));
    await command("prepare", "broken");
    await assert.rejects(command("activate", "broken"));
    assert.equal(await readlink(path.join(root, "current")), "releases/v2");
    await cp(second, path.join(root, "releases/broken"), { recursive: true });
    await writeFile(path.join(root, "releases/broken/index.html"), "corrupted");
    await assert.rejects(command("activate", "broken"));
    assert.equal(await readlink(path.join(root, "current")), "releases/v2");
    await writeFile(path.join(root, "releases/v1/index.html"), "corrupted previous");
    await assert.rejects(command("rollback", ""));
    assert.equal(await readlink(path.join(root, "current")), "releases/v2");
    await writeFile(path.join(root, "releases/v1/index.html"), original);
    await writeFile(path.join(root, "releases/broken/index.html"), "incomplete");
    await assert.rejects(command("activate", "broken"));
    assert.equal(await readlink(path.join(root, "current")), "releases/v2");
    await command("rollback", "");
    assert.equal(await readFile(path.join(root, "current/index.html"), "utf8"), original);
    assert.ok(!(await readdir(root)).some(name => name.startsWith(".next-")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("初期状態では接続せず、有効時も不正な保存先や壊れた成果物は転送しない", async () => {
  const env = { COMFYLABO_DEPLOY_ENABLED: "true", XSERVER_HOST: "example.test", XSERVER_USER: "test", XSERVER_RELEASE_ROOT: "/home/test/comfylabo-next" };
  let calls = 0;
  const execute = async () => { calls += 1; };
  await assert.rejects(transfer("deploy", "missing", {}, execute));
  await assert.rejects(transfer("rollback", null, { ...env, XSERVER_RELEASE_ROOT: "/home/test/public_html" }, execute));
  await assert.rejects(transfer("deploy", "missing", env, execute));
  await assert.rejects(transfer("rollback", null, { ...env, XSERVER_SSH_KEY_PATH: "relative-key" }, execute));
  await assert.rejects(transfer("rollback", null, { ...env, XSERVER_KNOWN_HOSTS_PATH: "relative-hosts" }, execute));
  assert.equal(calls, 0);
});

test("転送に失敗した場合は公開先の切り替えを実行しない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-upload-"));
  try {
    const release = await buildPostRelease(post, { releaseDirectory: directory });
    const key = path.join(directory, "test-key");
    await writeFile(key, "test-only placeholder", { mode: 0o600 });
    const hosts = path.join(directory, "test-hosts");
    await writeFile(hosts, "test-only host placeholder");
    const commands = [];
    await assert.rejects(transfer("deploy", release, {
      COMFYLABO_DEPLOY_ENABLED: "true", XSERVER_HOST: "example.test", XSERVER_USER: "test", XSERVER_RELEASE_ROOT: "/home/test/comfylabo-next",
      XSERVER_SSH_KEY_PATH: key,
      XSERVER_KNOWN_HOSTS_PATH: hosts,
    }, async (command, args) => {
      commands.push([command, args]);
      if (command === "scp") throw new Error("Simulated transfer failure");
    }));
    assert.deepEqual(commands.map(([command]) => command), ["ssh", "scp"]);
    assert.ok(commands[0][1].at(-1).includes("'prepare'"));
    assert.ok(commands.every(([, args]) => args.includes(key)));
    assert.ok(commands.every(([, args]) => args.includes(`UserKnownHostsFile=${hosts}`)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
