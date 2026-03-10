/**
 * Code Search Repository
 *
 * CRUD operations for code indexes, chunks, and symbols.
 */

import { randomUUID } from 'crypto';
import { getDatabase, isSqliteVecAvailable } from '../database';
import type {
  CodeIndex,
  IndexedFile,
  CodeChunk,
  CodeSymbol,
  CodeSearchResult,
  SymbolSearchResult,
  IndexStatus,
  ChunkType,
  SymbolType,
} from '../../shared/types';

// ============ Code Indexes ============

export function getIndexByDirectory(directoryPath: string): CodeIndex | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM code_indexes WHERE directory_path = ?')
    .get(directoryPath) as any;

  if (!row) return null;
  return mapRowToCodeIndex(row);
}

export function getIndexById(id: string): CodeIndex | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM code_indexes WHERE id = ?')
    .get(id) as any;

  if (!row) return null;
  return mapRowToCodeIndex(row);
}

export function getAllIndexes(): CodeIndex[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM code_indexes ORDER BY directory_path')
    .all() as any[];

  return rows.map(mapRowToCodeIndex);
}

export function createIndex(
  directoryPath: string,
  modelName: string = 'bge-base-en-v1.5',
  dimensions: number = 768
): CodeIndex {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO code_indexes (id, directory_path, status, model_name, embedding_dimensions)
    VALUES (?, ?, 'pending', ?, ?)
  `).run(id, directoryPath, modelName, dimensions);

  return getIndexById(id)!;
}

export function updateIndexStatus(
  id: string,
  status: IndexStatus,
  errorMessage?: string | null
): void {
  const db = getDatabase();
  const updates: string[] = ['status = ?'];
  const params: any[] = [status];

  if (status === 'ready') {
    updates.push('last_indexed_at = ?');
    params.push(new Date().toISOString());
  }

  if (errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(errorMessage);
  }

  params.push(id);
  db.prepare(`UPDATE code_indexes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function updateIndexCounts(id: string, fileCount: number, chunkCount: number): void {
  const db = getDatabase();
  db.prepare('UPDATE code_indexes SET file_count = ?, chunk_count = ? WHERE id = ?')
    .run(fileCount, chunkCount, id);
}

export function deleteIndex(id: string): void {
  const db = getDatabase();
  db.transaction(() => {
    // Delete from vector table first (if available)
    if (isSqliteVecAvailable()) {
      db.prepare('DELETE FROM code_chunks_vec WHERE chunk_id IN (SELECT id FROM code_chunks WHERE index_id = ?)').run(id);
    }
    // CASCADE will handle the rest
    db.prepare('DELETE FROM code_indexes WHERE id = ?').run(id);
  })();
}

// ============ Indexed Files ============

export function getIndexedFile(indexId: string, filePath: string): IndexedFile | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM indexed_files WHERE index_id = ? AND file_path = ?')
    .get(indexId, filePath) as any;

  if (!row) return null;
  return mapRowToIndexedFile(row);
}

export function getIndexedFiles(indexId: string): IndexedFile[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM indexed_files WHERE index_id = ?')
    .all(indexId) as any[];

  return rows.map(mapRowToIndexedFile);
}

export function upsertIndexedFile(
  indexId: string,
  filePath: string,
  mtime: number,
  fileHash?: string | null
): IndexedFile {
  const db = getDatabase();
  const existing = getIndexedFile(indexId, filePath);

  if (existing) {
    db.prepare(`
      UPDATE indexed_files SET mtime = ?, file_hash = ? WHERE id = ?
    `).run(mtime, fileHash ?? null, existing.id);
    return { ...existing, mtime, fileHash: fileHash ?? null };
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO indexed_files (id, index_id, file_path, mtime, file_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, indexId, filePath, mtime, fileHash ?? null);

  return { id, indexId, filePath, mtime, fileHash: fileHash ?? null, chunkCount: 0 };
}

export function deleteIndexedFile(indexId: string, filePath: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM indexed_files WHERE index_id = ? AND file_path = ?')
    .run(indexId, filePath);
}

export function updateFileChunkCount(indexId: string, filePath: string, count: number): void {
  const db = getDatabase();
  db.prepare('UPDATE indexed_files SET chunk_count = ? WHERE index_id = ? AND file_path = ?')
    .run(count, indexId, filePath);
}

// ============ Code Chunks ============

export function createChunk(
  indexId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  content: string,
  chunkType?: ChunkType | null,
  embedding?: number[] | null
): CodeChunk {
  const db = getDatabase();
  const id = randomUUID();
  const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO code_chunks (id, index_id, file_path, start_line, end_line, content, chunk_type, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, indexId, filePath, startLine, endLine, content, chunkType ?? null, embeddingBlob);

    // Insert into vector table if embedding exists and sqlite-vec is available
    if (embedding && isSqliteVecAvailable()) {
      try {
        db.prepare(`
          INSERT INTO code_chunks_vec (chunk_id, embedding)
          VALUES (?, ?)
        `).run(id, embeddingBlob);
      } catch (e) {
        console.error('[CodeSearch] Failed to insert into vector table:', e);
        // Non-fatal: chunk is still searchable by symbol, just not by vector
      }
    }
  })();

  return {
    id,
    indexId,
    filePath,
    startLine,
    endLine,
    content,
    chunkType: chunkType ?? null,
    embedding: embedding ?? null,
    createdAt: new Date(),
  };
}

