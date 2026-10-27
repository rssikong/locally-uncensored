export interface DocumentMeta {
  id: string
  name: string
  type: 'pdf' | 'docx' | 'txt'
  size: number
  addedAt: number
  chunkCount: number
  /** SHA-256 of the file, hex. Written on a phone, where the same file must not be added twice. */
  contentHash?: string
}

export interface TextChunk {
  id: string
  documentId: string
  content: string
  embedding: number[]
  index: number
}

export interface RAGContext {
  chunks: TextChunk[]
  query: string
  documentIds: string[]
}

export interface VectorSearchResult {
  chunk: TextChunk
  score: number
}
