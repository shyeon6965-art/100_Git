import {repository as repo, githubUrl, apiUrl, dataBranch as branch, publicRawBase} from './config.js?v=3';
import {readCatalog, writeCatalog} from './catalog.mjs?v=3';
const limit = 25 * 1024 * 1024;
const $ = id => document.getElementById(id);
let token = '', head = '', tree = '', current = '', entries = [], busy = false;
let metadata = {}, legacy = false;

async function api(path, method = 'GET', body) {
  const headers = {Accept: 'application/vnd.github+json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(apiUrl + '/repos/' + repo + path, {
    method, headers, cache: 'no-store', body: body && JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error('GitHub ' + res.status + ' · ' + data.message);
  return data;
}

async function load() {
  if (!token && publicRawBase && githubUrl === 'https://github.com') {
    const response = await fetch(publicRawBase + '/' + repo + '/' + branch + '/library.json?t=' + Date.now(), {cache: 'no-store'});
    if (!response.ok) throw new Error('공개 목록을 열 수 없습니다 · HTTP ' + response.status);
    showCatalog(readCatalog(await response.json()), '', '');
    return;
  }
  const ref = await api('/git/ref/heads/' + branch + '?t=' + Date.now());
  const commit = await api('/git/commits/' + ref.object.sha);
  const root = await api('/git/trees/' + commit.tree.sha);
  const manifest = root.tree.find(x => x.path === 'library.json');
  if (!manifest) throw new Error('자료 브랜치에서 library.json을 찾을 수 없습니다.');
  const blob = await api('/git/blobs/' + manifest.sha);
  const bytes = Uint8Array.from(atob(blob.content), c => c.charCodeAt(0));
  const catalog = readCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  showCatalog(catalog, commit.sha, commit.tree.sha);
}
function showCatalog(catalog, commitSha, treeSha) {
  head = commitSha;
  tree = treeSha;
  entries = catalog.entries;
  metadata = catalog.metadata;
  legacy = catalog.legacy;
  if (!entries.some(x => x.id === current && x.folder)) current = '';
  render();
}

async function save(next, changes, message) {
  changes.push({path: 'library.json', mode: '100644', type: 'blob', content: writeCatalog(metadata, next)});
  const updated = await api('/git/trees', 'POST', {base_tree: tree, tree: changes});
  const commit = await api('/git/commits', 'POST', {message, tree: updated.sha, parents: [head]});
  try {
    await api('/git/refs/heads/' + branch, 'PATCH', {sha: commit.sha, force: false});
  } catch (error) {
    await load();
    throw new Error('저장 결과를 확인하려고 목록을 갱신했습니다. ' + error.message);
  }
  head = commit.sha;
  tree = updated.sha;
  entries = next;
  legacy = false;
  render();
}

async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelector('main').inert = true;
  $('connect').disabled = true;
  $('status').textContent = '처리 중…';
  try { $('status').textContent = (await fn()) || ''; }
  catch (error) { $('status').textContent = error.message; }
  finally { busy = false; document.querySelector('main').inert = false; $('connect').disabled = false; }
}

function dialog(id) {
  const el = $(id);
  el.returnValue = '';
  return new Promise(resolve => {
    el.addEventListener('close', () => resolve(el.returnValue === 'ok'), {once: true});
    el.showModal();
  });
}
async function authorize() {
  if (token) return true;
  const ok = await dialog('access');
  const input = $('token').value.trim();
  $('token').value = '';
  if (!ok || !input) return false;
  token = input;
  try {
    const info = await api('');
    if (!info.permissions?.push) throw new Error('저장소 쓰기 권한을 확인하세요.');
  } catch (error) { token = ''; throw error; }
  $('connect').textContent = '편집 연결 해제';
  return true;
}
function edit(fn) {
  return run(async () => {
    if (!(await authorize())) return;
    if (!head) {
      const displayed = JSON.stringify(entries);
      await load();
      if (JSON.stringify(entries) !== displayed) return '목록이 변경되어 갱신했습니다. 항목을 다시 선택하세요.';
    }
    return fn();
  });
}

