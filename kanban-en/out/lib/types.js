/**
 * deepseek-herness-kanban — core data model.
 *
 * The shapes below mirror the plan's §6 data model: a board owns exactly four
 * workflow columns, a task accumulates every piece of context over its
 * lifetime (comments, events, attempts), and an attempt records one full
 * dispatch → worktree → review cycle.
 */
export const COLUMN_IDS = ['todo', 'doing', 'review', 'done'];
export const DEFAULT_COLUMNS = [
    { id: 'todo', label: 'To do', color: '#94a3b8' },
    { id: 'doing', label: 'In progress', color: '#3b82f6' },
    { id: 'review', label: 'In review', color: '#f59e0b' },
    { id: 'done', label: 'Done', color: '#22c55e' },
];
export const PRIORITY_ORDER = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
};
export const PRIORITY_BADGE = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
};
export function isColumnId(value) {
    return typeof value === 'string' && COLUMN_IDS.includes(value);
}
export function nextColumn(current, success) {
    switch (current) {
        case 'todo':
        case 'doing':
            return success ? 'review' : 'todo';
        case 'review':
            return success ? 'done' : 'todo';
        case 'done':
            return 'done';
    }
}
//# sourceMappingURL=types.js.map