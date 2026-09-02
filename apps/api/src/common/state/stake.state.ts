import { StateMachine } from './state-machine';

export type StakeState = 'pending' | 'funded' | 'settling' | 'settled' | 'refunded';

// ERD §4:
//   pending -> funded -> settling -> settled
//                                 -> refunded
export const stakeSM = new StateMachine<StakeState>('stake', [
  ['pending', 'funded'],
  ['funded', 'settling'],
  ['settling', 'settled'],
  ['settling', 'refunded'],
  ['settled', 'refunded'],
]);
