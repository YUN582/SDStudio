/** Desktop workspace identity supplied by the main process. */
export interface WorkspaceEntry {
  dir: string;
  id?: string;
  name?: string;
  folder?: string;
  state:
    | 'needs-meta'
    | 'deleted'
    | 'incomplete'
    | 'conflict'
    | 'changed'
    | 'active'
    | 'unreadable';
  legacyAuxiliary?: boolean;
  hasBackup?: boolean;
  revision?: string;
}
export interface WorkspaceSnapshot {
  dirs: string[];
  entries: WorkspaceEntry[];
}
export interface WorkspaceScan {
  names: string[];
  folderMap: Record<string, string | null>;
  folderList: string[];
}
