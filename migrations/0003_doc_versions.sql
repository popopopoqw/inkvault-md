-- 文档历史版本：与文档同样只存密文（客户端加密当时的 {title, content}）。
-- 每文档独立 seq 递增；added/removed 是明文行数统计（客户端 diff 算好上传，仅用于列表展示）。
CREATE TABLE IF NOT EXISTS doc_versions (
  doc_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  cipher TEXT NOT NULL,
  nonce TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (doc_id, seq)
);
