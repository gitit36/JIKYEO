import { StateMachine } from './state-machine';

// Must mirror Prisma enum `CommitmentStatus`.
export type CommitmentState =
  | 'draft'
  | 'payment_pending'
  | 'active'
  | 'completed'
  | 'cancelled';

// ERD §4:
//   draft -> payment_pending -> active -> completed
//   draft/payment_pending -> cancelled
//   active -> cancelled (future occurrences only, still a Commitment-level state change)
export const commitmentSM = new StateMachine<CommitmentState>('commitment', [
  ['draft', 'payment_pending'],
  ['draft', 'cancelled'],
  ['payment_pending', 'active'],
  ['payment_pending', 'draft'],
  ['payment_pending', 'cancelled'],
  ['active', 'completed'],
  ['active', 'cancelled'],
]);
