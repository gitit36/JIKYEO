/**
 * iOS `APIClient.url` concatenates `base + path` so GET query strings stay
 * literal. `URL.appendingPathComponent` would encode `?` and 404 Today.
 */
describe('iOS client URL join contract', () => {
  function join(base: string, path: string): string {
    const root = base.replace(/\/+$/, '');
    const rel = path.replace(/^\/+/, '');
    return `${root}/${rel}`;
  }

  it('keeps Today timezone query and does not encode ?', () => {
    const url = join('http://localhost:3001/v1', 'occurrences/today?timezone=Asia/Seoul');
    expect(url).toBe('http://localhost:3001/v1/occurrences/today?timezone=Asia/Seoul');
    expect(url).not.toContain('%3F');
  });

  it('keeps evidence upload-url contentType query', () => {
    const url = join('http://localhost:3001/v1/', 'occurrences/o1/evidence/upload-url?contentType=image/jpeg');
    expect(url).toContain('?contentType=image/jpeg');
    expect(url).not.toContain('%3F');
  });
});
