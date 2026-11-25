import {readFile, writeFile, mkdir, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareProductionRouting} from './production-routing.mjs';
import {run} from './xserver.mjs';

const controls = ['manifest.json', 'before.htaccess', 'after.htaccess', 'plan.json'];

async function regular(file) {
  if (!(await lstat(file)).isFile()) throw Error('通常ファイル以外は転送できません。');
  return readFile(file);
}

export async function validatePackage(directory) {
  if (!(await lstat(directory)).isDirectory()) throw Error('パッケージの保存先を確認してください。');
  const prepared = await prepareProductionRouting(path.join(directory, 'before.htaccess'), directory);
  const plan = JSON.parse(await regular(path.join(directory, 'plan.json')));
  for (const key of ['version', 'kind', 'target', 'postId', 'revision', 'directory', 'routes', 'beforeSha256', 'afterSha256', 'manifestSha256']) {
    if (JSON.stringify(plan[key]) !== JSON.stringify(prepared.plan[key])) throw Error('配備計画が一致しません。');
  }
  if (!(await regular(path.join(directory, 'after.htaccess'))).equals(Buffer.from(prepared.replacement))) throw Error('公開設定案が一致しません。');
  const files = [...controls, ...prepared.plan.routes.map(r => r.file)];
  for (const name of files) await regular(path.join(directory, name));
  return {plan: prepared.plan, files};
}

export async function packageProduction(routing, destination) {
  const plan = JSON.parse(await regular(path.join(routing, 'plan.json')));
  const prepared = await prepareProductionRouting(path.join(routing, 'before.htaccess'), plan.candidate);
  for (const key of ['manifestSha256', 'beforeSha256', 'afterSha256']) {
    if (plan[key] !== prepared.plan[key]) throw Error('元の計画が候補と一致しません。');
  }
  if (!(await regular(path.join(routing, 'after.htaccess'))).equals(Buffer.from(prepared.replacement))) throw Error('公開設定案が変わっています。');
  await mkdir(destination, {mode: 0o700});
  const content = {'before.htaccess': prepared.original, 'after.htaccess': prepared.replacement,
    'plan.json': JSON.stringify(prepared.plan, null, 2) + '\n'};
  for (const name of ['manifest.json', ...prepared.plan.routes.map(r => r.file)]) {
    content[name] = await regular(path.join(plan.candidate, name));
  }
  for (const [name, data] of Object.entries(content)) await writeFile(path.join(destination, name), data, {flag: 'wx', mode: 0o600});
  return validatePackage(destination);
}

export async function transferProduction(action, directory, env = process.env, execute = run) {
  if (env.COMFYLABO_PRODUCTION_APPROVED !== 'obsidian-4484') throw Error('本番配備・復旧には事前の明示承認が必要です。');
  if (!['deploy', 'rollback'].includes(action)) throw Error('操作を確認してください。');
  const {plan, files} = await validatePackage(directory);
  if (env.XSERVER_HOST !== 'sv8869.xserver.jp' || env.XSERVER_USER !== 'comfylabo' ||
      (env.XSERVER_PORT || '10022') !== '10022') throw Error('承認対象と接続先が異なります。');
  const ssh = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
    '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  for (const [key, option] of [['XSERVER_SSH_KEY_PATH', '-i'], ['XSERVER_KNOWN_HOSTS_PATH', 'UserKnownHostsFile']]) {
    const file = env[key];
    if (!file || !path.isAbsolute(file) || !(await lstat(file)).isFile()) throw Error('鍵とホスト鍵の保存場所を確認してください。');
    ssh.push(...(option === '-i' ? ['-i', file, '-o', 'IdentitiesOnly=yes'] : ['-o', `${option}=${file}`]));
  }
  const helper = await readFile(new URL('./production_deploy.py', import.meta.url), 'utf8');
  const destination = 'comfylabo@sv8869.xserver.jp';
  const remote = mode => execute('ssh', [...ssh, '-p', '10022', destination,
    `COMFYLABO_PRODUCTION_APPROVED=obsidian-4484 /usr/bin/python3 -B - ${mode} ${plan.manifestSha256}`], helper);
  if (action === 'rollback') return remote('rollback');
  await remote('prepare');
  await execute('scp', [...ssh, '-P', '10022', ...files.map(n => path.resolve(directory, n)),
    `${destination}:/home/comfylabo/comfylabo-next-production/incoming/${plan.manifestSha256}/`]);
  return remote('activate');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [action, first, second, ...extra] = process.argv.slice(2);
    if (action === 'package' && first && second && !extra.length) {
      const {plan, files} = await packageProduction(first, second);
      console.log(JSON.stringify({output: second, target: plan.target, packageFiles: files.length, deployed: false}));
    } else if (['deploy', 'rollback'].includes(action) && first && !second) {
      await transferProduction(action, first);
    } else throw Error('引数を確認してください。');
  } catch {
    console.error('本番用の操作を完了できませんでした。承認・候補・接続先を確認してください。通信切断時は現状を確認してから再操作してください。');
    process.exitCode = 1;
  }
}
