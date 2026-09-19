import { branchNameFor } from './ids.js';
import { createParsedTasks, normalizeParseResult, PARSE_SYSTEM_PROMPT } from './parse.js';
import { InvalidStateError, NotFoundError } from './store.js';
import { latestAttemptSummary } from './status.js';
/**
 * Req 2 — the only manual column moves allowed on the 4-column workflow.
 *
 * todo → done and done → todo are manual open/close; everything else goes
 * through its own lifecycle entry point:
 *   todo → doing: herness_kanban_dispatch_task (scheduler)
 *   doing → review: automatic after a successful run
 *   doing → todo: herness_kanban_stop_task / settle
 *   review → done: herness_kanban_merge_task
 *   review → todo: herness_kanban_revert_task
 */
const TRANSITION_ERRORS = {
    todo: {
        doing: 'In progress is entered only by dispatching the task (herness_kanban_dispatch_task)',
        review: 'In review is entered automatically only after a successful run',
    },
    doing: {
        review: 'In review is entered automatically only after a successful run',
        done: 'Finish the review flow first (merging moves the card to Done automatically)',
    },
    review: {
        todo: 'A task in review returns to To do only through Reject (herness_kanban_reject_task) or Roll back (herness_kanban_revert_task)',
        done: 'A task in review completes only through Approve and merge (herness_kanban_merge_task)',
        doing: 'Only To do tasks can be dispatched',
    },
    done: {
        doing: 'Only To do tasks can be dispatched; to rework, move the card back to To do first',
        review: 'Completed tasks do not need another review; to rework, move the card back to To do first',
    },
};
export class KanbanService {
    store;
    git;
    scheduler;
    complete;
    readSessionTranscript;
    notify;
    getDispatchCatalog;
    startDiscussionSession;
    onSessionWorkspace;
    onWorktreeRemoved;
    constructor(options) {
        this.store = options.store;
        this.git = options.git;
        this.scheduler = options.scheduler;
        this.complete = options.complete;
        this.readSessionTranscript = options.readSessionTranscript;
        this.notify = options.notify;
        this.getDispatchCatalog = options.getDispatchCatalog;
        this.startDiscussionSession = options.startDiscussionSession;
        this.onSessionWorkspace = options.onSessionWorkspace;
        this.onWorktreeRemoved = options.onWorktreeRemoved;
    }
    // ------------------------------------------------------------------
    // Boards (PM-01..03)
    // ------------------------------------------------------------------
    listBoards() {
        return this.store.listBoards();
    }
    /** Import a repo; auto git-init when the path is missing (PM-02). */
    async createBoard(input) {
        const root = await this.git.ensureRepo(input.repoPath, input.mainBranch ?? 'main');
        const branch = input.mainBranch ?? (await this.git.defaultBranchName(root));
        const board = await this.store.createBoard({ ...input, repoPath: root }, branch);
        this.notify?.('Board created', board.name + ' @ ' + root, 'success');
        return board;
    }
    async updateBoard(id, patch) {
        return this.store.updateBoard(id, patch);
    }
    async deleteBoard(id) {
        const board = this.store.getBoard(id);
        // Deleting a board with a live attempt would orphan its agent session and
        // worktree — refuse until every task is stopped.
        const busy = this.store.listTasks(id).filter((t) => t.attempts.some((a) => a.status === 'running' || a.status === 'pending') || this.scheduler.isRunning(t.id));
        if (busy.length > 0) {
            throw new InvalidStateError('Tasks are still running on the board (' + busy.map((t) => t.id).join(', ') + '); stop them before deleting the project');
        }
        const worktrees = await this.git.listWorktrees(board.repoPath);
        await this.git.cleanupBoardWorktrees(board);
        for (const wt of worktrees)
            this.onWorktreeRemoved?.(wt.path);
        await this.store.deleteBoard(id);
    }
    // ------------------------------------------------------------------
    // Tasks (TM-01..TM-10)
    // ------------------------------------------------------------------
    listTasks(boardId) {
        return this.store.listTasks(boardId);
    }
    getTask(id) {
        return this.store.getTask(id);
    }
    async createTask(input) {
        const task = await this.store.createTask(input);
        return task;
    }
    async updateTask(id, input, actor = 'user') {
        if (input.columnId !== undefined) {
            const current = this.store.getTask(id);
            if (input.columnId !== current.columnId) {
                // Req 2: the 4-column workflow is a state machine. Only the listed
                // manual moves are allowed; everything else must go through its own
                // lifecycle entry point (dispatch / settle / merge / revert).
                const reason = TRANSITION_ERRORS[current.columnId]?.[input.columnId];
                if (reason) {
                    throw new InvalidStateError('Moving from [' + current.columnId + '] to [' + input.columnId + '] is not allowed: ' + reason);
                }
            }
        }
        const updated = await this.store.updateTask(id, input, actor);
        if (input.columnId === 'done') {
            void this.scheduler.onTaskCompleted(id);
        }
        return updated;
    }
    async moveTask(id, columnId, actor = 'user') {
        return this.updateTask(id, { columnId }, actor);
    }
    async deleteTask(id) {
        const task = this.store.getTask(id);
        if (this.scheduler.isRunning(id))
            throw new InvalidStateError('stop the running task before deleting it');
        if (task.columnId === 'review') {
            // abandon the review: destroy the worktree so no orphan state remains
            const board = this.store.getBoard(task.boardId);
            const attempt = task.attempts[task.attempts.length - 1];
            if (attempt?.worktreePath && attempt.branchName) {
                await this.git.removeWorktree(board.repoPath, attempt.worktreePath, attempt.branchName, true).catch(() => undefined);
                this.onWorktreeRemoved?.(attempt.worktreePath);
            }
        }
        await this.store.deleteTask(id);
    }
    async addComment(taskId, content, author = 'user', anchor) {
        return this.store.addComment(taskId, author, content, anchor);
    }
    async updateDescription(taskId, description, actor = 'agent') {
        return this.store.updateTask(taskId, { description }, actor);
    }
    /**
     * Append a dated detail section to a card's description (TM-10): keeps the
     * accumulated context intact while the card gains new requirements. Used by
     * the board UI's ✏️ Add details button so the user never has to leave the board.
     */
    async appendDetail(taskId, content, actor = 'user') {
        const task = this.store.getTask(taskId);
        const body = content.trim();
        if (!body)
            return task;
        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const label = stamp.getFullYear() + '-' + pad(stamp.getMonth() + 1) + '-' + pad(stamp.getDate()) + ' ' + pad(stamp.getHours()) + ':' + pad(stamp.getMinutes());
        const section = '\n\n---\n### 📝 Details · ' + label + '\n\n' + body;
        return this.store.updateTask(taskId, { description: task.description + section }, actor);
    }
    // ------------------------------------------------------------------
    // Execution (AE-01..AE-08)
    // ------------------------------------------------------------------
    async dispatch(taskId, runner = {}) {
        const attempt = await this.scheduler.dispatch(taskId, runner);
        this.notify?.('Task dispatched', this.store.getTask(taskId).title, 'info');
        return attempt;
    }
    async dispatchCatalog() {
        if (!this.getDispatchCatalog)
            throw new Error('dispatch catalog is not available');
        return this.getDispatchCatalog();
    }
    async stop(taskId) {
        await this.scheduler.stop(taskId);
    }
    // ------------------------------------------------------------------
    // Task-scoped refinement discussion (Req 3)
    // ------------------------------------------------------------------
    /**
     * Req 3 — open a dedicated conversation to refine a todo card's
     * requirements. The spawned session's context contains ONLY this card's
     * content (description, comments, events, attempts); the user chats with it
     * in the GUI and the agent writes agreed changes back onto the card.
     */
    async startDiscussion(taskId) {
        const task = this.store.getTask(taskId);
        if (task.columnId !== 'todo') {
            throw new InvalidStateError('Only To do tasks can open a refinement conversation; current status [' + task.columnId + ']');
        }
        if (this.scheduler.isRunning(taskId))
            throw new InvalidStateError('Task is running; cannot open a refinement conversation');
        if (!this.startDiscussionSession)
            throw new Error('discussion sessions are not available in this deployment');
        const board = this.store.getBoard(task.boardId);
        const sessionId = await this.startDiscussionSession(task, board);
        // land the session in the project workspace so it is never “ungrouped”
        if (this.onSessionWorkspace) {
            try {
                await this.onSessionWorkspace(board.repoPath, board.name, sessionId);
            }
            catch {
                // best-effort — the conversation itself is already live
            }
        }
        await this.store.recordEvent(taskId, 'discussion_started', { sessionId });
        this.notify?.('Refinement conversation opened', task.title + ' — find the session under the workspace on the left to continue', 'info');
        return { taskId, sessionId };
    }
    runningState() {
        const out = {};
        for (const task of this.store.listTasks()) {
            const attempt = task.attempts[task.attempts.length - 1];
            if (attempt && (attempt.status === 'running' || attempt.status === 'pending')) {
                out[task.id] = { attemptId: attempt.id, progress: attempt.progress };
            }
        }
        return out;
    }
    // ------------------------------------------------------------------
    // Review (CR-01..CR-07)
    // ------------------------------------------------------------------
    /** CR-01/CR-02: full diff of the latest attempt vs the main branch. */
    async getDiff(taskId) {
        const task = this.store.getTask(taskId);
        const board = this.store.getBoard(task.boardId);
        const attempt = task.attempts[task.attempts.length - 1];
        const branch = attempt?.branchName ?? branchNameFor(task);
        if (!(await this.git.branchExists(board.repoPath, branch))) {
            throw new NotFoundError('branch', branch);
        }
        return this.git.getDiffSummary(board.repoPath, board.mainBranch, branch);
    }
    async getDiffStat(taskId) {
        const task = this.store.getTask(taskId);
        const board = this.store.getBoard(task.boardId);
        const attempt = task.attempts[task.attempts.length - 1];
        const branch = attempt?.branchName ?? branchNameFor(task);
        return this.git.diffStat(board.repoPath, board.mainBranch, branch);
    }
    /** CR-03: approve + one-click merge. Commits leftovers, merges --no-ff, destroys the worktree. */
    async mergeTask(taskId, actor = 'user') {
        const task = this.store.getTask(taskId);
        // Req 2: review is the only gate into done — merging requires a review card.
        if (task.columnId !== 'review') {
            throw new InvalidStateError('Only tasks in review can be merged; current status [' + task.columnId + ']');
        }
        const board = this.store.getBoard(task.boardId);
        const attempt = task.attempts[task.attempts.length - 1];
        const branch = attempt?.branchName ?? branchNameFor(task);
        const prepared = await this.git.prepareForMerge(board, task, attempt);
        const commit = await this.git.merge(board.repoPath, board.mainBranch, branch, task.id);
        // destroy the worktree + branch after merging (workflow: worktree destroyed on merge)
        if (attempt?.worktreePath) {
            await this.git.removeWorktree(board.repoPath, attempt.worktreePath, branch, true).catch(() => undefined);
            this.onWorktreeRemoved?.(attempt.worktreePath);
        }
        const updated = await this.store.updateTask(taskId, { columnId: 'done' }, actor);
        await this.store.recordEvent(taskId, 'merged', { commit, branch, changes: prepared.hasChanges });
        await this.store.recordEvent(taskId, 'review_approved', { commit, actor });
        this.notify?.('Merged', task.title + ' → ' + board.mainBranch, 'success');
        void this.scheduler.onTaskCompleted(taskId);
        return { task: updated, commit };
    }
    /**
     * CR-04a: reject WITHOUT rolling back the merge. The card returns to todo
     * so the reviewer can keep adding content (description, comments) and
     * re-dispatch; the merged code stays on main untouched.
     */
    async rejectTask(taskId, reason, actor = 'user') {
        return this.reviewReject(taskId, reason, actor, false);
    }
    /** CR-04: reject + rollback. Reverts the merge on main and returns the card to todo. */
    async revertTask(taskId, reason, actor = 'user') {
        return this.reviewReject(taskId, reason, actor, true);
    }
    async reviewReject(taskId, reason, actor, rollback) {
        const task = this.store.getTask(taskId);
        // Req 2: review's two exits — reject (→todo) and rollback (→todo).
        if (task.columnId !== 'review') {
            throw new InvalidStateError('Only tasks in review can be rejected; current status [' + task.columnId + ']');
        }
        const board = this.store.getBoard(task.boardId);
        const attempt = task.attempts[task.attempts.length - 1];
        const branch = attempt?.branchName ?? branchNameFor(task);
        let commit;
        if (rollback) {
            try {
                commit = await this.git.revert(board.repoPath, board.mainBranch, branch, task.id);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.notify?.('Rollback failed', message, 'error');
                throw error;
            }
        }
        if (attempt?.worktreePath) {
            await this.git.removeWorktree(board.repoPath, attempt.worktreePath, branch, true).catch(() => undefined);
            this.onWorktreeRemoved?.(attempt.worktreePath);
        }
        await this.addComment(taskId, 'Review rejected: ' + (reason || '(no reason given)'), actor);
        const updated = await this.store.updateTask(taskId, { columnId: 'todo', isBlocked: false, blockReason: undefined }, actor);
        await this.store.recordEvent(taskId, rollback ? 'reverted' : 'rejected', { commit, reason, actor });
        await this.store.recordEvent(taskId, 'review_rejected', { commit, reason, actor });
        this.notify?.(rollback ? 'Rejected and rolled back' : 'Rejected to To do', task.title + ' returned to To do', 'info');
        return { task: updated, commit };
    }
    // ------------------------------------------------------------------
    // Conversation → tasks (DC-01..DC-04)
    // ------------------------------------------------------------------
    async parseConversation(options) {
        const board = this.store.getBoard(options.boardId);
        void board;
        let text = options.text;
        if (!text && options.sessionId && this.readSessionTranscript) {
            const transcript = await this.readSessionTranscript(options.sessionId);
            text = transcript.map((m) => (m.role === 'user' ? '👤 User' : '🤖 Assistant') + ': ' + m.content.slice(0, 4000)).join('\n\n');
        }
        if (!text)
            throw new InvalidStateError('parse_conversation needs conversation text or a bound session');
        const raw = await this.complete(PARSE_SYSTEM_PROMPT, text.slice(0, 60_000), options.callerAgent);
        const parsed = normalizeParseResult(raw);
        return createParsedTasks(this.store, {
            boardId: options.boardId,
            tasks: parsed,
            sessionId: options.sessionId,
            threadId: options.threadId,
            dedupeSimilarity: options.dedupeSimilarity,
            linkDependencies: options.linkDependencies,
        });
    }
    /** Board snapshot for the web UI (DS-03). */
    snapshot() {
        return {
            boards: this.store.listBoards(),
            tasks: this.store.listTasks(),
            running: this.runningState(),
            queue: this.scheduler.pendingCount,
        };
    }
    /** Card digest used by tool outputs. */
    summarizeTask(task) {
        return [
            task.id,
            '[' + task.columnId + ']',
            task.title,
            task.priority !== 'medium' ? '(' + task.priority + ')' : '',
            latestAttemptSummary(task),
        ].filter(Boolean).join(' ');
    }
}
//# sourceMappingURL=service.js.map