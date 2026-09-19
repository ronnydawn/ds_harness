/**
 * SchedulerService — dispatch engine, heartbeat monitoring, and per-task
 * timers (AE-01..AE-08, TA-01..TA-04, NF-06, NF-10).
 *
 * The engine is transport-agnostic: the DSH session seam is injected as an
 * {@link AgentRunner}, so tests drive it with a fake agent.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { branchNameFor, clampProgress, worktreePathFor } from './ids.js';
export const DEFAULT_MAX_CONCURRENT = 5;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000;
export const HEARTBEAT_FILE = '.herness/heartbeat.json';
export class SchedulerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchedulerError';
    }
}
export class SchedulerService extends EventEmitter {
    maxConcurrent;
    heartbeatTimeoutMs;
    store;
    git;
    runner;
    opts;
    runs = new Map();
    queue = [];
    timers = new Map();
    disposed = false;
    constructor(store, gitService, runner, options = {}) {
        super();
        this.store = store;
        this.git = gitService;
        this.runner = runner;
        this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
        this.opts = {
            onProgress: options.onProgress ?? (() => { }),
            onSettled: options.onSettled ?? (() => { }),
            onStart: options.onStart ?? (() => { }),
            onWorktreeRemoved: options.onWorktreeRemoved ?? (() => { }),
        };
    }
    get activeCount() {
        return this.runs.size;
    }
    get pendingCount() {
        return this.queue.length;
    }
    isRunning(taskId) {
        return this.runs.has(taskId);
    }
    // ------------------------------------------------------------------
    // Dispatch (AE-01..AE-04)
    // ------------------------------------------------------------------
    async dispatch(taskId, runner = {}) {
        if (this.disposed)
            throw new SchedulerError('scheduler is disposed');
        if (this.runs.has(taskId))
            throw new SchedulerError('task already running: ' + taskId);
        if (this.queue.some((q) => q.taskId === taskId))
            throw new SchedulerError('task already queued: ' + taskId);
        const task = this.store.getTask(taskId);
        if (task.isBlocked)
            throw new SchedulerError('task is blocked' + (task.blockReason ? ': ' + task.blockReason : ''));
        // Req 2: only todo cards may be dispatched — doing/review/done have their
        // own lifecycle (dispatch, merge/revert) and must not re-enter execution.
        if (task.columnId !== 'todo') {
            throw new SchedulerError('only todo tasks can be dispatched; task ' + taskId + ' is [' + task.columnId + ']');
        }
        const board = this.store.getBoard(task.boardId);
        // 1. isolated worktree + branch (AE-02)
        const worktree = await this.git.createWorktree(board, task);
        let attempt;
        try {
            attempt = await this.store.beginAttempt(task, undefined, worktree.path, worktree.branch);
        }
        catch (error) {
            // never leave a fresh worktree behind when the attempt cannot be recorded
            await this.git.removeWorktree(board.repoPath, worktree.path, worktree.branch, true).catch(() => undefined);
            throw error;
        }
        await this.store.recordEvent(taskId, 'dispatched', { attemptId: attempt.id, branch: worktree.branch, worktree: worktree.path, runner });
        if (this.runs.size >= this.maxConcurrent) {
            this.queue.push({ taskId, attemptId: attempt.id, runner });
            await this.store.updateTask(taskId, {});
            return attempt;
        }
        void this.startRun(taskId, attempt.id, runner);
        return attempt;
    }
    async startRun(taskId, attemptId, runner = {}) {
        if (this.disposed)
            return;
        const task = this.store.getTaskOrNull(taskId);
        if (!task)
            return;
        const board = this.store.getBoard(task.boardId);
        const attempt = task.attempts.find((a) => a.id === attemptId);
        if (!attempt)
            return;
        const worktreePath = attempt.worktreePath ?? worktreePathFor(board, task);
        const branchName = attempt.branchName ?? branchNameFor(task);
        const abort = new AbortController();
        const run = {
            taskId,
            attemptId,
            abort,
            heartbeat: { lastSignal: Date.now(), lastProgressFile: Date.now() },
        };
        this.runs.set(taskId, run);
        this.opts.onStart(taskId);
        await this.store.updateTask(taskId, { columnId: 'doing' });
        await this.store.recordEvent(taskId, 'running', { attemptId });
        try {
            const session = await this.runner.spawn({ task, board, attempt, worktreePath, branchName, runner });
            run.session = session;
            if (run.abort.signal.aborted) {
                // stop() raced the spawn (AE-05): the session was not stoppable yet —
                // cancel it now so wait() settles and the worktree is cleaned up.
                await session.stop().catch(() => undefined);
            }
            if (session.sessionId) {
                await this.store.backend.updateTask(taskId, (current) => ({
                    ...current,
                    attempts: current.attempts.map((a) => (a.id === attemptId ? { ...a, sessionId: session.sessionId } : a)),
                }));
            }
            // heartbeat watchdog (NF-10)
            run.timer = setInterval(() => this.checkHeartbeat(run), Math.min(30_000, Math.floor(this.heartbeatTimeoutMs / 2)));
            const outcome = await session.wait();
            await this.settle(taskId, attemptId, outcome, run);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.settle(taskId, attemptId, { status: 'failed', error: message, summary: 'Run failed: ' + message }, run);
        }
        finally {
            clearInterval(run.timer);
            this.runs.delete(taskId);
            this.pump();
        }
    }
    pump() {
        if (this.disposed)
            return;
        while (this.runs.size < this.maxConcurrent && this.queue.length > 0) {
            const next = this.queue.shift();
            if (!next)
                break;
            if (!this.runs.has(next.taskId))
                void this.startRun(next.taskId, next.attemptId, next.runner);
        }
    }
    async settle(taskId, attemptId, outcome, run) {
        const task = this.store.getTaskOrNull(taskId);
        if (!task)
            return;
        let diffSummary;
        if (outcome.status === 'success') {
            try {
                const board = this.store.getBoard(task.boardId);
                const attempt = task.attempts.find((a) => a.id === attemptId);
                const branch = attempt?.branchName ?? branchNameFor(task);
                const stat = await this.git.diffStat(board.repoPath, board.mainBranch, branch);
                diffSummary = stat.trim() || 'no changes';
            }
            catch {
                diffSummary = undefined;
            }
        }
        else {
            // AE-05: a failed/stopped attempt returns the card to todo — its
            // worktree is dead weight that would otherwise accumulate next to the
            // repo. Destroy it (worktrees live only while a run is active or a
            // card sits in review); only provably disposable ones are removed, so
            // committed or dirty agent work is never destroyed silently.
            await this.destroyAttemptWorktree(task, attemptId);
        }
        await this.store.settleAttempt(taskId, attemptId, {
            status: outcome.status,
            summary: outcome.summary,
            error: outcome.error,
            diffSummary,
        });
        this.opts.onSettled(taskId, outcome);
        this.emit('settled', { taskId, attemptId, outcome });
        void run;
    }
    /**
     * Destroy the worktree of an attempt that settled without success. The
     * removal is best-effort and never blocks the settle: a branch with commits
     * beyond main or uncommitted changes is kept (the re-dispatch reclaim path
     * then surfaces it as WORKTREE_EXISTS), while clean stale slots are removed
     * so task folders don't pile up next to the repository.
     */
    async destroyAttemptWorktree(task, attemptId) {
        try {
            const attempt = task.attempts.find((a) => a.id === attemptId);
            if (!attempt?.worktreePath)
                return;
            const board = this.store.getBoard(task.boardId);
            const branch = attempt.branchName ?? branchNameFor(task);
            if (await this.git.branchAheadOf(board.repoPath, board.mainBranch, branch))
                return;
            await this.git.removeWorktree(board.repoPath, attempt.worktreePath, branch, false);
            this.opts.onWorktreeRemoved(attempt.worktreePath);
        }
        catch {
            // leftover worktrees are reclaimed on the next dispatch
            // (reclaimWorktreeSlot) or swept at plugin startup — never block settle.
        }
    }
    /** Stop a running attempt: cancel the session, move the task back to todo (AE-05). */
    async stop(taskId) {
        const run = this.runs.get(taskId);
        const queuedIndex = this.queue.findIndex((q) => q.taskId === taskId);
        if (queuedIndex >= 0) {
            this.queue.splice(queuedIndex, 1);
            const task = this.store.getTaskOrNull(taskId);
            if (task) {
                const attempt = task.attempts[task.attempts.length - 1];
                await this.store.settleAttempt(taskId, attempt?.id ?? '', { status: 'stopped', summary: 'Removed from queue' });
                // the worktree was already created at dispatch time; stop the leak
                if (attempt)
                    await this.destroyAttemptWorktree(task, attempt.id);
            }
            return;
        }
        if (!run)
            throw new SchedulerError('task is not running: ' + taskId);
        run.abort.abort();
        await run.session?.stop();
    }
    // ------------------------------------------------------------------
    // Heartbeat (AE-06, NF-10): logs + progress file dual signal
    // ------------------------------------------------------------------
    checkHeartbeat(run) {
        const task = this.store.getTaskOrNull(run.taskId);
        if (!task)
            return;
        const attempt = task.attempts.find((a) => a.id === run.attemptId);
        if (!attempt?.worktreePath)
            return;
        const heartbeatPath = attempt.worktreePath + '/' + HEARTBEAT_FILE;
        if (existsSync(heartbeatPath)) {
            try {
                const stat = statSync(heartbeatPath);
                if (stat.mtimeMs > run.heartbeat.lastProgressFile) {
                    run.heartbeat.lastProgressFile = stat.mtimeMs;
                    run.heartbeat.lastSignal = Date.now();
                    const payload = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
                    if (typeof payload.progress === 'number') {
                        void this.store.setProgress(run.taskId, run.attemptId, clampProgress(payload.progress));
                    }
                }
            }
            catch {
                // unreadable heartbeat file — ignore, the log signal still counts
            }
        }
        if (Date.now() - run.heartbeat.lastSignal > this.heartbeatTimeoutMs) {
            this.opts.onProgress(run.taskId, run.attemptId, ['[herness-kanban] heartbeat timeout after ' + Math.round(this.heartbeatTimeoutMs / 60000) + 'min — stopping']);
            run.abort.abort();
            void run.session?.stop();
        }
    }
    /** Feed session activity into the heartbeat log signal. */
    reportActivity(taskId, attemptId, lines) {
        const run = this.runs.get(taskId);
        if (run && run.attemptId === attemptId) {
            run.heartbeat.lastSignal = Date.now();
            void this.store.appendProgress(taskId, attemptId, lines);
            this.opts.onProgress(taskId, attemptId, lines);
        }
    }
    // ------------------------------------------------------------------
    // Timers (TA-01..TA-04)
    // ------------------------------------------------------------------
    /** Arm the per-task schedule timers for every scheduled task. */
    armTimers() {
        for (const task of this.store.listTasks())
            this.armTaskTimer(task);
    }
    armTaskTimer(task) {
        this.disarmTaskTimer(task.id);
        if (!task.schedule || this.disposed)
            return;
        if (task.schedule.type === 'interval') {
            const minutes = Math.max(1, task.schedule.interval);
            const timer = setInterval(() => {
                this.activate(task.id);
            }, minutes * 60_000);
            this.timers.set(task.id, timer);
        }
        else if (task.schedule.type === 'daily') {
            const timer = setInterval(() => {
                this.checkDaily(task);
            }, 30_000);
            this.timers.set(task.id, timer);
        }
    }
    disarmTaskTimer(taskId) {
        const timer = this.timers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.timers.delete(taskId);
        }
    }
    /** Ensure every scheduled task has an armed timer (cheap periodic sweep). */
    reconcileTimers() {
        if (this.disposed)
            return;
        for (const task of this.store.listTasks()) {
            if (task.schedule && !this.timers.has(task.id))
                this.armTaskTimer(task);
            if (!task.schedule && this.timers.has(task.id))
                this.disarmTaskTimer(task.id);
        }
    }
    checkDaily(task) {
        if (task.schedule?.type !== 'daily')
            return;
        const now = new Date();
        const hhmm = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        if (hhmm === task.schedule.dailyTime)
            this.activate(task.id);
    }
    /** Timed activation: move a scheduled task from done back to todo (⏰). */
    async activate(taskId) {
        const task = this.store.getTaskOrNull(taskId);
        if (!task || this.runs.has(taskId))
            return;
        if (task.columnId === 'done') {
            await this.store.moveTask(taskId, 'todo', 'schedule');
            await this.store.recordEvent(taskId, 'scheduled', { source: task.schedule });
        }
        if (task.columnId === 'todo') {
            this.dispatch(taskId).catch(() => undefined);
        }
    }
    /** TA-03: when a parent completes, activate its subtasks. */
    async onTaskCompleted(taskId) {
        const task = this.store.getTaskOrNull(taskId);
        if (!task)
            return;
        for (const subtaskId of task.subtaskIds ?? []) {
            const subtask = this.store.getTaskOrNull(subtaskId);
            if (subtask && subtask.columnId === 'todo' && !this.runs.has(subtaskId)) {
                await this.store.recordEvent(subtaskId, 'scheduled', { source: { type: 'parent_completed', parentTaskId: taskId } });
                this.dispatch(subtaskId).catch(() => undefined);
            }
        }
    }
    /** Release every resource: sessions, timers, queue (NF-04). */
    async dispose() {
        this.disposed = true;
        for (const timer of this.timers.values())
            clearInterval(timer);
        this.timers.clear();
        this.queue.length = 0;
        for (const run of this.runs.values()) {
            run.abort.abort();
            await run.session?.stop().catch(() => undefined);
        }
        this.runs.clear();
        await this.store.flush();
    }
}
//# sourceMappingURL=scheduler.js.map