import { InvalidStateTransitionError } from '../errors/domain-errors';

/** Reusable typed FSM. Callers pass an allow-list of transitions. */
export class StateMachine<S extends string> {
  constructor(
    private readonly entityName: string,
    private readonly allowed: ReadonlyArray<readonly [S, S]>,
  ) {}

  assert(from: S, to: S): void {
    if (from === to) return;
    const ok = this.allowed.some(([a, b]) => a === from && b === to);
    if (!ok) throw new InvalidStateTransitionError(this.entityName, from, to);
  }

  canTransition(from: S, to: S): boolean {
    if (from === to) return true;
    return this.allowed.some(([a, b]) => a === from && b === to);
  }
}
