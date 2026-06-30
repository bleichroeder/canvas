import type { SourceType } from '../sources/types';

export interface ParsedSource {
  type: SourceType;
  baseUrl: string;
  token: string;
}