function element(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}
function button(label, action) {
  const el = element('button', label);
  el.onclick = action;
  return el;
}
function trail(id) {
  const result = [];
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const item = entries.find(x => x.id === id);
    if (!item) break;
    result.unshift(item);
    id = item.parent;
  }
  return result;
}
function openTab(id) {
  current = id;
  $('search').value = '';
  render();
}
function render() {
  $('migrate').hidden = !legacy;
  const path = trail(current);
  $('title').textContent = path.at(-1)?.name || '전체 자료';
  $('crumbs').replaceChildren(button('전체 자료', () => openTab('')));
  for (const x of path) $('crumbs').append(' / ', button(x.name, () => openTab(x.id)));
  const query = $('search').value.trim().toLocaleLowerCase();
  const items = entries.filter(x => query ? x.name.toLocaleLowerCase().includes(query) : x.parent === current);
  items.sort((a,b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, 'ko'));
  const list = $('list');
  list.replaceChildren();
  if (!items.length) list.append(element('p', query ? '검색 결과가 없습니다.' : '이 탭에 아직 자료가 없습니다.'));
  for (const x of items) {
    const row = element('article',''), item = element('div',''), actions = element('div','');
    row.className = 'row'; item.className = 'item'; actions.className = 'actions';
    item.append(x.folder ? button(x.name, () => openTab(x.id)) : element('strong', x.name));
    const detail = x.folder ? '하위 탭' : (x.size < 1024 ? x.size + ' B' : (x.size / 1024).toLocaleString('ko', {maximumFractionDigits: 1}) + ' KiB');
    item.append(element('small', detail + (query ? ' · 전체 자료 / ' + trail(x.parent).map(n => n.name).join(' / ') : '')));
    if (!x.folder) actions.append(button('내려받기', () => run(() => download(x))));
    actions.append(button('이름 변경', () => edit(() => rename(x))), button('이동', () => edit(() => move(x))), button('삭제', () => edit(() => remove(x))));
    row.append(item, actions); list.append(row);
  }
}
function validate(name, parent, records, except) {
  if (!name.trim() || /[\\/\x00-\x1f]/u.test(name)) throw new Error('이름을 확인하세요.');
  if (records.some(x => x.id !== except && x.parent === parent && x.name === name))
    throw new Error('같은 탭에 이미 있는 이름입니다 · ' + name);
}
async function addTab() {
  const name = prompt('새 하위 탭 이름')?.trim();
  if (!name) return;
  validate(name, current, entries);
  await save([...entries, {id: crypto.randomUUID(), parent: current, folder: true, name}], [], 'Add tab');
}
async function rename(x) {
  const name = prompt('새 이름', x.name)?.trim();
  if (!name || name === x.name) return;
  validate(name, x.parent, entries, x.id);
  await save(entries.map(n => n.id === x.id ? {...n, name} : n), [], 'Rename library item');
}
async function move(x) {
  const dest = $('dest');
  dest.replaceChildren(new Option('전체 자료', ''));
  for (const tab of entries.filter(n => n.folder)) {
    const path = trail(tab.id);
    if (!path.some(n => n.id === x.id)) dest.add(new Option('전체 자료 / ' + path.map(n => n.name).join(' / '), tab.id));
  }
  dest.value = x.parent;
  if (!(await dialog('moveDialog')) || dest.value === x.parent) return;
  validate(x.name, dest.value, entries, x.id);
  await save(entries.map(n => n.id === x.id ? {...n, parent: dest.value} : n), [], 'Move library item');
}
async function remove(x) {
  if (entries.some(n => n.parent === x.id)) throw new Error('탭 안의 자료를 먼저 이동하거나 삭제하세요.');
  if (!confirm('자료실에서 “' + x.name + '”을 삭제할까요?')) return;
  const changes = x.folder ? [] : [{path: 'files/' + x.id, mode: '100644', type: 'blob', sha: null}];
  await save(entries.filter(n => n.id !== x.id), changes, 'Remove library item');
}
function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다 · ' + file.name));
    reader.readAsDataURL(file);
  });
}
async function upload(files) {
  const next = [...entries], changes = [];
  for (const file of files) {
    if (file.size > limit) throw new Error('25 MiB를 초과한 파일 · ' + file.name);
    validate(file.name, current, next);
    next.push({id: crypto.randomUUID(), folder: false, name: file.name, parent: current, size: file.size});
  }
  for (const [i,file] of files.entries()) {
    $('status').textContent = (i+1) + '/' + files.length + ' 업로드 중 · ' + file.name;
    const blob = await api('/git/blobs', 'POST', {encoding: 'base64', content: await base64(file)});
    changes.push({path: 'files/' + next[entries.length + i].id, mode: '100644', type: 'blob', sha: blob.sha});
  }
  await save(next, changes, 'Upload files');
  $('search').value = ''; render();
  return files.length + '개 파일을 올렸습니다.';
}
async function download(x) {
  const headers = {Accept: 'application/vnd.github.raw+json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  const path = '/files/' + encodeURIComponent(x.id);
  const response = !token && publicRawBase && githubUrl === 'https://github.com'
    ? await fetch(publicRawBase + '/' + repo + '/' + (head || branch) + path)
    : await fetch(apiUrl + '/repos/' + repo + '/contents' + path + '?ref=' + (head || branch), {headers});
  if (!response.ok) throw new Error('다운로드 실패 · HTTP ' + response.status);
  const blob = await response.blob();
  if (blob.size !== x.size) throw new Error('받은 파일의 크기가 일치하지 않습니다.');
  const url = URL.createObjectURL(blob);
  const a = element('a',''); a.href = url; a.download = x.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return '다운로드를 시작했습니다 · ' + x.name;
}
$('cancel').onclick = () => $('access').close('cancel');
$('connect').onclick = () => run(async () => {
  if (token) { token = ''; $('connect').textContent = '편집 연결'; return '연결을 해제했습니다.'; }
  if (await authorize()) {
    await load();
    return '편집 연결을 완료했습니다.';
  }
});
$('folder').onclick = () => edit(addTab);
$('upload').onclick = () => $('files').click();
$('files').onchange = () => {
  const files = Array.from($('files').files);
  $('files').value = '';
  if (files.length) edit(() => upload(files));
};
$('repoName').textContent = repo;
$('tokenLink').href = githubUrl + '/settings/personal-access-tokens/new';
$('migrate').onclick = () => edit(async () => {
  await load();
  if (!legacy) return '이미 최신 자료 형식입니다.';
  await save(entries, [], 'Upgrade library catalog to v2');
  return '기존 탭과 파일 목록을 최신 형식으로 업데이트했습니다.';
});
$('refresh').onclick = () => run(async () => {
  const url = new URL(location.href);
  url.searchParams.set('releaseCheck', Date.now());
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error('페이지 버전을 확인할 수 없습니다.');
  const html = new DOMParser().parseFromString(await response.text(), 'text/html');
  const release = doc => doc.querySelector('meta[name="library-release"]')?.content;
  if (release(html) && release(html) !== release(document)) {
    location.replace(url);
    return;
  }
  await load();
});
$('search').oninput = render;
run(load);
