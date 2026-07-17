/**
 * Canonical habit-duration bounds (minutes). Dependency-free ON PURPOSE so both
 * the server schemas/mappers AND the client wizards can import them without
 * pulling any zod/schema code into a client bundle.
 *
 * `MEDITATION_MAX_MIN` is the single source of truth for the meditation cap,
 * consumed by the HabitLog value schema, the morning check-in schema, the
 * check-in→TRACK mapper, the edit-prefill clamp, and both client wizards'
 * manual validation. Change it here and every surface moves together — no
 * cross-surface drift (the J5.2 divergence: the check-in once accepted 240 min
 * while TRACK clamped to 180).
 */
export const MEDITATION_MAX_MIN = 180;
