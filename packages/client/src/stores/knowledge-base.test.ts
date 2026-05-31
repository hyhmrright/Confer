import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
const postForm = mock(async (_path: string, _form: FormData) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, delete: del, postForm },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { useKbStore } = await import('./knowledge-base.js');

const initial = useKbStore.getState();

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  postForm.mockReset();
  useKbStore.setState({ kbs: [], documents: {}, loading: false, uploading: false });
});

afterEach(() => {
  useKbStore.setState(initial, true);
});

describe('knowledge-base store', () => {
  test('fetchKbs stores the fetched list and clears loading', async () => {
    const kbs = [{ id: 'kb1', user_id: 'u1', name: 'Docs' }];
    get.mockResolvedValueOnce({ knowledge_bases: kbs });
    await useKbStore.getState().fetchKbs();
    expect(get).toHaveBeenCalledWith('/knowledge-bases');
    const state = useKbStore.getState();
    expect(state.kbs).toEqual(kbs as never);
    expect(state.loading).toBe(false);
  });

  test('fetchKbs clears loading even when the request fails', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    await expect(useKbStore.getState().fetchKbs()).rejects.toThrow('boom');
    expect(useKbStore.getState().loading).toBe(false);
  });

  test('createKb posts and prepends the new KB', async () => {
    useKbStore.setState({ kbs: [{ id: 'kb1', user_id: 'u1', name: 'Old' }] as never });
    const created = { id: 'kb2', user_id: 'u1', name: 'New' };
    post.mockResolvedValueOnce({ knowledge_base: created });
    await useKbStore.getState().createKb('New', 'desc');
    expect(post).toHaveBeenCalledWith('/knowledge-bases', { name: 'New', description: 'desc' });
    expect(useKbStore.getState().kbs.map((k) => k.id)).toEqual(['kb2', 'kb1']);
  });

  test('deleteKb deletes and drops the KB plus its documents', async () => {
    useKbStore.setState({
      kbs: [
        { id: 'kb1', user_id: 'u1', name: 'A' },
        { id: 'kb2', user_id: 'u1', name: 'B' },
      ] as never,
      documents: { kb1: [{ id: 'd1' }], kb2: [{ id: 'd2' }] } as never,
    });
    await useKbStore.getState().deleteKb('kb1');
    expect(del).toHaveBeenCalledWith('/knowledge-bases/kb1');
    const state = useKbStore.getState();
    expect(state.kbs.map((k) => k.id)).toEqual(['kb2']);
    expect(Object.keys(state.documents)).toEqual(['kb2']);
  });

  test('fetchDocuments stores the document list keyed by kbId', async () => {
    const documents = [{ id: 'd1', kb_id: 'kb1', user_id: 'u1', filename: 'a.pdf' }];
    get.mockResolvedValueOnce({ documents });
    await useKbStore.getState().fetchDocuments('kb1');
    expect(get).toHaveBeenCalledWith('/knowledge-bases/kb1/documents');
    expect(useKbStore.getState().documents.kb1).toEqual(documents as never);
  });

  test('uploadDocument posts the form and prepends the document', async () => {
    useKbStore.setState({ documents: { kb1: [{ id: 'd1' }] } as never });
    const created = { id: 'd2', kb_id: 'kb1', user_id: 'u1', filename: 'b.pdf' };
    postForm.mockResolvedValueOnce({ document: created });
    const file = new File(['hello'], 'b.pdf', { type: 'application/pdf' });
    await useKbStore.getState().uploadDocument('kb1', file);
    expect(postForm).toHaveBeenCalledTimes(1);
    const [path, form] = postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/knowledge-bases/kb1/documents');
    expect((form.get('file') as File).name).toBe('b.pdf');
    const state = useKbStore.getState();
    expect(state.documents.kb1.map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(state.uploading).toBe(false);
  });

  test('uploadDocument clears uploading even when the upload fails', async () => {
    postForm.mockRejectedValueOnce(new Error('upload failed'));
    const file = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    await expect(useKbStore.getState().uploadDocument('kb1', file)).rejects.toThrow(
      'upload failed',
    );
    expect(useKbStore.getState().uploading).toBe(false);
  });

  test('deleteDocument deletes and removes the document from its KB', async () => {
    useKbStore.setState({
      documents: { kb1: [{ id: 'd1' }, { id: 'd2' }] } as never,
    });
    await useKbStore.getState().deleteDocument('kb1', 'd1');
    expect(del).toHaveBeenCalledWith('/knowledge-bases/kb1/documents/d1');
    expect(useKbStore.getState().documents.kb1.map((d) => d.id)).toEqual(['d2']);
  });

  test('retryDocument posts retry and replaces the document in place', async () => {
    useKbStore.setState({
      documents: {
        kb1: [
          { id: 'd1', status: 'failed' },
          { id: 'd2', status: 'ready' },
        ],
      } as never,
    });
    const updated = { id: 'd1', kb_id: 'kb1', user_id: 'u1', filename: 'a.pdf', status: 'pending' };
    post.mockResolvedValueOnce({ document: updated });
    await useKbStore.getState().retryDocument('kb1', 'd1');
    expect(post).toHaveBeenCalledWith('/knowledge-bases/kb1/documents/d1/retry', {});
    const docs = useKbStore.getState().documents.kb1;
    expect(docs.find((d) => d.id === 'd1')?.status).toBe('pending');
    expect(docs.map((d) => d.id)).toEqual(['d1', 'd2']);
  });
});
