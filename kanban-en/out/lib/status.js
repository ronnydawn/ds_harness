export function taskBadges(task) {
    const lastAttempt = task.attempts[task.attempts.length - 1];
    return {
        schedule: !!task.schedule,
        blocked: !!task.isBlocked,
        running: lastAttempt?.status === 'running' || lastAttempt?.status === 'pending',
        reviewing: task.columnId === 'review',
        done: task.columnId === 'done',
        failed: lastAttempt?.status === 'failed' && task.columnId === 'todo',
    };
}
export function renderBadges(task) {
    const badges = taskBadges(task);
    let out = '';
    if (badges.schedule)
        out += '⏰';
    if (badges.blocked)
        out += '🚫';
    if (badges.running)
        out += '🔴';
    if (badges.reviewing)
        out += '👀';
    if (badges.done)
        out += '✅';
    if (badges.failed)
        out += '⚠️';
    return out;
}
/** One-line digest of the latest attempt, for cards and tool results. */
export function latestAttemptSummary(task) {
    const attempt = task.attempts[task.attempts.length - 1];
    if (!attempt)
        return '';
    switch (attempt.status) {
        case 'running':
            return 'Running ' + (attempt.progress ?? 0) + '%';
        case 'pending':
            return 'Queued';
        case 'success':
            return attempt.diffSummary ? 'Changes: ' + attempt.diffSummary : 'Run succeeded';
        case 'failed':
            return 'Failed: ' + (attempt.error ?? attempt.resultSummary ?? 'unknown error').slice(0, 120);
        case 'stopped':
            return 'Stopped';
    }
}
//# sourceMappingURL=status.js.map