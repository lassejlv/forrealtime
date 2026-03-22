const MAX_STREAM_SEQUENCE = "18446744073709551615";

export function compareStreamIds(left: string, right: string): number {
  const [leftTime = "0", leftSequence = "0"] = left.split("-");
  const [rightTime = "0", rightSequence = "0"] = right.split("-");

  const leftTimeValue = BigInt(leftTime);
  const rightTimeValue = BigInt(rightTime);

  if (leftTimeValue !== rightTimeValue) {
    return leftTimeValue > rightTimeValue ? 1 : -1;
  }

  const leftSequenceValue = BigInt(leftSequence);
  const rightSequenceValue = BigInt(rightSequence);

  if (leftSequenceValue === rightSequenceValue) {
    return 0;
  }

  return leftSequenceValue > rightSequenceValue ? 1 : -1;
}

export function toHistoryStart(value?: number): string {
  if (value == null) {
    return "-";
  }

  return `${Math.trunc(value)}-0`;
}

export function toHistoryEnd(value?: number): string {
  if (value == null) {
    return "+";
  }

  return `${Math.trunc(value)}-${MAX_STREAM_SEQUENCE}`;
}

export function toExclusiveStreamId(id: string): string {
  return `(${id}`;
}

export function encodeServerSentEvent(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}
