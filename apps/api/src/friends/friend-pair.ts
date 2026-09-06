export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function otherOf(requesterId: string, addresseeId: string, me: string): string {
  return me === requesterId ? addresseeId : requesterId;
}
