// @anchor/core — JSON-file persistence for the memorial store. Dependency-free (node:fs).
// Default home for a cross-project memorial: ~/.anchor/memorial.json; pass a project path
// for a project-scoped store. (store.ts stays fs-free so its logic is pure/testable.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemorialEntry, MemorialPersistence } from './types.ts';

export class JsonFilePersistence implements MemorialPersistence {
  private path: string;
  constructor(path: string) { this.path = path; }

  load(): MemorialEntry[] {
    try {
      if (!existsSync(this.path)) return [];
      return JSON.parse(readFileSync(this.path, 'utf8')) as MemorialEntry[];
    } catch {
      return [];
    }
  }

  save(entries: MemorialEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(entries, null, 2) + '\n');
  }
}
