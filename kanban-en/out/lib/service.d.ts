import { GitService } from './git.js';
import { SchedulerService, type DispatchRunnerOptions } from './scheduler.js';
import { KanbanStore, type CreateBoardInput, type CreateTaskInput, type UpdateTaskInput } from './store.js';
import type { Board, ColumnId, DiffSummary, Task } from './types.js';
export interface ParseConversationOptions {
    boardId: string;
    /** Explicit conversation text; when omitted the bound session's tail is used. */
    text?: string;
    sessionId?: string;
    threadId?: string;
    dedupeSimilarity?: number;
    linkDependencies?: boolean;
    /** The calling agent; its model config is reused for the parse call. */
    callerAgent?: CallerAgent;
}
/** Minimal structural view of a DSH agent, keeps this module dependency-free. */
export interface CallerAgent {
    id?: string;
    options?: {
        provider?: string;
        model?: string;
    };
}
export interface ParseConversationResult {
    created: Task[];
    skippedDuplicates: number;
    dependencyLinked: number;
}
export interface ReviewResult {
    task: Task;
    commit?: string;
}
export type { DispatchRunnerOptions };
export interface DispatchCatalogPreset {
    id: string;
    name: string;
    description?: string;
    broken?: string;
}
export interface DispatchCatalogReasoningEffort {
    id: string;
    name: string;
    description?: string;
}
export interface DispatchCatalogModel {
    id: string;
    name: string;
    reasoningEfforts?: DispatchCatalogReasoningEffort[];
    defaultEffort?: string;
}
export interface DispatchCatalogProvider {
    id: string;
    name: string;
    models: DispatchCatalogModel[];
}
export interface DispatchCatalog {
    presets: DispatchCatalogPreset[];
    providers: DispatchCatalogProvider[];
    defaults: {
        mode?: 'agent' | 'api';
        agentPreset?: string;
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    };
}
export interface KanbanServiceOptions {
    store: KanbanStore;
    git: GitService;
    scheduler: SchedulerService;
    /** LLM completion seam for parse_conversation (DC-01). */
    complete: (system: string, user: string, agent?: CallerAgent) => Promise<string>;
    /** Read the recent conversation of a session, newest last. */
    readSessionTranscript?: (sessionId: string) => Promise<Array<{
        role: string;
        content: string;
    }>>;
    /** Called when a review decision lands (toasts, NF-13). */
    notify?: (title: string, message: string, kind?: 'success' | 'error' | 'info') => void;
    /** Build the dispatch catalog for the UI (presets, providers, models, reasoning efforts). */
    getDispatchCatalog?: () => Promise<DispatchCatalog>;
    /** Spawn a task-scoped refinement discussion session; resolves to its session id. */
    startDiscussionSession?: (task: Task, board: Board) => Promise<string>;
    /** Attach a session to a workspace (directory + display title). Best-effort. */
    onSessionWorkspace?: (path: string, title: string, sessionId: string) => Promise<void>;
    /** Called after a worktree directory is destroyed so its workspace record can be cleaned up. */
    onWorktreeRemoved?: (worktreePath: string) => void;
}
export declare class KanbanService {
    readonly store: KanbanStore;
    readonly git: GitService;
    readonly scheduler: SchedulerService;
    private readonly complete;
    private readonly readSessionTranscript?;
    private readonly notify?;
    private readonly getDispatchCatalog?;
    private readonly startDiscussionSession?;
    private readonly onSessionWorkspace?;
    private readonly onWorktreeRemoved?;
    constructor(options: KanbanServiceOptions);
    listBoards(): Board[];
    /** Import a repo; auto git-init when the path is missing (PM-02). */
    createBoard(input: CreateBoardInput & {
        mainBranch?: string;
    }): Promise<Board>;
    updateBoard(id: string, patch: Parameters<KanbanStore['updateBoard']>[1]): Promise<Board>;
    deleteBoard(id: string): Promise<void>;
    listTasks(boardId?: string): Task[];
    getTask(id: string): Task;
    createTask(input: CreateTaskInput): Promise<Task>;
    updateTask(id: string, input: UpdateTaskInput, actor?: string): Promise<Task>;
    moveTask(id: string, columnId: ColumnId, actor?: string): Promise<Task>;
    deleteTask(id: string): Promise<void>;
    addComment(taskId: string, content: string, author?: string, anchor?: {
        filePath?: string;
        lineNumber?: number;
    }): Promise<import("./types.js").Comment>;
    updateDescription(taskId: string, description: string, actor?: string): Promise<Task>;
    /**
     * Append a dated detail section to a card's description (TM-10): keeps the
     * accumulated context intact while the card gains new requirements. Used by
     * the board UI's ✏️ Add details button so the user never has to leave the board.
     */
    appendDetail(taskId: string, content: string, actor?: string): Promise<Task>;
    dispatch(taskId: string, runner?: DispatchRunnerOptions): Promise<import("./types.js").TaskAttempt>;
    dispatchCatalog(): Promise<DispatchCatalog>;
    stop(taskId: string): Promise<void>;
    /**
     * Req 3 — open a dedicated conversation to refine a todo card's
     * requirements. The spawned session's context contains ONLY this card's
     * content (description, comments, events, attempts); the user chats with it
     * in the GUI and the agent writes agreed changes back onto the card.
     */
    startDiscussion(taskId: string): Promise<{
        taskId: string;
        sessionId: string;
    }>;
    runningState(): Record<string, {
        attemptId: string;
        progress?: number;
    }>;
    /** CR-01/CR-02: full diff of the latest attempt vs the main branch. */
    getDiff(taskId: string): Promise<DiffSummary>;
    getDiffStat(taskId: string): Promise<string>;
    /** CR-03: approve + one-click merge. Commits leftovers, merges --no-ff, destroys the worktree. */
    mergeTask(taskId: string, actor?: string): Promise<ReviewResult>;
    /**
     * CR-04a: reject WITHOUT rolling back the merge. The card returns to todo
     * so the reviewer can keep adding content (description, comments) and
     * re-dispatch; the merged code stays on main untouched.
     */
    rejectTask(taskId: string, reason: string, actor?: string): Promise<ReviewResult>;
    /** CR-04: reject + rollback. Reverts the merge on main and returns the card to todo. */
    revertTask(taskId: string, reason: string, actor?: string): Promise<ReviewResult>;
    private reviewReject;
    parseConversation(options: ParseConversationOptions): Promise<ParseConversationResult>;
    /** Board snapshot for the web UI (DS-03). */
    snapshot(): {
        boards: Board[];
        tasks: Task[];
        running: Record<string, {
            attemptId: string;
            progress?: number;
        }>;
        queue: number;
    };
    /** Card digest used by tool outputs. */
    summarizeTask(task: Task): string;
}