export function deleteChunksByFile(indexId: string, filePath: string): void {
  const db = getDatabase();
  db.transaction(() => {
    // Delete from vector table first (if available)
    if (isSqliteVecAvailable()) {
      db.prepare(`
        DELETE FROM code_chunks_vec
        WHERE chunk_id IN (SELECT id FROM code_chunks WHERE index_id = ? AND file_path = ?)
      `).run(indexId, filePath);
    }
    // Then delete chunks
    db.prepare('DELETE FROM code_chunks WHERE index_id = ? AND file_path = ?')
      .run(indexId, filePath);
  })();
}

export function searchChunksByVector(
  indexId: string,
  queryEmbedding: number[],
  limit: number = 10
): CodeSearchResult[] {
  if (!isSqliteVecAvailable()) {
    return [];
  }

  const db = getDatabase();
  const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);

  try {
    const rows = db.prepare(`
      SELECT
        c.file_path,
        c.start_line,
        c.end_line,
        c.content,
        c.chunk_type,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM code_chunks_vec v
      JOIN code_chunks c ON c.id = v.chunk_id
      WHERE c.index_id = ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(embeddingBlob, indexId, limit) as any[];

    return rows.map(row => ({
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      chunkType: row.chunk_type,
      score: 1 - row.distance, // Convert distance to similarity
    }));
  } catch (e) {
    console.error('Vector search failed:', e);
    return [];
  }
}

// ============ Symbols ============

export function createSymbol(
  indexId: string,
  name: string,
  symbolType: SymbolType,
  filePath: string,
  line: number,
  column: number,
  signature?: string | null,
  parentSymbolId?: string | null
): CodeSymbol {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO symbols (id, index_id, name, symbol_type, file_path, line, "column", signature, parent_symbol_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, indexId, name, symbolType, filePath, line, column, signature ?? null, parentSymbolId ?? null);

  return {
    id,
    indexId,
    name,
    symbolType,
    filePath,
    line,
    column,
    signature: signature ?? null,
    parentSymbolId: parentSymbolId ?? null,
    createdAt: new Date(),
  };
}

export function deleteSymbolsByFile(indexId: string, filePath: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM symbols WHERE index_id = ? AND file_path = ?')
    .run(indexId, filePath);
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

export function searchSymbols(
  indexId: string,
  name: string,
  symbolType?: SymbolType,
  limit: number = 20
): SymbolSearchResult[] {
  const db = getDatabase();

  // Use case-insensitive LIKE with LOWER()
  let query = `
    SELECT name, symbol_type, file_path, line, "column", signature
    FROM symbols
    WHERE index_id = ? AND LOWER(name) LIKE LOWER(?) ESCAPE '\\'
  `;
  const params: any[] = [indexId, `%${escapeLike(name)}%`];

  if (symbolType) {
    query += ' AND symbol_type = ?';
    params.push(symbolType);
  }

  query += ' ORDER BY name LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];

  console.log(`[CodeSearch] Symbol search for "${name}" in index ${indexId}: found ${rows.length} results`);

  return rows.map(row => ({
    name: row.name,
    symbolType: row.symbol_type,
    filePath: row.file_path,
    line: row.line,
    column: row.column,
    signature: row.signature,
  }));
}

// ============ Mappers ============

function mapRowToCodeIndex(row: any): CodeIndex {
  // Count symbols for this index
  const db = getDatabase();
  const symbolCountRow = db.prepare('SELECT COUNT(*) as count FROM symbols WHERE index_id = ?').get(row.id) as any;
  const symbolCount = symbolCountRow?.count ?? 0;

  return {
    id: row.id,
    directoryPath: row.directory_path,
    lastIndexedAt: row.last_indexed_at ? new Date(row.last_indexed_at) : null,
    status: row.status,
    fileCount: row.file_count,
    chunkCount: row.chunk_count,
    symbolCount,
    modelName: row.model_name,
    embeddingDimensions: row.embedding_dimensions,
    errorMessage: row.error_message,
  };
}

function mapRowToIndexedFile(row: any): IndexedFile {
  return {
    id: row.id,
    indexId: row.index_id,
    filePath: row.file_path,
    mtime: row.mtime,
    fileHash: row.file_hash,
    chunkCount: row.chunk_count,
  };
}
