export const schemaVersion = 2;

// Version 1 stored the entries directly as a JSON array.
export function readCatalog(value) {
  const legacy = Array.isArray(value);
  if (!legacy && value?.schemaVersion !== schemaVersion) {
    throw new Error('지원하지 않는 자료 형식입니다. 최신 자료실 버전으로 다시 열어 주세요.');
  }
  const entries = legacy ? value : value.entries;
  if (!Array.isArray(entries)) throw new Error('자료 목록을 읽을 수 없습니다.');
  return {legacy, entries, metadata: legacy ? {} : value};
}

export function writeCatalog(metadata, entries) {
  return JSON.stringify({...metadata, schemaVersion, entries});
}
