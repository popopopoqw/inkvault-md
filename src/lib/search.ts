import { useStore } from '../store/app';

/**
 * 全库搜索：网页端所有文档登录后已解密在内存（E2E 架构下服务端只有密文，
 * 无法也不允许在服务端搜索），直接在前端遍历匹配。
 */

export interface SearchHit {
  path: string; // doc id
  title: string;
  line_no: number; // 1-based
  line_text: string; // 截断后的预览
}

const MAX_HITS = 500;
const PREVIEW_LEN = 80;

export async function searchAll(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const docs = useStore.getState().docs;
  const hits: SearchHit[] = [];
  for (const doc of Object.values(docs)) {
    if (doc.isFolder) continue;
    const lines = doc.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        hits.push({ path: doc.id, title: doc.title || '无标题', line_no: i + 1, line_text: lines[i].trim().slice(0, PREVIEW_LEN) });
        if (hits.length >= MAX_HITS) return hits;
      }
    }
  }
  return hits;
}
