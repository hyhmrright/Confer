// Golden set for retrieval evaluation.
//
// The corpus is this repository's own `docs/` — nine Chinese technical design
// documents with well-separated subjects. Using real project documents rather
// than synthetic text matters: the production case is an owner uploading their
// own material and asking about it, and Chinese has no inter-word spaces, which
// is exactly where a retriever tuned on English quietly underperforms.
//
// Relevance is annotated per document. `relevantDocs` holds filenames as they
// reach the retriever in `doc_name`.
//
// The `kind` split is the point of the whole set, not bookkeeping:
//
//   semantic — asked the way a person asks, sharing few words with the source.
//             Dense retrieval's home ground.
//   lexical  — an exact identifier, table name, or term of art. Dense embedding
//             blurs these: `peer_contacts` and `peer_agents` land in nearly the
//             same place in vector space, and one is the wrong table. This is
//             the class hybrid (BM25/sparse + RRF) exists to fix, so a change
//             that helps retrieval overall should move THIS bucket most.
//   mixed    — a term of art inside a natural question, which is what people
//             actually type.
//
// Report the three buckets separately. An aggregate alone can hide a lexical
// regression behind a semantic gain.

export type CaseKind = 'semantic' | 'lexical' | 'mixed';

export interface EvalCase {
  id: string;
  query: string;
  kind: CaseKind;
  relevantDocs: string[];
}

const P = '01-product.md';
const ARCH = '02-architecture.md';
const PROTO = '03-protocol.md';
const DATA = '04-data-model.md';
const API = '05-api.md';
const PLUGIN = '06-claude-code-plugin.md';
const MEM = '07-project-memory.md';
const BACKLOG = '08-mvp-backlog.md';
const DEPLOY = '09-deployment.md';

export const GOLDEN_SET: EvalCase[] = [
  // --- semantic: natural phrasing, little lexical overlap with the source ---
  {
    id: 's1',
    query: '两个 Agent 第一次通信的时候，怎么确认对方真的是它声称的那个人',
    kind: 'semantic',
    relevantDocs: [PROTO],
  },
  {
    id: 's2',
    query: '整个系统拆成了哪几块服务，各自负责什么',
    kind: 'semantic',
    relevantDocs: [ARCH],
  },
  {
    id: 's3',
    query: '这个产品到底想解决什么问题，为什么现有的做法不够',
    kind: 'semantic',
    relevantDocs: [P],
  },
  {
    id: 's4',
    query: '我搭好的实例想让外面的人也能连上，需要做什么',
    kind: 'semantic',
    relevantDocs: [DEPLOY],
  },
  {
    id: 's5',
    query: '聊天记录和参与者分别存在什么地方',
    kind: 'semantic',
    relevantDocs: [DATA],
  },
  {
    id: 's6',
    query: 'Agent 替我做决定之前，什么情况下必须先征求我同意',
    kind: 'semantic',
    relevantDocs: [PROTO],
  },
  {
    id: 's7',
    query: '第一个可用版本打算做到什么程度，大概要多久',
    kind: 'semantic',
    relevantDocs: [BACKLOG],
  },
  {
    id: 's8',
    query: '在编码工具里怎么让它去请教另一个人的 Agent',
    kind: 'semantic',
    relevantDocs: [PLUGIN],
  },
  {
    id: 's9',
    query: '我上传的文档最后是怎么被找出来回答问题的',
    kind: 'semantic',
    relevantDocs: [API],
  },

  // --- lexical: exact identifiers. Where single-path dense retrieval loses. ---
  { id: 'l1', query: 'did:web', kind: 'lexical', relevantDocs: [PROTO] },
  { id: 'l2', query: 'AgentFacts NANDA', kind: 'lexical', relevantDocs: [PROTO] },
  { id: 'l3', query: 'L3 权限', kind: 'lexical', relevantDocs: [PROTO] },
  { id: 'l4', query: 'peer_contacts', kind: 'lexical', relevantDocs: [DATA] },
  { id: 'l5', query: 'conversation_participants', kind: 'lexical', relevantDocs: [DATA] },
  { id: 'l6', query: 'write_project_memory', kind: 'lexical', relevantDocs: [PLUGIN] },
  { id: 'l7', query: 'capability token', kind: 'lexical', relevantDocs: [PROTO] },
  { id: 'l8', query: 'meta.json', kind: 'lexical', relevantDocs: [MEM] },
  { id: 'l9', query: 'Modbus register map X100', kind: 'lexical', relevantDocs: [MEM] },
  { id: 'l10', query: 'Oracle Cloud Always Free', kind: 'lexical', relevantDocs: [DEPLOY] },
  { id: 'l11', query: 'WebSocket 端点', kind: 'lexical', relevantDocs: [API] },
  { id: 'l12', query: 'RTU mode timing', kind: 'lexical', relevantDocs: [MEM] },

  // --- mixed: a term of art inside a real question ---
  {
    id: 'm1',
    query: '密钥轮换是怎么处理的，旧的公钥还要保留多久',
    kind: 'mixed',
    relevantDocs: [PROTO],
  },
  {
    id: 'm2',
    query: '自托管一个实例需要先准备什么，有哪些前置条件',
    kind: 'mixed',
    relevantDocs: [DEPLOY],
  },
  {
    id: 'm3',
    query: 'MVP 阶段面向的目标用户是谁',
    kind: 'mixed',
    relevantDocs: [P],
  },
  {
    id: 'm4',
    query: 'sessions 表存了什么，和 refresh token 是什么关系',
    kind: 'mixed',
    relevantDocs: [DATA],
  },
  {
    id: 'm5',
    query: 'A2A 请求进来之后，接收方的验证流程是怎样的',
    kind: 'mixed',
    relevantDocs: [PROTO],
  },
  {
    id: 'm6',
    query: '知识库上传的文件走的是哪个 API',
    kind: 'mixed',
    relevantDocs: [API],
  },

  // --- cross-lingual: Chinese questions whose answer lives in the corpus's
  // one English document. Deliberately several, not one: the first run scored
  // this 0% on two cases, and two cases is an anecdote. With five it is a
  // measurement, and it is the measurement that decides whether the embedding
  // model has to change — a thing no reranker can fix after the fact.
  {
    id: 'x1',
    query: '怎么升级到新版本，会不会丢数据',
    kind: 'semantic',
    relevantDocs: [DEPLOY],
  },
  {
    id: 'x2',
    query: '想把所有数据清空重新来过要执行什么',
    kind: 'semantic',
    relevantDocs: [DEPLOY],
  },
  {
    id: 'x3',
    query: '本地开发怎么开热重载',
    kind: 'semantic',
    relevantDocs: [DEPLOY],
  },
];

