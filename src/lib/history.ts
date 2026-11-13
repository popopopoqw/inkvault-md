import { api } from './api';
import { currentKey, decryptDoc, encryptDoc } from './crypto';

/**
 * 文档历史（网页端实现）：快照存 D1 doc_versions 表（AES-GCM 密文，E2E 不破坏），
 * 服务端只存密文与明文行数统计；diff 计算、版本重建全部在前端完成。
 * 桌面版对应实现为 Rust 端 .history 目录 + delta 链，此处简化为全量快照。
 */

export interface VersionInfo {
  seq: number;
  time_ms: number;
  added: number;
  removed: number;
  is_full: boolean;
}

export interface DiffLine {
  kind: 'add' | 'del';
  text: string;
}

interface VersionRow {
  seq: number;
  added: number;
  removed: number;
  createdAt: string;
}

// ---- 行级 LCS diff（大文档退化为整删整加，同桌面版策略） ----

const LCS_MAX_CELLS = 4_000_000; // 行数乘积超限退化为整删整加

/** 对比两组行，返回新增/删除行与统计 */
export function lineDiff(oldLines: string[], newLines: string[]): { added: number; removed: number; lines: DiffLine[] } {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > LCS_MAX_CELLS) {
    return {
      added: m,
      removed: n,
      lines: [
        ...newLines.map((text): DiffLine => ({ kind: 'add', text })),
        ...oldLines.map((text): DiffLine => ({ kind: 'del', text })),
      ],
    };
  }
  // LCS 长度表（一维 DP）
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        oldLines[i] === newLines[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
    }
  }
  // 回溯输出 diff（旧内容先删后加，与常见 diff 展示一致）
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
      lines.push({ kind: 'del', text: oldLines[i] });
      i++;
    } else {
      lines.push({ kind: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    lines.push({ kind: 'del', text: oldLines[i] });
    i++;
  }
  while (j < m) {
    lines.push({ kind: 'add', text: newLines[j] });
    j++;
  }
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
    lines,
  };
}

// ---- 快照上传（被覆盖前的旧内容密文） ----

/** 把一份明文内容作为历史版本上传；added/removed 为与上一版快照的行 diff 统计 */
export async function uploadVersion(docId: string, title: string, content: string, added: number, removed: number): Promise<void> {
  const key = currentKey();
  if (!key) return;
  const { cipher, nonce } = await encryptDoc(key, { title, content });
  await api(`/docs/${docId}/versions`, { method: 'POST', body: { cipher, nonce, added, removed } });
}

// ---- HistoryPanel 需要的四个操作 ----

/** 版本元数据列表（升序，末位最新；与桌面版返回顺序一致） */
export async function listVersions(docId: string): Promise<VersionInfo[]> {
  const { versions } = await api<{ versions: VersionRow[] }>(`/docs/${docId}/versions`);
  return (versions ?? [])
    .map((v) => ({
      seq: v.seq,
      time_ms: Date.parse(v.createdAt) || 0,
      added: v.added,
      removed: v.removed,
      is_full: v.seq === 1,
    }))
    .sort((a, b) => a.seq - b.seq);
}

/** 取单版全文（密文拉回后解密） */
export async function readVersion(docId: string, seq: number): Promise<string> {
  const key = currentKey();
  if (!key) throw new Error('未解锁');
  const { cipher, nonce } = await api<{ cipher: string; nonce: string }>(`/docs/${docId}/versions/${seq}`);
  const payload = await decryptDoc(key, cipher, nonce);
  return payload.content;
}

/** 该版相对前一版的行级 diff（seq=1 无前版，返回空） */
export async function readVersionDiff(docId: string, seq: number): Promise<DiffLine[]> {
  if (seq <= 1) return [];
  const [prev, cur] = await Promise.all([readVersion(docId, seq - 1), readVersion(docId, seq)]);
  return lineDiff(prev.split('\n'), cur.split('\n')).lines;
}

/**
 * 恢复历史版本：先把当前内容强制存一版（可撤销），再返回历史明文。
 * 上传新当前版由调用方走 applyRestoredContent → flush 完成。
 */
export async function restoreVersion(docId: string, title: string, currentContent: string, seq: number): Promise<string> {
  const key = currentKey();
  if (!key) throw new Error('未解锁');
  const target = await readVersion(docId, seq);
  if (currentContent.trim() && currentContent !== target) {
    // 与最新一版比对得出统计（不追求精确，仅列表展示）
    const { versions } = await api<{ versions: VersionRow[] }>(`/docs/${docId}/versions`);
    const latest = versions?.[0];
    let added = 0;
    let removed = 0;
    if (latest) {
      const prevContent = await readVersion(docId, latest.seq);
      const stat = lineDiff(prevContent.split('\n'), currentContent.split('\n'));
      added = stat.added;
      removed = stat.removed;
    } else {
      added = currentContent.split('\n').length;
    }
    await uploadVersion(docId, title, currentContent, added, removed);
  }
  return target;
}
