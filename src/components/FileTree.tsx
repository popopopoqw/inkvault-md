import { useState } from 'react';
import { childrenOf, isDescendant, sortKeyBetween, useStore } from '../store/app';
import type { DecryptedDoc } from '../lib/types';
import { NewNodeDialog } from './NewNodeDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { IconDoc, IconFolder, IconFolderOpen, IconFolderPlus, IconPlus, IconPencil, IconTrash, IconChevronDown, IconChevronRight } from './Icons';

type DropPos = 'before' | 'after' | 'into';

export function FileTree() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [rootDragOver, setRootDragOver] = useState(false);
  // 新建对话框：null 关闭；打开时预选目录（默认当前文档所在目录）
  const [creating, setCreating] = useState<{ isFolder: boolean; parent: string | null } | null>(null);
  // 待确认删除：自绘对话框替代 window.confirm
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string; hasChildren: boolean } | null>(null);
  const roots = childrenOf(docs, null);

  const openCreate = (isFolder: boolean, parent?: string | null) => {
    const fallback = activeId ? (docs[activeId]?.parentId ?? null) : null;
    setCreating({ isFolder, parent: parent !== undefined ? parent : fallback });
  };

  return (
    <aside className="filetree">
      <div className="filetree-header">
        <span className="filetree-title">文档库</span>
        <span className="filetree-actions">
          <button title="新建文档（可选目录）" onClick={() => openCreate(false)}>
            <IconPlus />
          </button>
          <button title="新建文件夹（可选目录）" onClick={() => openCreate(true)}>
            <IconFolderPlus />
          </button>
        </span>
      </div>
      <div
        className={`filetree-body${rootDragOver ? ' root-dragover' : ''}`}
        onDragOver={(e) => {
          if (!draggingId) return;
          e.preventDefault();
          setRootDragOver(true);
        }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootDragOver(false);
          if (draggingId && draggingId !== '') {
            void useStore.getState().moveNode(draggingId, null, sortKeyBetween(docs, null, null, null));
          }
          setDraggingId(null);
        }}
      >
        {roots.map((d) => (
          <TreeNode
            key={d.id}
            doc={d}
            depth={0}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
            onCreateIn={openCreate}
            onRequestDelete={(doc) =>
              setPendingDelete({ id: doc.id, label: doc.title || (doc.isFolder ? '文件夹' : '文档'), hasChildren: doc.isFolder && childrenOf(docs, doc.id).length > 0 })
            }
          />
        ))}
        {roots.length === 0 && (
          <p className="filetree-empty">
            暂无文档
            <br />
            点上方按钮新建
          </p>
        )}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          message={
            pendingDelete.hasChildren
              ? `删除文件夹「${pendingDelete.label}」及其全部内容？此操作不可恢复。`
              : `删除「${pendingDelete.label}」？`
          }
          onConfirm={() => {
            void useStore.getState().deleteNode(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {creating && (
        <NewNodeDialog
          docs={docs}
          isFolder={creating.isFolder}
          defaultParent={creating.parent}
          onClose={() => setCreating(null)}
          onSubmit={(parent, name) => void useStore.getState().createNodeNamed(parent, creating.isFolder, name)}
        />
      )}
    </aside>
  );
}

function TreeNode({
  doc,
  depth,
  draggingId,
  setDraggingId,
  onCreateIn,
  onRequestDelete,
}: {
  doc: DecryptedDoc;
  depth: number;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onCreateIn: (isFolder: boolean, parent?: string | null) => void;
  onRequestDelete: (doc: DecryptedDoc) => void;
}) {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const isExpanded = useStore((s) => !!s.expanded[doc.id]);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [dropPos, setDropPos] = useState<DropPos | null>(null);

  const { selectDoc, toggleFolder, renameNode, moveNode } = useStore.getState();
  const isFolder = doc.isFolder;
  const isOpen = isFolder && isExpanded;
  const children = isFolder ? childrenOf(docs, doc.id) : [];
  const active = activeId === doc.id;

  function commitRename() {
    setRenaming(false);
    const t = title.trim();
    if (t && t !== doc.title) void renameNode(doc.id, t);
  }

  function confirmDelete() {
    onRequestDelete(doc);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!draggingId || draggingId === doc.id) return;
    if (isDescendant(docs, draggingId, doc.id)) return; // 不能拖进自身子树
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const pos: DropPos = isFolder
      ? ratio < 0.3
        ? 'before'
        : ratio > 0.7
          ? 'after'
          : 'into'
      : ratio < 0.5
        ? 'before'
        : 'after';
    setDropPos(pos);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const pos = dropPos;
    const id = draggingId;
    setDropPos(null);
    setDraggingId(null);
    if (!id || !pos || id === doc.id) return;

    if (pos === 'into') {
      if (!isFolder) return;
      void moveNode(id, doc.id, sortKeyBetween(docs, doc.id, null, null));
    } else {
      const siblings = childrenOf(docs, doc.parentId);
      const idx = siblings.findIndex((d) => d.id === doc.id);
      const before = pos === 'before' ? (siblings[idx - 1]?.id ?? null) : doc.id;
      const after = pos === 'before' ? doc.id : (siblings[idx + 1]?.id ?? null);
      void moveNode(id, doc.parentId, sortKeyBetween(docs, doc.parentId, before, after));
    }
  }

  return (
    <>
      <div
        className={`tree-row${active ? ' active' : ''}${dropPos ? ` drop-${dropPos}` : ''}${draggingId === doc.id ? ' dragging' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        draggable={!renaming}
        onDragStart={(e) => {
          setDraggingId(doc.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDraggingId(null)}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropPos(null)}
        onDrop={handleDrop}
        onClick={() => (isFolder ? toggleFolder(doc.id) : selectDoc(doc.id))}
      >
        {isFolder ? <span className="tree-caret">{isOpen ? <IconChevronDown /> : <IconChevronRight />}</span> : <span className="tree-caret-leaf" />}
        <span className="tree-icon">{isFolder ? (isOpen ? <IconFolderOpen /> : <IconFolder />) : <IconDoc />}</span>
        {renaming ? (
          <input
            className="tree-rename"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="tree-label" title={doc.title}>
            {doc.title || '无标题'}
          </span>
        )}
        <span className="tree-ops" onClick={(e) => e.stopPropagation()}>
          {isFolder && (
            <>
              <button title="在此新建文档" onClick={() => onCreateIn(false, doc.id)}>
                <IconPlus />
              </button>
              <button title="在此新建文件夹" onClick={() => onCreateIn(true, doc.id)}>
                <IconFolderPlus />
              </button>
            </>
          )}
          <button
            title="重命名"
            onClick={() => {
              setTitle(doc.title);
              setRenaming(true);
            }}
          >
            <IconPencil />
          </button>
          <button title="删除" onClick={confirmDelete}>
            <IconTrash />
          </button>
        </span>
      </div>
      {isOpen && children.map((c) => (
        <TreeNode
          key={c.id}
          doc={c}
          depth={depth + 1}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
          onCreateIn={onCreateIn}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </>
  );
}