/**
 * The corpus to ingest, declared rather than derived from the annotations.
 *
 * Deriving it from `relevantDocs` would silently shrink the corpus whenever a
 * document stopped being any query's expected answer — and those documents are
 * the distractors. A retriever scored against only the files that contain the
 * answers is being asked an easier question than production ever asks, and the
 * scores would drift upward for no reason anyone could see.
 *
 * Only the top-level design documents: `docs/en` and `docs/ja` hold
 * translations of this same material, which would be near-duplicates that are
 * arguably correct yet annotated as wrong.
 */
export const CORPUS_FILES: string[] = [P, ARCH, PROTO, DATA, API, PLUGIN, MEM, BACKLOG, DEPLOY];

export type DocLang = 'zh' | 'en';

/**
 * The dominant language of each corpus file, measured rather than assumed
 * (CJK share of total characters: eight files sit between 6% and 22%, while
 * 09-deployment has 2 CJK characters in 19,320 — it is English prose).
 *
 * This exists because the first run of this harness found the corpus's only
 * English document at rank >50 for two different Chinese questions, while
 * Chinese questions against Chinese documents merely landed at rank 7-16. Those
 * are two different failures with two different fixes — ranking versus an
 * embedding model that has no shared space across languages — and an aggregate
 * score cannot tell them apart.
 *
 * It is also not an artifact of this corpus. Confer ships in three languages
 * and its owners' knowledge bases are mixed by nature, so cross-lingual
 * retrieval is the product's normal case, not an edge one.
 */
export const DOC_LANG: Record<string, DocLang> = {
  [P]: 'zh',
  [ARCH]: 'zh',
  [PROTO]: 'zh',
  [DATA]: 'zh',
  [API]: 'zh',
  [PLUGIN]: 'zh',
  [MEM]: 'zh',
  [BACKLOG]: 'zh',
  [DEPLOY]: 'en',
};

/** Every document the golden set expects. Checked against CORPUS_FILES so an annotation can never point outside the corpus. */
export const EXPECTED_DOCS: string[] = [...new Set(GOLDEN_SET.flatMap((c) => c.relevantDocs))];
