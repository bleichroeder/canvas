import type { SourceAdapter, SourceType } from './types';

const registry = new Map<SourceType, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  registry.set(adapter.type, adapter);
}

export function getAdapter(type: SourceType): SourceAdapter {
  const adapter = registry.get(type);
  if (!adapter) {
    throw new Error(`Source adapter not registered: ${type}`);
  }
  return adapter;
}

export function listAdapters(): SourceAdapter[] {
  return [...registry.values()];
}
