// 解析图片提交类型的 Issue，下载图片并更新 settings.json
// 运行环境：GitHub Actions (Node 20+)
//
// 约定：图片标题写在 Markdown 图片的 alt 文本里
//   ![这是标题](https://...)  -> 有标题
//   ![](https://...)         -> 无标题
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_AUTHOR = process.env.ISSUE_AUTHOR || 'unknown';
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

const IMAGES_DIR = path.join('public', 'images');
const SETTINGS_PATH = path.join('settings.json');
const PR_BODY_PATH = path.join('pr-body.md');

// 从 Issue 正文（表单格式）中提取指定小节内容
function extractSection(body, label) {
  const regex = new RegExp(
    `^###\\s+${label}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|(?![\\s\\S]))`,
    'im'
  );
  const match = body.match(regex);
  if (!match) return '';
  return match[1];
}

// 解析小节中的图片：alt 文本作为标题（为空则无标题）
function parseEntries(sectionText) {
  const imageRegex = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g;
  const entries = [];
  for (const m of sectionText.matchAll(imageRegex)) {
    const alt = m[1].trim();
    entries.push({ title: alt || undefined, url: m[2] });
  }
  return entries;
}

// 根据文件名提示或 Content-Type 推断扩展名
function getExtension(nameHint, contentType) {
  if (nameHint) {
    const ext = path.extname(nameHint).toLowerCase();
    if (ext) return ext;
  }
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
  };
  if (contentType && map[contentType.toLowerCase()]) return map[contentType.toLowerCase()];
  return '.png';
}

function setOutput(key, value) {
  if (!GITHUB_OUTPUT) return;
  appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`);
}

function setOutputMultiline(key, value) {
  if (!GITHUB_OUTPUT) return;
  const delimiter = `EOF_${key}`;
  appendFileSync(GITHUB_OUTPUT, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function main() {
  if (!ISSUE_NUMBER) throw new Error('ISSUE_NUMBER 环境变量未设置');

  const imagesSection = extractSection(ISSUE_BODY, '图片');
  const entries = parseEntries(imagesSection);

  if (entries.length === 0) {
    setOutput('has-images', 'false');
    console.log('未在 Issue 中找到图片。');
    return;
  }

  console.log(`找到 ${entries.length} 张图片。`);

  if (!existsSync(IMAGES_DIR)) {
    await mkdir(IMAGES_DIR, { recursive: true });
  }

  // 读取 settings.json
  const settingsRaw = await readFile(SETTINGS_PATH, 'utf8');
  const settings = JSON.parse(settingsRaw);
  if (!Array.isArray(settings.gallery)) settings.gallery = [];

  const addedItems = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const index = i + 1;
    console.log(`(${index}/${entries.length}) 下载: ${entry.url}`);

    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`下载失败 ${entry.url}: ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    const ext = getExtension(entry.title, contentType);
    const filename = `gallery-${ISSUE_NUMBER}-${index}${ext}`;

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(IMAGES_DIR, filename), buffer);

    const item = {};
    if (entry.title) item.name = entry.title;
    item.file = filename;
    settings.gallery.push(item);

    addedItems.push({ name: entry.title, file: filename });
    console.log(`  -> 保存为 ${filename}${entry.title ? `（标题：${entry.title}）` : ''}`);
  }

  // 写回 settings.json（保持 4 空格缩进 + 末尾换行）
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 4) + '\n', 'utf8');

  // 生成 PR 正文
  const list = addedItems
    .map((it, i) => `${i + 1}. \`${it.file}\`${it.name ? ` — ${it.name}` : ''}`)
    .join('\n');

  const prBody = [
    `本 PR 添加了 Issue #${ISSUE_NUMBER} 中提交的 ${addedItems.length} 张图片。`,
    '',
    `提交者：@${ISSUE_AUTHOR}`,
    '',
    list,
    '',
    `Closes #${ISSUE_NUMBER}`,
  ].join('\n');

  await writeFile(PR_BODY_PATH, prBody, 'utf8');

  setOutput('has-images', 'true');
  setOutputMultiline('summary', list);

  console.log('完成。已添加：', addedItems);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
